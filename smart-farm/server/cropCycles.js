// ============================================================
//  cropCycles.js — เก็บข้อมูลเซ็นเซอร์ตลอดรอบปลูก (เริ่มปลูก → เก็บเกี่ยว)
//  แยกจาก history.json (ซึ่งเก็บแค่ 24 ชม.แล้ว evict ทิ้ง) — รอบปลูกนี้
//  เก็บทุก record ไว้จนกว่าจะเก็บเกี่ยว ไม่มีการลบทิ้งระหว่างทาง
//
//  ลังปลูกมี 2 ลัง ปลูกคนละชนิดและเริ่ม/เก็บเกี่ยวคนละวันได้ จึงมีรอบปลูก
//  active ได้พร้อมกันลังละ 1 รอบ
//
//  รูปแบบ record ไม่แยกตามลัง — เก็บภาพรวมทั้งฟาร์ม ณ วินาทีนั้นเหมือนเดิม
//  แล้วเขียน object ตัวเดียวกันลงทุกรอบที่ active อยู่ การกรองว่าค่าไหน
//  เป็นของลังไหนทำที่ชั้นแสดงผล (TRAY_VIEW ใน dashboard.js)
//  เหตุผล: แยก key ตามลังกินที่มากกว่า (key ของ object แพงกว่าช่องใน array)
//  และถ้าการแมปเซ็นเซอร์→ลังเปลี่ยนอีก ไฟล์เก่ายังตีความได้อยู่
//
//  ที่เก็บข้อมูลจริงอยู่ใน cropStore.js (ไฟล์ หรือ Supabase) — ดูเหตุผลที่นั่น
// ============================================================

const crypto = require('crypto');
const store  = require('./cropStore');

const RECORD_INTERVAL = 5 * 60 * 1000;  // บันทึกทุก 5 นาที
const SAVE_INTERVAL   = 5 * 60 * 1000;  // เขียนลง store ทุก 5 นาที

const TRAYS      = [1, 2];
const TRAY_NAMES = { 1: 'ลังปลูกผัก 1', 2: 'ลังปลูกผัก 2' };

let cycleIndex   = [];  // [{id, tray, cropName, startTime, endTime, status, recordCount}]
let activeCycles = { 1: null, 2: null };
// แต่ละตัว {id, tray, cropName, startTime, endTime, records:[], persistedCount}

// throttle ตัวเดียวใช้ร่วมกันทั้ง 2 ลังโดยตั้งใจ — ทุกลังจะได้ ts ตรงกันเป๊ะ
// และแชร์ object record ตัวเดียวกันได้ ไม่ต้องสร้างซ้ำ
let lastRecordTime = 0;
let lastSaveTime   = 0;
let flushing       = false;   // กัน flush ซ้อนกัน (store เป็น async)

function ensureDataDir() {
    store.ensureDataDir();
}

// ------------------------------------------------------------
//  โหลดตอน boot
// ------------------------------------------------------------

async function loadIndex() {
    const loaded = await store.readIndex();
    if (loaded === null) {
        console.error('[Crops] อ่านรายการรอบปลูกไม่ได้ — เริ่มด้วยรายการว่างเพื่อไม่ให้ทับข้อมูลเดิม');
        cycleIndex = [];
        return false;
    }
    cycleIndex = loaded;

    // --- Migration: รอบปลูกเก่า (ก่อนมีระบบแยกลัง) นับเป็นลัง 1 ทั้งหมด ---
    let migrated = 0;
    for (const e of cycleIndex) {
        if (e.tray !== 1 && e.tray !== 2) { e.tray = 1; migrated++; }
        if (e.status !== 'active' && e.status !== 'completed') {
            e.status = e.endTime ? 'completed' : 'active';
        }
    }
    if (migrated) {
        await store.writeIndex(cycleIndex);
        console.log(`[Crops] Migrated ${migrated} cycle(s) → tray 1`);
    }
    return true;
}

