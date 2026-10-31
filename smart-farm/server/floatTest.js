// ============================================================
//  floatTest.js — โหมดทดสอบลูกลอย (2026-10-31 ผู้ใช้ขอ)
//  เติมจนลูกลอยยก (เต็ม) → แช่ soakSec วิ → สูบออกจนลูกลอยลง (ไม่เต็ม) → พัก restSec วิ → วนใหม่
//  แต่ละลังแยกกัน ทดสอบพร้อมกันได้ — แยกจากลูป AUTO (autoMode.js) เริ่มได้เฉพาะโหมด MANUAL
//  ใช้ FillRelay/DrainRelay ของลังจากการตั้งค่า AUTO
//  ไม่ persist: server restart = หยุดทดสอบ (relayStates เริ่มใหม่เป็นปิดหมดอยู่แล้ว)
// ============================================================

const state = require('./state');
const am    = require('./autoMode');

const PUMP_CAP_MS   = am.FILL_TIMEOUT_MS;   // ลูกลอยไม่เปลี่ยนภายในเวลานี้ = ปั๊ม/ลูกลอยมีปัญหา → หยุด
const CONFIRM_READS = 2;                    // ลูกลอยต้องอ่านได้ค่าเดิมติดกัน 2 รอบ — กันหน้าสัมผัสเด้งตอนน้ำกระเพื่อม
const DEFAULT_SEC   = 60;
const MAX_SEC       = 3600;

// phase: 'idle' | 'filling' | 'soaking' | 'draining' | 'resting'
const newTest = () => ({ phase: 'idle', phaseStart: 0, phaseEnd: 0, cycles: 0, alert: null, timer: null, hits: 0,
                         soakSec: DEFAULT_SEC, restSec: DEFAULT_SEC });
const tests = [newTest(), newTest()];
let _io = null;

function setIO(io) { _io = io; }

function getStatus() {
    const now = Date.now();
    return {
        trays: tests.map(t => ({
            phase:        t.phase,
            phaseElapsed: t.phaseStart ? now - t.phaseStart : 0,
            phaseEndsIn:  t.phaseEnd ? Math.max(0, t.phaseEnd - now) : 0,   // 0 = รอลูกลอย ไม่มีเวลากำหนด
            cycles:       t.cycles,
            alert:        t.alert,
            soakSec:      t.soakSec,
            restSec:      t.restSec
        }))
    };
}

function emit() {
    if (!_io) return;
    _io.emit('relayUpdate', { relays: state.relayStates });
    _io.emit('floatTest',   getStatus());
}

function relays(idx) {
    const cfg = am.getTrayConfig(idx);
    return { fill: cfg.fillRelay, drain: cfg.drainRelay };
}

function setRelay(r, on) { if (r >= 0) state.relayStates[r] = on; }

function enter(idx, phase, durationMs, onTimeout) {
    const t = tests[idx];
    clearTimeout(t.timer);
    t.phase      = phase;
    t.phaseStart = Date.now();
    t.phaseEnd   = durationMs ? t.phaseStart + durationMs : 0;
    t.hits       = 0;
    const { fill, drain } = relays(idx);
    setRelay(fill,  phase === 'filling');
    setRelay(drain, phase === 'draining');
    t.timer = setTimeout(onTimeout, durationMs || PUMP_CAP_MS);
    console.log(`[FloatTest] ลัง${idx + 1} รอบ ${t.cycles + 1}: ${phase}`);
    emit();
}

const capMin = PUMP_CAP_MS / 60000;
const startFill  = idx => enter(idx, 'filling', 0,
    () => stop(idx, `เติมนาน ${capMin} นาทีแล้วลูกลอยยังไม่ยก — หยุดทดสอบ (เช็คน้ำในถังรองรับ/ปั๊ม/ลูกลอย)`));
const startSoak  = idx => enter(idx, 'soaking', tests[idx].soakSec * 1000, () => startDrain(idx));
const startDrain = idx => enter(idx, 'draining', 0,
    () => stop(idx, `สูบออกนาน ${capMin} นาทีแล้วลูกลอยยังไม่ลง — หยุดทดสอบ`));
const startRest  = idx => enter(idx, 'resting', tests[idx].restSec * 1000,
    () => { tests[idx].cycles++; startFill(idx); });

function validSec(v) {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= MAX_SEC ? n : null;
}

// คืนข้อความ error หรือ null ถ้าเริ่มได้
function start(idx, soakSec, restSec) {
    if (am.autoMode) return 'ต้องอยู่โหมด MANUAL ก่อน (ลูป AUTO ใช้ปั๊มชุดเดียวกัน)';
    if (!state.sensorData.connected) return 'บอร์ด ESP32 Offline อยู่';
    const f = Array.isArray(state.sensorData.trayFloat) ? state.sensorData.trayFloat[idx] : null;
    if (f !== 0 && f !== 1) return 'บอร์ดยังไม่ส่งค่าลูกลอย (firmware เก่า)';
    const soak = validSec(soakSec), rest = validSec(restSec);
    if (soak === null || rest === null) return `เวลาแช่/พัก ต้องเป็นจำนวนเต็ม 1–${MAX_SEC} วินาที`;
    stop(idx, null);
    const t = tests[idx];
    t.cycles = 0;  t.alert = null;  t.soakSec = soak;  t.restSec = rest;
    // น้ำเต็มอยู่แล้ว = ข้ามไปแช่เลย ไม่งั้นเปิดปั๊มเติมแล้วรอลูกลอยที่ยกอยู่แล้ว
    if (f === 1) startSoak(idx); else startFill(idx);
    return null;
}

// reason = ข้อความที่จะโชว์ค้างไว้ (null = ผู้ใช้กดหยุดเอง)
function stop(idx, reason) {
    const t = tests[idx];
    if (t.phase === 'idle') return;
    clearTimeout(t.timer);
    const { fill, drain } = relays(idx);
    setRelay(fill, false);
    setRelay(drain, false);
    console.log(`[FloatTest] หยุด ลัง${idx + 1} หลังครบ ${t.cycles} รอบ${reason ? ` — ${reason}` : ''}`);
    t.phase = 'idle';  t.phaseStart = 0;  t.phaseEnd = 0;  t.timer = null;
    t.alert = reason;
    emit();
}

function stopAll(reason) { tests.forEach((_, i) => stop(i, reason)); }

// เรียกทุกครั้งที่บอร์ดส่งข้อมูล (/api/data) — ก่อน enforceFloatCutoff
function onData(data) {
    tests.forEach((t, idx) => {
        if (t.phase !== 'filling' && t.phase !== 'draining') return;
        const f = Array.isArray(data.trayFloat) ? data.trayFloat[idx] : null;
        const want = t.phase === 'filling' ? 1 : 0;
        t.hits = f === want ? t.hits + 1 : 0;
        if (t.hits < CONFIRM_READS) return;
        if (t.phase === 'filling') startSoak(idx); else startRest(idx);
    });
}

// relay r เป็นปั๊มของลังที่กำลังทดสอบอยู่ → index ลังนั้น ไม่งั้น -1
// (กดปั๊มเอง = ยกเลิกการทดสอบลังนั้น ไม่แย่งกันสั่ง relay)
function testTrayOfRelay(r) {
    return tests.findIndex((t, idx) => {
        if (t.phase === 'idle') return false;
        const { fill, drain } = relays(idx);
        return r === fill || r === drain;
    });
}

module.exports = { setIO, start, stop, stopAll, onData, getStatus, testTrayOfRelay };
