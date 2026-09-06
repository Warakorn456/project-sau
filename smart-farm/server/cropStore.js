// ============================================================
//  cropStore.js — ชั้นเก็บข้อมูลรอบปลูก สลับได้ 2 แบบ
//
//  1) ไฟล์ (ค่าเริ่มต้น)  — ใช้ตอนรันในเครื่อง ไม่ต้องตั้งอะไรเพิ่ม
//  2) Supabase (Postgres) — ใช้ตอน deploy เมื่อมี SUPABASE_URL + SUPABASE_SERVICE_KEY
//
//  ทำไมต้องมี: Render free instance ต่อ persistent disk ไม่ได้ (เป็นของ paid เท่านั้น)
//  ไฟล์ที่เขียนตอนรันหายทุกครั้งที่ redeploy / restart / spin down หลังไม่มี traffic 15 นาที
//  รอบปลูกใช้เวลา ~20 วัน จึงต้องเก็บนอกเครื่อง ไม่งั้นไฟดับทีเดียวข้อมูลหายทั้งรอบ
//
//  คุยกับ Supabase ผ่าน REST (PostgREST) ด้วย fetch ที่มีมากับ Node 18+
//  จึงไม่ต้องเพิ่ม dependency ใหม่เลย
//
//  ทุกฟังก์ชันกลืน error เองและคืนค่าปลอดภัย — ระบบรดน้ำต้องไม่ล้มเพราะฐานข้อมูลล่ม
// ============================================================

const path = require('path');
const fs   = require('fs');

const CROPS_DIR  = path.join(__dirname, 'data', 'crops');
const INDEX_FILE = path.join(CROPS_DIR, 'index.json');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const useSupabase  = Boolean(SUPABASE_URL && SUPABASE_KEY);

const PAGE_SIZE = 1000;   // PostgREST ของ Supabase จำกัดแถวต่อ request — ต้องแบ่งหน้าอ่าน

function cycleFile(id) {
    return path.join(CROPS_DIR, `${id}.json`);
}

function describe() {
    return useSupabase ? `Supabase (${SUPABASE_URL})` : `ไฟล์ในเครื่อง (${CROPS_DIR})`;
}

// ------------------------------------------------------------
//  Supabase helpers
// ------------------------------------------------------------

async function sbFetch(pathAndQuery, options = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
        ...options,
        headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`${res.status} ${res.statusText} ${body.slice(0, 200)}`);
    }
    return res;
}

// แปลงระหว่างรูปแบบใน JS กับคอลัมน์ใน Postgres
const rowToCycle = r => ({
    id: r.id, tray: r.tray, cropName: r.crop_name,
    startTime: Number(r.start_time),
    endTime: r.end_time === null ? null : Number(r.end_time),
    status: r.status, recordCount: r.record_count
});
const cycleToRow = c => ({
    id: c.id, tray: c.tray, crop_name: c.cropName,
    start_time: c.startTime, end_time: c.endTime,
    status: c.status, record_count: c.recordCount || 0
});
const rowToRecord = r => ({
    ts: r.ts, t: r.t, h: r.h, l: r.l, p: r.p, p2: r.p2,
    v: r.v, c: r.c, pw: r.pw, w: r.w || []
});
const recordToRow = (cycleId, rec) => ({
    cycle_id: cycleId, ts: rec.ts,
    t: rec.t, h: rec.h, l: rec.l, p: rec.p, p2: rec.p2,
    v: rec.v, c: rec.c, pw: rec.pw, w: rec.w
});

// ------------------------------------------------------------
//  API ของ store
// ------------------------------------------------------------

function ensureDataDir() {
    // สร้างโฟลเดอร์เสมอ แม้ใช้ Supabase — เผื่อ fallback ตอน Supabase ล่ม
    try { fs.mkdirSync(CROPS_DIR, { recursive: true }); } catch (e) { /* ไม่เป็นไร */ }
}

async function readIndex() {
    if (useSupabase) {
        try {
            const res  = await sbFetch('crop_cycles?select=*&order=start_time.desc');
            const rows = await res.json();
            return rows.map(rowToCycle);
        } catch (e) {
            console.error('[CropStore] อ่าน index จาก Supabase ไม่สำเร็จ:', e.message);
            return null;   // null = อ่านไม่ได้ (ต่างจาก [] ที่แปลว่าไม่มีรอบปลูก)
        }
    }

    try {
        if (fs.existsSync(INDEX_FILE)) {
            return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
        }
        return [];
    } catch (e) {
        console.error('[CropStore] อ่าน index จากไฟล์ไม่สำเร็จ:', e.message);
        return null;
    }
}

