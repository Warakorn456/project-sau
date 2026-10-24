// ============================================================
//  simWater.js — ระดับน้ำจำลองบนหน้าจอสด (สวิตช์ในหน้าควบคุม, stateStore key 'simWater')
//
//  เซ็นเซอร์ SR04M-2 วัดน้ำในถังไม่ได้ (ระยะบอด → firmware ส่ง -1/-2) ผู้ใช้ขอ (2026-10-24):
//    - ทุกถังเป็นค่าจำลอง ขยับตามปั๊มที่เปิดอยู่จริง (relayStates) แบบลื่นๆ
//      ลังปลูก: ขึ้นตอนปั๊มเติม/เติมน้ำเปล่า ลงตอนสูบออก ระหว่าง DrainTarget..FillTarget
//      ถังรองรับน้ำ: สวนทางกับลังของตัวเอง ×RES_RATIO · ถังน้ำเปล่า: ลดตอนปั๊มเติมน้ำเปล่า · ถัง pH: ลดตอนโดส
//    - เอามือบังหน้าเซ็นเซอร์ (ยกออกมา) แล้วโชว์ระยะจริง — ใช้ waterRaw จริงเมื่อพ้นระยะบอด (realRawOk)
//
//  ⚠️ ห้ามเขียนลง state.sensorData.waterLevel — Auto Mode / history / รอบปลูกอ่านจากตรงนั้น
//     ค่าจำลองออกทาง event 'waterSim' อย่างเดียว ปิดสวิตช์ = หน้าจอกลับเป็นค่าจริงทันที
// ============================================================

const state      = require('./state');
const stateStore = require('./stateStore');
const am         = require('./autoMode');
const { TANK_DEPTH_MM } = require('./public/js/sim-profiles');

// หน้าเซ็นเซอร์ → ผิวน้ำตอนเต็ม — ต้องตรงกับ SENSOR_GAP_MM ใน smart_farm.ino
const SENSOR_GAP_MM = [120, 120, 120, 50, 120, 50];
const BLIND_MM      = 240;   // ตรงกับ BLIND_MM ใน smart_farm.ino
const TRAY_REAL_MARGIN = 30; // ในลังเจอค่าเพี้ยนเลยก้นลัง 249–274 mm → ต้องไกลกว่าก้น +30 ถึงเชื่อว่ายกออกมาแล้ว

const TICK_MS   = 1000;
const RES_RATIO = 3;     // ลังขึ้น 1 mm = ขวดลด 3 mm (กล่องโฟมกว้างกว่าขวดมาก)
const PH_DOSE_MM_PER_S = 0.5;
const TRAYS = [
    { idx: 3, p: 'tray1', reservoir: 4, ph: 'ph1Relay' },
    { idx: 5, p: 'tray2', reservoir: 0, ph: 'ph2Relay' }
];
const FRESH_IDX = 2;
const PH_IDX    = 1;

let config = { enabled: false, base: [150, 200, 200, 0, 150, 0] };
let level  = [0, 0, 0, 0, 0, 0];   // ระดับจำลองสะสม (mm)
let noise  = [0, 0, 0, 0, 0, 0];   // random walk ต่อถัง ให้ตัวเลขไหวเบาๆ ไม่กระโดด
let latest = null;

const clamp = (v, i) => Math.min(TANK_DEPTH_MM[i], Math.max(0, v));

function trayRange(p) {
    const s  = am.autoSettings;
    const lo = Number(s[`${p}DrainTarget`]) || 0;
    const hi = Number(s[`${p}FillTarget`])  || lo;
    return { lo, hi: Math.max(lo, hi) };
}

function resetLevels() {
    level = TANK_DEPTH_MM.map((_, i) => clamp(Number(config.base[i]) || 0, i));
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
    for (const { idx, p, reservoir, ph } of TRAYS) {
        const { lo, hi } = trayRange(p);
        const span = hi - lo;
        // เปลี่ยนช่วง (FillTarget/DrainTarget) แล้วลังถูกดันเข้าช่วงใหม่ — ไม่ใช่น้ำจากปั๊ม ห้ามไปหักจากถังรองรับ
        level[idx] = Math.min(hi, Math.max(lo, level[idx]));
        const before = level[idx];
        const fromRefill = relayOn(s[`${p}RefillRelay`]);
        if (relayOn(s[`${p}FillRelay`]) || fromRefill) {
            level[idx] += span / Math.max(1, Number(s[`${p}FillTime`]) || 1) * dtSec;
        }
        if (relayOn(s[`${p}DrainRelay`])) {
            level[idx] -= span / Math.max(1, Number(s[`${p}DrainTime`]) || 1) * dtSec;
        }
        level[idx] = Math.min(hi, Math.max(lo, level[idx]));

        // น้ำที่ลังได้/เสียมาจากถังไหน — เติมน้ำเปล่าเอาจากถังน้ำเปล่า, วงจรน้ำแลกกับถังรองรับ
        const gained = level[idx] - before;
        const src = fromRefill && gained > 0 ? FRESH_IDX : reservoir;
        level[src] = clamp(level[src] - gained * RES_RATIO, src);

        if (relayOn(s[ph])) level[PH_IDX] = clamp(level[PH_IDX] - PH_DOSE_MM_PER_S * dtSec, PH_IDX);
    }
    noise = noise.map(n => Math.max(-1.5, Math.min(1.5, (n + (Math.random() - 0.5) * 0.6) * 0.9)));
}

// ระยะจริงจากเซ็นเซอร์ใช้ได้ไหม — พ้นระยะบอด (ขวด) / ไกลกว่าก้นลังชัดเจน (ลัง = ยกออกมาวัด)
function realRawOk(i, raw, mount) {
    if (!(raw >= 0)) return false;
    const isTray = TRAYS.some(t => t.idx === i);
    return isTray ? raw >= mount + TRAY_REAL_MARGIN : raw >= BLIND_MM;
}

function snapshot() {
    const sd = state.sensorData || {};
    const realRaw = sd.connected && Array.isArray(sd.waterRaw) ? sd.waterRaw : [];
    const levels = [], raw = [];
    TANK_DEPTH_MM.forEach((depth, i) => {
        const mount = depth + SENSOR_GAP_MM[i];
        const r = realRaw[i];
        if (realRawOk(i, r, mount)) {
            raw[i]    = Math.round(r);
            levels[i] = Math.round(clamp(mount - r, i));
        } else {
            levels[i] = Math.round(clamp(level[i] + noise[i], i));
            raw[i]    = mount - levels[i];
        }
    });
    return { levels, raw };
}

function start(io) {
    let last = Date.now();
    setInterval(() => {
        const now = Date.now();
        if (config.enabled) {
            tick((now - last) / 1000);
            latest = snapshot();
            io.emit('waterSim', latest);
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
    resetLevels();
}

// คืน true/false ตามผลการบันทึก — route ตอบ 500 เองถ้าไม่สำเร็จ
// เปิดสวิตช์ / กดบันทึกระดับน้ำ = ตั้งระดับขวดกลับไปที่ base (ลังกลับไปตามช่วงของวงจรน้ำ)
async function setConfig(next) {
    if (!(await stateStore.writeState('simWater', next))) return false;
    config = next;
    if (config.enabled) resetLevels();
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