async function loadActiveCyclesOnBoot() {
    const health = await store.healthCheck();
    if (!health.ok) {
        console.error(`[Crops] ⚠️  ต่อ Supabase ไม่ได้: ${health.error}`);
        console.error('[Crops] ⚠️  ข้อมูลรอบปลูกจะไม่ถูกบันทึกจนกว่าจะแก้ได้ — เช็ค SUPABASE_URL / SUPABASE_SERVICE_KEY');
    }
    console.log(`[Crops] ที่เก็บข้อมูล: ${store.describe()}`);

    const ok = await loadIndex();
    if (!ok) return;

    let indexDirty = false;

    for (const tray of TRAYS) {
        const found = cycleIndex.filter(c => c.status === 'active' && c.tray === tray);
        if (!found.length) continue;

        // index เสียหายจนมี active ซ้ำในลังเดียวกัน — เก็บรอบที่เริ่มล่าสุดไว้
        // ที่เหลือปิดเป็น completed ไม่งั้นจะมีรอบผีค้างอยู่ตลอดไป
        found.sort((a, b) => b.startTime - a.startTime);
        const entry = found[0];
        for (const stale of found.slice(1)) {
            stale.status  = 'completed';
            stale.endTime = stale.endTime || stale.startTime;
            indexDirty = true;
            console.warn(`[Crops] Tray ${tray} had duplicate active cycle ${stale.id} — closed it`);
        }

        // อ่านแยกรายลัง: ข้อมูลของลังหนึ่งพังต้องไม่ทำให้อีกลังโหลดไม่ขึ้น
        const records = await store.readRecords(entry.id);
        if (records === null) {
            console.error(`[Crops] อ่าน records ของลัง ${tray} ไม่ได้ — ข้ามรอบนี้ไปก่อน ไม่รับข้อมูลใหม่เพื่อกันเขียนทับ`);
            continue;
        }

        activeCycles[tray] = {
            id: entry.id,
            tray,
            cropName: entry.cropName,
            startTime: entry.startTime,
            endTime: null,
            records,
            persistedCount: records.length
        };
        console.log(`[Crops] Resumed cycle ${entry.id} (${entry.cropName}) tray ${tray}, ${records.length} records`);
    }

    if (indexDirty) await store.writeIndex(cycleIndex);
}

// ------------------------------------------------------------
//  อ่านสถานะ (sync — อ่านจาก memory)
// ------------------------------------------------------------

function getCycleList() {
    return [...cycleIndex].sort((a, b) => b.startTime - a.startTime);
}

function getActiveCycleSummary(tray) {
    const c = activeCycles[tray];
    if (!c) return null;
    return { id: c.id, tray: c.tray, cropName: c.cropName, startTime: c.startTime };
}

function getActiveCycleSummaries() {
    const out = {};
    for (const tray of TRAYS) out[tray] = getActiveCycleSummary(tray);
    return out;
}

// ------------------------------------------------------------
//  เริ่ม / จบรอบปลูก
// ------------------------------------------------------------