async function writeIndex(index) {
    if (useSupabase) {
        try {
            if (!index.length) return true;
            await sbFetch('crop_cycles', {
                method: 'POST',
                headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
                body: JSON.stringify(index.map(cycleToRow))
            });
            return true;
        } catch (e) {
            console.error('[CropStore] เขียน index ลง Supabase ไม่สำเร็จ:', e.message);
            return false;
        }
    }

    try {
        fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
        return true;
    } catch (e) {
        console.error('[CropStore] เขียน index ลงไฟล์ไม่สำเร็จ:', e.message);
        return false;
    }
}

async function readRecords(cycleId) {
    if (useSupabase) {
        const out = [];
        try {
            for (let offset = 0; ; offset += PAGE_SIZE) {
                const q = `crop_records?cycle_id=eq.${encodeURIComponent(cycleId)}` +
                          `&select=ts,t,h,l,p,p2,v,c,pw,w&order=ts.asc` +
                          `&limit=${PAGE_SIZE}&offset=${offset}`;
                const rows = await (await sbFetch(q)).json();
                out.push(...rows.map(rowToRecord));
                if (rows.length < PAGE_SIZE) break;
            }
            return out;
        } catch (e) {
            console.error('[CropStore] อ่าน records จาก Supabase ไม่สำเร็จ:', e.message);
            return null;
        }
    }

    try {
        return fs.existsSync(cycleFile(cycleId))
            ? JSON.parse(fs.readFileSync(cycleFile(cycleId), 'utf8'))
            : [];
    } catch (e) {
        console.error('[CropStore] อ่าน records จากไฟล์ไม่สำเร็จ:', e.message);
        return null;
    }
}

function createCycleStorage(cycleId) {
    if (useSupabase) return;   // แถวจะถูกสร้างตอน insert ไม่ต้องเตรียมอะไร
    try {
        fs.writeFileSync(cycleFile(cycleId), '[]');
    } catch (e) {
        console.error('[CropStore] สร้างไฟล์รอบปลูกไม่สำเร็จ:', e.message);
    }
}

// เขียน record ลง store
//   Supabase : ส่งเฉพาะ newRecords (append เข้าไป) — ประหยัดแบนด์วิดท์
//   ไฟล์     : เขียนทับด้วย allRecords ทั้งก้อน (ไฟล์ append ทีละบรรทัดไม่ได้)
// คืนจำนวน record ที่ persist สำเร็จแล้วทั้งหมด หรือ -1 ถ้าล้มเหลว
async function appendRecords(cycleId, newRecords, allRecords) {
    if (useSupabase) {
        if (!newRecords.length) return allRecords.length;
        try {
            // merge-duplicates กัน insert ซ้ำถ้า flush รอบก่อนสำเร็จบางส่วนแล้ว retry
            await sbFetch('crop_records', {
                method: 'POST',
                headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
                body: JSON.stringify(newRecords.map(r => recordToRow(cycleId, r)))
            });
            return allRecords.length;
        } catch (e) {
            console.error(`[CropStore] เขียน ${newRecords.length} records ลง Supabase ไม่สำเร็จ:`, e.message);
            return -1;   // ไม่ขยับตัวนับ รอบหน้าจะส่งซ้ำรวมของเดิม
        }
    }

    try {
        fs.writeFileSync(cycleFile(cycleId), JSON.stringify(allRecords));
        return allRecords.length;
    } catch (e) {
        console.error('[CropStore] เขียน records ลงไฟล์ไม่สำเร็จ:', e.message);
        return -1;
    }
}

// เช็คว่าต่อ Supabase ได้จริงตอน boot — จะได้รู้ทันทีไม่ใช่ตอนข้อมูลหายไปแล้ว
async function healthCheck() {
    if (!useSupabase) return { ok: true, mode: 'file' };
    try {
        await sbFetch('crop_cycles?select=id&limit=1');
        return { ok: true, mode: 'supabase' };
    } catch (e) {
        return { ok: false, mode: 'supabase', error: e.message };
    }
}

module.exports = {
    useSupabase,
    describe,
    ensureDataDir,
    readIndex,
    writeIndex,
    readRecords,
    createCycleStorage,
    appendRecords,
    healthCheck
};
