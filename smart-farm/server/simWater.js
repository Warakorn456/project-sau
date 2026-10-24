// ============================================================
//  simWater.js — ระดับน้ำจำลองบนหน้าจอสด (สวิตช์ในหน้าควบคุม, stateStore key 'simWater')
//
//  เซ็นเซอร์ SR04M-2 วัดน้ำในถังไม่ได้ (ระยะบอด → firmware ส่ง -1/-2) ผู้ใช้ขอให้การ์ดระดับน้ำ
//  ขึ้นตัวเลขตอนสาธิต (2026-10-24):
//    - ลังปลูก (idx 3/5): ขึ้น/ลงตามปั๊มที่เปิดอยู่จริง ระหว่าง DrainTarget..FillTarget
//      ด้วยอัตราที่ทำให้ครบช่วงพอดีใน FillTime/DrainTime ของวงจรน้ำ
//    - ถังอื่น: ค่าที่ admin กรอก (base)
//    - ทุกค่า ± jitter เล็กน้อย
//
//  ⚠️ ห้ามเขียนลง state.sensorData.waterLevel — Auto Mode / history / รอบปลูกอ่านจากตรงนั้น
//     ค่าจำลองออกทาง event 'waterSim' อย่างเดียว ปิดสวิตช์ = หน้าจอกลับเป็นค่าจริงทันที
// ============================================================

const state      = require('./state');
const stateStore = require('./stateStore');
const am         = require('./autoMode');
const { TANK_DEPTH_MM } = require('./public/js/sim-profiles');

const TICK_MS  = 1000;
const EMIT_MS  = 2000;
const JITTER   = 2;   // ± mm
const TRAYS = [
    { idx: 3, p: 'tray1' },
    { idx: 5, p: 'tray2' }
];

let config = { enabled: false, base: [150, 200, 200, 0, 150, 0] };
let level  = [0, 0, 0, 0, 0, 0];   // ระดับลังปลูกที่สะสมตามปั๊ม (ถังอื่นใช้ base)
let latest = null;

function trayRange(p) {
    const s   = am.autoSettings;
    const lo  = Number(s[`${p}DrainTarget`]) || 0;
    const hi  = Number(s[`${p}FillTarget`])  || lo;
    return { lo, hi: Math.max(lo, hi) };
}

function resetTrays() {
    TRAYS.forEach(({ idx, p }, i) => {
        const { lo, hi } = trayRange(p);
        level[idx] = am.trayState[i].phase === 'soaking' ? hi : lo;
    });
}

function relayOn(r) {
    return Number.isInteger(r) && r >= 0 && state.relayStates[r] === true;
}

function tick(dtSec) {
    const s = am.autoSettings;
    for (const { idx, p } of TRAYS) {
        const { lo, hi } = trayRange(p);
        const span = hi - lo;
        if (relayOn(s[`${p}FillRelay`]) || relayOn(s[`${p}RefillRelay`])) {
            level[idx] += span / Math.max(1, Number(s[`${p}FillTime`]) || 1) * dtSec;
        }
        if (relayOn(s[`${p}DrainRelay`])) {
            level[idx] -= span / Math.max(1, Number(s[`${p}DrainTime`]) || 1) * dtSec;
        }
        level[idx] = Math.min(hi, Math.max(lo, level[idx]));
    }
}

function snapshot() {
    const trayIdx = TRAYS.map(t => t.idx);
    const levels = TANK_DEPTH_MM.map((depth, i) => {
        const v = trayIdx.includes(i) ? level[i] : Number(config.base[i]) || 0;
        const j = (Math.random() * 2 - 1) * JITTER;
        return Math.round(Math.min(depth, Math.max(0, v + j)));
    });
    const raw = levels.map((mm, i) => TANK_DEPTH_MM[i] - mm);
    return { levels, raw };
}

function start(io) {
    let last = Date.now(), lastEmit = 0;
    setInterval(() => {
        const now = Date.now();
        if (config.enabled) {
            tick((now - last) / 1000);
            if (now - lastEmit >= EMIT_MS) {
                latest = snapshot();
                io.emit('waterSim', latest);
                lastEmit = now;
            }
        }
        last = now;
    }, TICK_MS);
}

async function loadOnBoot() {
    const saved = await stateStore.readState('simWater');
    if (saved && typeof saved === 'object') {
        config.enabled = saved.enabled === true;
        if (Array.isArray(saved.base) && saved.base.length === TANK_DEPTH_MM.length) config.base = saved.base;
    }
    resetTrays();
}

// คืน true/false ตามผลการบันทึก — route ตอบ 500 เองถ้าไม่สำเร็จ
async function setConfig(next) {
    if (!(await stateStore.writeState('simWater', next))) return false;
    const turnedOn = next.enabled && !config.enabled;
    config = next;
    if (turnedOn) resetTrays();
    latest = config.enabled ? snapshot() : null;
    return true;
}

module.exports = {
    start,
    loadOnBoot,
    setConfig,
    getConfig: () => config,
    getLatest: () => latest
};