async function startCycle(cropName, tray) {
    if (!TRAYS.includes(tray)) return null;
    if (activeCycles[tray]) return null;

    // `_t1_` ในชื่อ id เป็นแค่ป้ายให้คนอ่านออก — ลังอ่านจากฟิลด์ tray เสมอ
    // ห้าม parse ออกจาก id (รอบเก่าก่อน migration ไม่มีป้ายนี้)
    const id = `cycle_t${tray}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const startTime = Date.now();

    const entry = { id, tray, cropName, startTime, endTime: null, status: 'active', recordCount: 0 };
    cycleIndex.push(entry);

    // เขียน index ก่อนรับข้อมูล — ถ้าเขียนไม่ได้ต้องบอกผู้ใช้ทันที ไม่ใช่ปล่อยให้
    // ปลูกไป 20 วันแล้วค่อยรู้ว่าไม่มีอะไรถูกบันทึกเลย
    const ok = await store.writeIndex(cycleIndex);
    if (!ok) {
        cycleIndex = cycleIndex.filter(c => c.id !== id);
        return { error: 'storage' };
    }

    store.createCycleStorage(id);
    activeCycles[tray] = { id, tray, cropName, startTime, endTime: null, records: [], persistedCount: 0 };

    console.log(`[Crops] Started cycle ${id} (${cropName}) tray ${tray}`);
    return getActiveCycleSummary(tray);
}

async function endCycle(id) {
    const tray = TRAYS.find(t => activeCycles[t] && activeCycles[t].id === id);
    if (!tray) return null;

    const cycle = activeCycles[tray];
    cycle.endTime = Date.now();

    // เขียน record ที่ค้างอยู่ให้ครบก่อนปิดรอบ
    const pending = cycle.records.slice(cycle.persistedCount);
    const saved   = await store.appendRecords(cycle.id, pending, cycle.records);
    if (saved >= 0) cycle.persistedCount = saved;

    const entry = cycleIndex.find(c => c.id === cycle.id);
    if (entry) {
        entry.endTime     = cycle.endTime;
        entry.status      = 'completed';
        entry.recordCount = cycle.persistedCount;
    }
    await store.writeIndex(cycleIndex);

    const summary = {
        id: cycle.id,
        tray: cycle.tray,
        cropName: cycle.cropName,
        startTime: cycle.startTime,
        endTime: cycle.endTime
    };

    console.log(`[Crops] Ended cycle ${cycle.id} (${cycle.cropName}) tray ${tray}, ${cycle.persistedCount} records`);
    activeCycles[tray] = null;
    return summary;
}

// ------------------------------------------------------------
//  บันทึกข้อมูล
// ------------------------------------------------------------

async function saveActiveCycles() {
    if (flushing) return;      // flush รอบก่อนยังไม่เสร็จ ข้ามไปก่อน
    flushing = true;

    try {
        let indexChanged = false;

        for (const tray of TRAYS) {
            const cycle = activeCycles[tray];
            if (!cycle) continue;

            const pending = cycle.records.slice(cycle.persistedCount);
            if (!pending.length) continue;

            const saved = await store.appendRecords(cycle.id, pending, cycle.records);
            if (saved < 0) continue;   // ล้มเหลว: ไม่ขยับตัวนับ รอบหน้าจะส่งซ้ำ

            cycle.persistedCount = saved;
            const entry = cycleIndex.find(c => c.id === cycle.id);
            if (entry && entry.recordCount !== saved) {
                entry.recordCount = saved;
                indexChanged = true;
            }
        }

        if (indexChanged) await store.writeIndex(cycleIndex);
    } finally {
        flushing = false;
    }
}

function recordCropData(data) {
    const targets = TRAYS.map(t => activeCycles[t]).filter(Boolean);
    if (!targets.length) return;

    const now = Date.now();
    if (now - lastRecordTime < RECORD_INTERVAL) return;
    lastRecordTime = now;

    // สร้าง record ครั้งเดียวแล้ว push reference เดียวกันลงทุกรอบ
    // (record ไม่เคยถูกแก้หลังสร้าง — ถ้าจะแก้ในอนาคตต้อง clone ก่อน)
    const point = {
        ts: new Date().toISOString(),
        t:  data.temperature,
        h:  data.humidity,
        l:  data.light,
        p:  data.ph,
        p2: data.ph2,
        v:  data.voltage,
        c:  data.current,
        pw: data.power,
        w:  [...data.waterLevel]
    };

    for (const cycle of targets) cycle.records.push(point);

    if (now - lastSaveTime > SAVE_INTERVAL) {
        lastSaveTime = now;
        // ยิงแล้วไม่รอ — POST /api/data ของ ESP32 ต้องตอบกลับทันที ห้ามรอ network
        saveActiveCycles().catch(e => console.error('[Crops] Flush error:', e.message));
    }
}

// ------------------------------------------------------------
//  อ่านรายละเอียดรอบปลูก
// ------------------------------------------------------------

async function getCycleDetail(id) {
    const tray = TRAYS.find(t => activeCycles[t] && activeCycles[t].id === id);
    if (tray) {
        const c = activeCycles[tray];
        return {
            id: c.id, tray: c.tray, cropName: c.cropName,
            startTime: c.startTime, endTime: null, status: 'active',
            records: c.records
        };
    }

    const entry = cycleIndex.find(c => c.id === id);
    if (!entry) return null;

    const records = await store.readRecords(id);
    if (records === null) return null;

    return {
        id: entry.id, tray: entry.tray, cropName: entry.cropName,
        startTime: entry.startTime, endTime: entry.endTime, status: entry.status,
        records
    };
}

module.exports = {
    TRAYS,
    TRAY_NAMES,
    RECORD_INTERVAL,
    ensureDataDir,
    loadIndex,
    loadActiveCyclesOnBoot,
    getCycleList,
    getActiveCycleSummary,
    getActiveCycleSummaries,
    startCycle,
    endCycle,
    saveActiveCycles,
    recordCropData,
    getCycleDetail
};
