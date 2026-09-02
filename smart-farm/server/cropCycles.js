// ============================================================
//  cropCycles.js — เก็บข้อมูลเซ็นเซอร์ตลอดรอบปลูก (เริ่มปลูก → เก็บเกี่ยว)
//  แยกจาก history.json (ซึ่งเก็บแค่ 24 ชม.แล้ว evict ทิ้ง) — รอบปลูกนี้
//  เก็บทุก record ไว้จนกว่าจะเก็บเกี่ยว ไม่มีการลบทิ้งระหว่างทาง
// ============================================================

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const CROPS_DIR  = path.join(__dirname, 'data', 'crops');
const INDEX_FILE = path.join(CROPS_DIR, 'index.json');

const RECORD_INTERVAL = 60 * 1000;      // บันทึกทุก 1 นาที (เท่ากับ history)
const SAVE_INTERVAL   = 5 * 60 * 1000;  // เขียนไฟล์ทุก 5 นาที

let cycleIndex     = [];   // [{id, cropName, startTime, endTime, status, recordCount}]
let activeCycle    = null; // {id, cropName, startTime, endTime, records:[]}
let lastRecordTime = 0;
let lastSaveTime    = 0;

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
}

function saveIndex() {
    try {
        fs.writeFileSync(INDEX_FILE, JSON.stringify(cycleIndex, null, 2));
    } catch (e) {
        console.error('[Crops] Index save error:', e.message);
    }
}

function loadActiveCycleOnBoot() {
    loadIndex();
    const entry = cycleIndex.find(c => c.status === 'active');
    if (!entry) return;

    try {
        const records = fs.existsSync(cycleFile(entry.id))
            ? JSON.parse(fs.readFileSync(cycleFile(entry.id), 'utf8'))
            : [];
        activeCycle = {
            id: entry.id,
            cropName: entry.cropName,
            startTime: entry.startTime,
            endTime: null,
            records
        };
        console.log(`[Crops] Resumed cycle ${entry.id} (${entry.cropName}), ${records.length} records`);
    } catch (e) {
        console.error('[Crops] Failed to resume active cycle:', e.message);
    }
}

function getCycleList() {
    return [...cycleIndex].sort((a, b) => b.startTime - a.startTime);
}

function getActiveCycleSummary() {
    if (!activeCycle) return null;
    return { id: activeCycle.id, cropName: activeCycle.cropName, startTime: activeCycle.startTime };
}

function startCycle(cropName) {
    if (activeCycle) return null;

    const id = `cycle_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const startTime = Date.now();

    activeCycle = { id, cropName, startTime, endTime: null, records: [] };
    cycleIndex.push({ id, cropName, startTime, endTime: null, status: 'active', recordCount: 0 });
    saveIndex();

    try {
        fs.writeFileSync(cycleFile(id), '[]');
    } catch (e) {
        console.error('[Crops] Failed to create cycle file:', e.message);
    }

    console.log(`[Crops] Started cycle ${id} (${cropName})`);
    return getActiveCycleSummary();
}

function endCycle() {
    if (!activeCycle) return null;

    activeCycle.endTime = Date.now();

    try {
        fs.writeFileSync(cycleFile(activeCycle.id), JSON.stringify(activeCycle.records));
    } catch (e) {
        console.error('[Crops] Failed to save cycle file on end:', e.message);
    }

    const entry = cycleIndex.find(c => c.id === activeCycle.id);
    if (entry) {
        entry.endTime = activeCycle.endTime;
        entry.status = 'completed';
        entry.recordCount = activeCycle.records.length;
    }
    saveIndex();

    const summary = {
        id: activeCycle.id,
        cropName: activeCycle.cropName,
        startTime: activeCycle.startTime,
        endTime: activeCycle.endTime
    };

    console.log(`[Crops] Ended cycle ${activeCycle.id} (${activeCycle.cropName}), ${activeCycle.records.length} records`);
    activeCycle = null;
    return summary;
}

function saveActiveCycle() {
    if (!activeCycle) return;
    try {
        fs.writeFileSync(cycleFile(activeCycle.id), JSON.stringify(activeCycle.records));
        const entry = cycleIndex.find(c => c.id === activeCycle.id);
        if (entry) entry.recordCount = activeCycle.records.length;
        saveIndex();
    } catch (e) {
        console.error('[Crops] Save error:', e.message);
    }
}

function recordCropData(data) {
    if (!activeCycle) return;

    const now = Date.now();
    if (now - lastRecordTime < RECORD_INTERVAL) return;
    lastRecordTime = now;

    activeCycle.records.push({
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
    });

    if (now - lastSaveTime > SAVE_INTERVAL) {
        lastSaveTime = now;
        saveActiveCycle();
    }
}

function getCycleDetail(id) {
    if (activeCycle && activeCycle.id === id) {
        return {
            id: activeCycle.id,
            cropName: activeCycle.cropName,
            startTime: activeCycle.startTime,
            endTime: null,
            status: 'active',
            records: activeCycle.records
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
    ensureDataDir,
    loadIndex,
    loadActiveCycleOnBoot,
    getCycleList,
    getActiveCycleSummary,
    startCycle,
    endCycle,
    saveActiveCycle,
    recordCropData,
    getCycleDetail
};
