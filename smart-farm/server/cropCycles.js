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
// ============================================================

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const CROPS_DIR  = path.join(__dirname, 'data', 'crops');
const INDEX_FILE = path.join(CROPS_DIR, 'index.json');

const RECORD_INTERVAL = 60 * 1000;      // บันทึกทุก 1 นาที (เท่ากับ history)
const SAVE_INTERVAL   = 5 * 60 * 1000;  // เขียนไฟล์ทุก 5 นาที

const TRAYS      = [1, 2];
const TRAY_NAMES = { 1: 'ลังปลูกผัก 1', 2: 'ลังปลูกผัก 2' };

let cycleIndex   = [];  // [{id, tray, cropName, startTime, endTime, status, recordCount}]
let activeCycles = { 1: null, 2: null }; // แต่ละตัว {id, tray, cropName, startTime, endTime, records:[]}

// throttle ตัวเดียวใช้ร่วมกันทั้ง 2 ลังโดยตั้งใจ — ทุกลังจะได้ ts ตรงกันเป๊ะ
// และแชร์ object record ตัวเดียวกันได้ ไม่ต้องสร้างซ้ำ
let lastRecordTime = 0;
let lastSaveTime   = 0;

function cycleFile(id) {
    return path.join(CROPS_DIR, `${id}.json`);
}

function ensureDataDir() {
    fs.mkdirSync(CROPS_DIR, { recursive: true });
}

function loadIndex() {
    try {
        if (fs.existsSync(INDEX_FILE)) {
            cycleIndex = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('[Crops] Index load error:', e.message);
        cycleIndex = [];
    }

    // --- Migration: รอบปลูกเก่า (ก่อนมีระบบแยกลัง) นับเป็นลัง 1 ทั้งหมด ---
    // แตะแค่ index.json ไม่เคยเปิดไฟล์ record เลย และรันซ้ำได้ไม่มีผลข้างเคียง
    let migrated = 0;
    for (const e of cycleIndex) {
        if (e.tray !== 1 && e.tray !== 2) { e.tray = 1; migrated++; }
        if (e.status !== 'active' && e.status !== 'completed') {
            e.status = e.endTime ? 'completed' : 'active';
        }
    }
    if (migrated) {
        saveIndex();
        console.log(`[Crops] Migrated ${migrated} cycle(s) → tray 1`);
    }
}

function saveIndex() {
    try {
        fs.writeFileSync(INDEX_FILE, JSON.stringify(cycleIndex, null, 2));
    } catch (e) {
        console.error('[Crops] Index save error:', e.message);
    }
}

function loadActiveCyclesOnBoot() {
    loadIndex();

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

        // try/catch แยกรายลัง: ไฟล์ของลังหนึ่งเสียต้องไม่ทำให้อีกลังโหลดไม่ขึ้น
        try {
            const records = fs.existsSync(cycleFile(entry.id))
                ? JSON.parse(fs.readFileSync(cycleFile(entry.id), 'utf8'))
                : [];
            activeCycles[tray] = {
                id: entry.id,
                tray,
                cropName: entry.cropName,
                startTime: entry.startTime,
                endTime: null,
                records
            };
            console.log(`[Crops] Resumed cycle ${entry.id} (${entry.cropName}) tray ${tray}, ${records.length} records`);
        } catch (e) {
            console.error(`[Crops] Failed to resume active cycle for tray ${tray}:`, e.message);
        }
    }

    if (indexDirty) saveIndex();
}

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

function startCycle(cropName, tray) {
    if (!TRAYS.includes(tray)) return null;
    if (activeCycles[tray]) return null;

    // `_t1_` ในชื่อไฟล์เป็นแค่ป้ายให้คนอ่านออก — ลังอ่านจากฟิลด์ tray เสมอ
    // ห้าม parse ออกจาก id (รอบเก่าก่อน migration ไม่มีป้ายนี้)
    const id = `cycle_t${tray}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const startTime = Date.now();

    activeCycles[tray] = { id, tray, cropName, startTime, endTime: null, records: [] };
    cycleIndex.push({ id, tray, cropName, startTime, endTime: null, status: 'active', recordCount: 0 });
    saveIndex();

    try {
        fs.writeFileSync(cycleFile(id), '[]');
    } catch (e) {
        console.error('[Crops] Failed to create cycle file:', e.message);
    }

    console.log(`[Crops] Started cycle ${id} (${cropName}) tray ${tray}`);
    return getActiveCycleSummary(tray);
}

function endCycle(id) {
    const tray = TRAYS.find(t => activeCycles[t] && activeCycles[t].id === id);
    if (!tray) return null;

    const cycle = activeCycles[tray];
    cycle.endTime = Date.now();

    try {
        fs.writeFileSync(cycleFile(cycle.id), JSON.stringify(cycle.records));
    } catch (e) {
        console.error('[Crops] Failed to save cycle file on end:', e.message);
    }

    const entry = cycleIndex.find(c => c.id === cycle.id);
    if (entry) {
        entry.endTime     = cycle.endTime;
        entry.status      = 'completed';
        entry.recordCount = cycle.records.length;
    }
    saveIndex();

    const summary = {
        id: cycle.id,
        tray: cycle.tray,
        cropName: cycle.cropName,
        startTime: cycle.startTime,
        endTime: cycle.endTime
    };

    console.log(`[Crops] Ended cycle ${cycle.id} (${cycle.cropName}) tray ${tray}, ${cycle.records.length} records`);
    activeCycles[tray] = null;
    return summary;
}

function saveActiveCycles() {
    let wrote = false;

    for (const tray of TRAYS) {
        const cycle = activeCycles[tray];
        if (!cycle) continue;
        try {
            fs.writeFileSync(cycleFile(cycle.id), JSON.stringify(cycle.records));
            const entry = cycleIndex.find(c => c.id === cycle.id);
            if (entry) entry.recordCount = cycle.records.length;
            wrote = true;
        } catch (e) {
            console.error(`[Crops] Save error (tray ${tray}):`, e.message);
        }
    }

    if (wrote) saveIndex();   // เขียน index ครั้งเดียวหลังครบทุกลัง
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
        saveActiveCycles();
    }
}

function getCycleDetail(id) {
    const tray = TRAYS.find(t => activeCycles[t] && activeCycles[t].id === id);
    if (tray) {
        const c = activeCycles[tray];
        return {
            id: c.id,
            tray: c.tray,
            cropName: c.cropName,
            startTime: c.startTime,
            endTime: null,
            status: 'active',
            records: c.records
        };
    }

    const entry = cycleIndex.find(c => c.id === id);
    if (!entry) return null;

    try {
        const records = fs.existsSync(cycleFile(id))
            ? JSON.parse(fs.readFileSync(cycleFile(id), 'utf8'))
            : [];
        return {
            id: entry.id,
            tray: entry.tray,
            cropName: entry.cropName,
            startTime: entry.startTime,
            endTime: entry.endTime,
            status: entry.status,
            records
        };
    } catch (e) {
        console.error('[Crops] Failed to read cycle file:', e.message);
        return null;
    }
}

module.exports = {
    TRAYS,
    TRAY_NAMES,
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
