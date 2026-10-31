// ============================================================
//  floatTest.js — โหมดทดสอบลูกลอย (2026-10-31 ผู้ใช้ขอ)
//  เติมจนลูกลอยยก (เต็ม) → แช่ 1 นาที → สูบออกจนลูกลอยลง (ไม่เต็ม) → พัก 1 นาที → วนใหม่
//  แยกจากลูป AUTO (autoMode.js) — เริ่มได้เฉพาะโหมด MANUAL, ใช้ FillRelay/DrainRelay ของลังจากการตั้งค่า
//  ไม่ persist: server restart = หยุดทดสอบ (relayStates เริ่มใหม่เป็นปิดหมดอยู่แล้ว)
// ============================================================

const state = require('./state');
const am    = require('./autoMode');

const SOAK_MS    = 60 * 1000;
const REST_MS    = 60 * 1000;
const PUMP_CAP_MS = am.FILL_TIMEOUT_MS;   // ลูกลอยไม่เปลี่ยนภายในเวลานี้ = ปั๊ม/ลูกลอยมีปัญหา → หยุด
const CONFIRM_READS = 2;                  // ลูกลอยต้องอ่านได้ค่าเดิมติดกัน 2 รอบ — กันหน้าสัมผัสเด้งตอนน้ำกระเพื่อม

// phase: 'idle' | 'filling' | 'soaking' | 'draining' | 'resting'
let t = { tray: null, phase: 'idle', phaseStart: 0, phaseEnd: 0, cycles: 0, alert: null, timer: null, hits: 0 };
let _io = null;

function setIO(io) { _io = io; }

function getStatus() {
    const now = Date.now();
    return {
        tray:        t.tray === null ? null : t.tray + 1,
        phase:       t.phase,
        phaseElapsed: t.phaseStart ? now - t.phaseStart : 0,
        phaseEndsIn: t.phaseEnd ? Math.max(0, t.phaseEnd - now) : 0,   // 0 = รอลูกลอย ไม่มีเวลากำหนด
        cycles:      t.cycles,
        alert:       t.alert
    };
}

function emit() {
    if (!_io) return;
    _io.emit('relayUpdate', { relays: state.relayStates });
    _io.emit('floatTest',   getStatus());
}

function relays() {
    const cfg = am.getTrayConfig(t.tray);
    return { fill: cfg.fillRelay, drain: cfg.drainRelay };
}

function setRelay(r, on) { if (r >= 0) state.relayStates[r] = on; }

function enter(phase, durationMs, onTimeout) {
    clearTimeout(t.timer);
    t.phase      = phase;
    t.phaseStart = Date.now();
    t.phaseEnd   = durationMs ? t.phaseStart + durationMs : 0;
    t.hits       = 0;
    const { fill, drain } = relays();
    setRelay(fill,  phase === 'filling');
    setRelay(drain, phase === 'draining');
    t.timer = setTimeout(onTimeout, durationMs || PUMP_CAP_MS);
    console.log(`[FloatTest] ลัง${t.tray + 1} รอบ ${t.cycles + 1}: ${phase}`);
    emit();
}

const startFill  = () => enter('filling',  0, () => stop(`เติมนาน ${PUMP_CAP_MS / 60000} นาทีแล้วลูกลอยยังไม่ยก — หยุดทดสอบ (เช็คน้ำในถังรองรับ/ปั๊ม/ลูกลอย)`));
const startSoak  = () => enter('soaking',  SOAK_MS, startDrain);
const startDrain = () => enter('draining', 0, () => stop(`สูบออกนาน ${PUMP_CAP_MS / 60000} นาทีแล้วลูกลอยยังไม่ลง — หยุดทดสอบ`));
const startRest  = () => enter('resting',  REST_MS, () => { t.cycles++; startFill(); });

// คืนข้อความ error หรือ null ถ้าเริ่มได้
function start(trayIdx) {
    if (am.autoMode) return 'ต้องอยู่โหมด MANUAL ก่อน (ลูป AUTO ใช้ปั๊มชุดเดียวกัน)';
    if (!state.sensorData.connected) return 'บอร์ด ESP32 Offline อยู่';
    const f = Array.isArray(state.sensorData.trayFloat) ? state.sensorData.trayFloat[trayIdx] : null;
    if (f !== 0 && f !== 1) return 'บอร์ดยังไม่ส่งค่าลูกลอย (firmware เก่า)';
    if (t.phase !== 'idle') stop(null);
    t.tray   = trayIdx;
    t.cycles = 0;
    t.alert  = null;
    // น้ำเต็มอยู่แล้ว = ข้ามไปแช่เลย ไม่งั้นเปิดปั๊มเติมแล้วรอลูกลอยที่ยกอยู่แล้ว
    if (f === 1) startSoak(); else startFill();
    return null;
}

// reason = ข้อความที่จะโชว์ค้างไว้ (null = ผู้ใช้กดหยุดเอง)
function stop(reason) {
    if (t.phase === 'idle') return;
    clearTimeout(t.timer);
    const { fill, drain } = relays();
    setRelay(fill, false);
    setRelay(drain, false);
    console.log(`[FloatTest] หยุด ลัง${t.tray + 1} หลังครบ ${t.cycles} รอบ${reason ? ` — ${reason}` : ''}`);
    t.phase = 'idle';  t.phaseStart = 0;  t.phaseEnd = 0;  t.timer = null;
    t.alert = reason;
    emit();
}

// เรียกทุกครั้งที่บอร์ดส่งข้อมูล (/api/data) — ก่อน enforceFloatCutoff
function onData(data) {
    if (t.phase !== 'filling' && t.phase !== 'draining') return;
    const f = Array.isArray(data.trayFloat) ? data.trayFloat[t.tray] : null;
    const want = t.phase === 'filling' ? 1 : 0;
    t.hits = f === want ? t.hits + 1 : 0;
    if (t.hits < CONFIRM_READS) return;
    if (t.phase === 'filling') startSoak(); else startRest();
}

// ปั๊มของลังที่ทดสอบอยู่ถูกกดเอง → ยกเลิกการทดสอบ (ไม่แย่งกันสั่ง relay)
function isTestRelay(r) {
    if (t.phase === 'idle') return false;
    const { fill, drain } = relays();
    return r === fill || r === drain;
}

module.exports = { setIO, start, stop, onData, getStatus, isTestRelay };
