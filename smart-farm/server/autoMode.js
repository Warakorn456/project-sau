// ============================================================
//  autoMode.js — Auto Mode logic (pH control, Flood & Drain)
// ============================================================

const state      = require('./state');
const stateStore = require('./stateStore');

// จำนวน Relay จริงบนบอร์ด — ต้องเท่ากับ RELAY_COUNT ใน smart_farm.ino และ RELAY_NAMES ใน dashboard.js
// R1 เติมลัง1  R2 เติมลัง2  R3 PHลัง1  R4 PHลัง2
// R5 วน1→ลัง1  R6 ลัง1→วน1  R7 วน2→ลัง2  R8 ลัง2→วน2
const RELAY_COUNT = 8;

// ============================================================
//  Auto Mode state
// ============================================================

let autoMode     = false;
// ค่าตั้งต้น — เก็บแยกไว้เพื่อให้ normalizeSettings() ดึงกลับมาใช้ได้เมื่อค่าที่โหลดจากไฟล์ใช้ไม่ได้
const DEFAULT_SETTINGS = {
    // pH — ถัง PH เป็นน้ำยาลด pH ปั๊มเดียวต่อลัง ทำงานเมื่อ pH สูงเกิน Max เท่านั้น
    // (phXMin เก็บไว้แสดงช่วงเป้าหมาย logic ไม่ได้ใช้)
    ph1Min: 5.5,  ph1Max: 7.0,  ph1Relay: 2,
    ph2Min: 5.5,  ph2Max: 7.0,  ph2Relay: 3,
    doseTime: 3,
    // น้ำเติมอัตโนมัติ ลัง1
    tray1RefillRelay:   0,
    tray1RefillMin:   180,
    tray1RefillMax:   200,
    tray1RefillSensor:  3,
    // น้ำเติมอัตโนมัติ ลัง2
    tray2RefillRelay:   1,
    tray2RefillMin:   180,
    tray2RefillMax:   200,
    tray2RefillSensor:  5,
    // วงจรน้ำ ลัง1 (Flood & Drain)
    // ลังปลูก: น้ำสูงสุดถึงราก 200 mm, สูบออกแค่ให้ต่ำกว่ารากนิดเดียว (วัดจริง 2026-10-24)
    tray1FillTarget:  200,
    tray1SoakTime:     30,
    tray1DrainTarget: 180,
    // ลูป AUTO (2026-10-26): ทุก IntervalMin นาที (นับจากเริ่มรอบก่อน) เปิดปั๊มเติมจนลูกลอยยก
    // (FillTime วินาที = เพดาน) → แช่ SoakTime นาที → สูบออก DrainTime วินาที · IntervalMin 0 = ปิด
    // FillTarget/DrainTarget/Refill* ของลังไม่ได้ใช้ใน logic แล้ว (เก็บไว้ให้ validation/simWater/ตัดลูกลอย)
    tray1IntervalMin: 360,
    tray1FillTime:   120,
    tray1DrainTime:  180,
    tray1FillRelay:   4,
    tray1DrainRelay:  5,
    tray1Sensor:      3,
    // วงจรน้ำ ลัง2
    tray2FillTarget:  200,
    tray2SoakTime:     30,
    tray2DrainTarget: 180,
    tray2IntervalMin: 360,
    tray2FillTime:   120,
    tray2DrainTime:  180,
    tray2FillRelay:   6,
    tray2DrainRelay:  7,
    tray2Sensor:      5,
    // ระดับน้ำทุกฟิลด์ข้างบนเป็น mm จากก้นถัง — ค่าที่บันทึกก่อนมีธงนี้เป็น %
    // (persistence.migrateWaterUnit แปลงให้ตอนโหลด)
    waterUnit: 'mm'
};
let autoSettings = { ...DEFAULT_SETTINGS };

// เรียกหลังโหลด auto-settings.json — ไฟล์เก่าอาจมี relay index 8/9 (สมัย 10 ตัว) หรือ key
// ph1UpRelay/ph1DownRelay ที่เลิกใช้แล้ว ถ้าปล่อยไว้จะเขียนเกินขอบ relayStates แบบเงียบๆ
function normalizeSettings() {
    for (const key of Object.keys(autoSettings)) {
        if (!(key in DEFAULT_SETTINGS)) {
            console.log(`[AutoSettings] ตัด key เก่า ${key}`);
            delete autoSettings[key];
            continue;
        }
        if (!key.endsWith('Relay')) continue;
        const v = autoSettings[key];
        const ok = v === -1 || (Number.isInteger(v) && v >= 0 && v < RELAY_COUNT);
        if (!ok) {
            console.log(`[AutoSettings] ${key}=${v} อยู่นอกช่วง 0..${RELAY_COUNT - 1} → ใช้ค่าตั้งต้น ${DEFAULT_SETTINGS[key]}`);
            autoSettings[key] = DEFAULT_SETTINGS[key];
        }
    }
}

let programState = { running: false, startTime: null, mode: 'manual' };

function getProgramStatus() {
    return { running: programState.running, startTime: programState.startTime, mode: programState.mode };
}

// ------------------------------------------------------------
//  สถานะโปรแกรมต้องรอด restart — Render restart/spin down ทีไร ถ้าไม่เก็บไว้
//  ฟาร์มจะกลับเป็น MANUAL เงียบๆ แล้วไม่มีใครดูแล pH / Flood & Drain ต่อ
//  เก็บเวลารอบถัดไปของแต่ละลังด้วย จะได้ไม่เลื่อนรอบออกไปอีก IntervalMin ทุกครั้งที่ restart
// ------------------------------------------------------------

function persistProgram() {
    const value = {
        running:   programState.running,
        startTime: programState.startTime,
        mode:      programState.mode,
        autoMode,
        trayNext:  trayState.map(st => st.nextTime || 0)
    };
    // ยิงแล้วไม่รอ — ห้ามให้ route หรือ timer ของปั๊มค้างเพราะรอ network
    stateStore.writeState('program', value)
        .catch(e => console.error('[Program] บันทึกสถานะไม่สำเร็จ:', e.message));
}

const RESUME_MIN_DELAY_MS = 60 * 1000;   // รอบที่เลยกำหนดไประหว่าง restart ให้เริ่มใน 1 นาที

async function restoreProgram() {
    const saved = await stateStore.readState('program');
    if (!saved || typeof saved !== 'object') return;

    programState.running   = !!saved.running;
    programState.startTime = saved.running ? saved.startTime || Date.now() : null;
    programState.mode      = saved.mode === 'auto' ? 'auto' : 'manual';
    autoMode = !!saved.autoMode;

    if (!autoMode) return;
    const now = Date.now();
    for (let i = 0; i < 2; i++) {
        const next = Array.isArray(saved.trayNext) ? Number(saved.trayNext[i]) || 0 : 0;
        scheduleTray(i, next > now ? next - now : RESUME_MIN_DELAY_MS);
    }
    console.log('[Program] กลับมาทำงาน AUTO ต่อหลัง restart');
}

const DOSE_COOLDOWN   = 5 * 60 * 1000;
const FILL_TIMEOUT_MS = 30 * 60 * 1000; // safety timeout ขณะเติมน้ำ
let lastDoseTime = 0;
let doseLabel    = '';

// ============================================================
//  Tray State (Flood & Drain)
// ============================================================

// phase: 'idle' | 'filling' | 'soaking' | 'draining'
// timer = ตัวจับเวลาของ phase ปัจจุบัน, nextTimer = รอบถัดไป (แยกกัน — รอบถัดไปนับจากเริ่มรอบนี้)
// alert = ข้อความเตือนล่าสุด (เติมไม่ถึงลูกลอย) ล้างเมื่อรอบถัดไปน้ำถึงลูกลอย
const newTrayState = () => ({ phase: 'idle', timer: null, nextTimer: null, phaseEndTime: 0, nextTime: 0, alert: null });
let trayState = [newTrayState(), newTrayState()];

function getTrayConfig(idx) {
    const s = autoSettings;
    return idx === 0
        ? { fillTarget: s.tray1FillTarget, soakTime: s.tray1SoakTime,
            drainTarget: s.tray1DrainTarget, intervalMin: s.tray1IntervalMin,
            fillTime: s.tray1FillTime,       drainTime: s.tray1DrainTime,
            fillRelay: s.tray1FillRelay,     drainRelay: s.tray1DrainRelay,
            refillRelay: s.tray1RefillRelay, sensor: s.tray1Sensor }
        : { fillTarget: s.tray2FillTarget, soakTime: s.tray2SoakTime,
            drainTarget: s.tray2DrainTarget, intervalMin: s.tray2IntervalMin,
            fillTime: s.tray2FillTime,       drainTime: s.tray2DrainTime,
            fillRelay: s.tray2FillRelay,     drainRelay: s.tray2DrainRelay,
            refillRelay: s.tray2RefillRelay, sensor: s.tray2Sensor };
}

// เวลาเปิดปั๊มของ filling/draining — ไม่เกิน safety timeout เดิม
function pumpMs(sec) {
    const n = Number(sec);
    return n > 0 ? Math.min(n * 1000, FILL_TIMEOUT_MS) : FILL_TIMEOUT_MS;
}

// io is stored lazily via setIO() so tray functions can use it
let _io = null;
function setIO(io) { _io = io; }

// ตั้งเวลาเริ่มรอบถัดไป — ไม่ระบุ delayMs = เต็ม IntervalMin
// ใช้ตอนเริ่มรอบ (startFilling), restore หลัง restart (เวลาที่เหลือ) และตอนบันทึกการตั้งค่า
function scheduleTray(idx, delayMs) {
    const st  = trayState[idx];
    const cfg = getTrayConfig(idx);
    clearTimeout(st.nextTimer);
    if (!autoMode || !(cfg.intervalMin > 0)) {
        st.nextTime = 0;
        persistProgram();
        return;
    }
    const ms = delayMs !== undefined ? delayMs : cfg.intervalMin * 60 * 1000;
    st.nextTime  = Date.now() + ms;
    st.nextTimer = setTimeout(() => {
        // validation กันไว้แล้ว (รอบเวลา > เติม+แช่+สูบ) — ถ้ายังทับกันก็ข้ามรอบนี้ ไม่ตัดรอบที่ทำอยู่
        if (st.phase !== 'idle') {
            console.warn(`[TRAY${idx+1}] ถึงเวลารอบใหม่แต่รอบก่อนยังไม่จบ (${st.phase}) — ข้ามไปรอบถัดไป`);
            scheduleTray(idx);
            return;
        }
        startFilling(idx);
    }, ms);
    if (_io) _io.emit('autoStatus', buildAutoStatus());
    persistProgram();
    console.log(`[TRAY${idx+1}] Next cycle in ${Math.round(ms / 60000)} min`);
}

// กด START / สลับเป็น AUTO → เริ่มปั๊มทั้ง 2 ลังทันที (ลังที่ IntervalMin = 0 ไม่ทำงาน)
function startAutoCycles() {
    for (let i = 0; i < 2; i++) {
        if (!(getTrayConfig(i).intervalMin > 0)) scheduleTray(i);
        else if (trayState[i].phase === 'idle') startFilling(i);
    }
}

function startFilling(idx) {
    if (!autoMode) return;
    const st  = trayState[idx];
    const cfg = getTrayConfig(idx);
    const ms = pumpMs(cfg.fillTime);
    clearTimeout(st.timer);
    st.phase        = 'filling';
    st.phaseEndTime = Date.now() + ms;
    if (cfg.fillRelay >= 0) state.relayStates[cfg.fillRelay] = true;
    scheduleTray(idx);   // รอบถัดไปนับจากตอนเริ่มเติม (start-to-start) — ตรงเวลาเสมอ
    _io.emit('relayUpdate', { relays: state.relayStates });
    _io.emit('autoStatus',  buildAutoStatus());
    console.log(`[TRAY${idx+1}] Filling สูงสุด ${ms / 1000}s (หยุดเมื่อลูกลอยยก)`);
    st.timer = setTimeout(() => fillTimedOut(idx), ms);
}

// เติมครบเวลาสูงสุดแล้วลูกลอยยังไม่ยก = น้ำในถังรองรับไม่พอ / ปั๊มหรือลูกลอยเสีย
// → ปิดปั๊ม แจ้งเตือน แล้วสูบน้ำคืนเลย (ไม่แช่ด้วยน้ำครึ่งๆ กลางๆ)
// ไม่มีข้อมูลลูกลอย (firmware เก่า) → แช่ตามเดิม เพราะไม่รู้ว่าน้ำถึงหรือยัง
function fillTimedOut(idx) {
    const cfg = getTrayConfig(idx);
    if (lastTrayFloat[idx] === null) {
        console.log(`[TRAY${idx+1}] Fill time up (ไม่มีข้อมูลลูกลอย) — แช่ตามปกติ`);
        startSoaking(idx);
        return;
    }
    if (cfg.fillRelay >= 0) state.relayStates[cfg.fillRelay] = false;
    const at = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
    trayState[idx].alert = `${at} น. เติม ${pumpMs(cfg.fillTime) / 1000} วินาทีแล้วน้ำไม่ถึงลูกลอย — สูบน้ำคืน (เช็คน้ำในถังรองรับ/ปั๊ม/ลูกลอย)`;
    console.warn(`[TRAY${idx+1}] ⚠️ น้ำไม่ถึงลูกลอยในเวลาที่ตั้ง — ข้ามการแช่ สูบน้ำคืน`);
    startDraining(idx);
}

function startSoaking(idx) {
    const st  = trayState[idx];
    const cfg = getTrayConfig(idx);
    clearTimeout(st.timer);
    if (cfg.fillRelay >= 0) state.relayStates[cfg.fillRelay] = false;
    st.phase        = 'soaking';
    st.phaseEndTime = Date.now() + cfg.soakTime * 60 * 1000;
    _io.emit('relayUpdate', { relays: state.relayStates });
    _io.emit('autoStatus',  buildAutoStatus());
    console.log(`[TRAY${idx+1}] Soaking ${cfg.soakTime} min`);
    st.timer = setTimeout(() => startDraining(idx), cfg.soakTime * 60 * 1000);
}

function startDraining(idx) {
    if (!autoMode) return;
    const st  = trayState[idx];
    const cfg = getTrayConfig(idx);
    const ms = pumpMs(cfg.drainTime);
    clearTimeout(st.timer);
    st.phase        = 'draining';
    st.phaseEndTime = Date.now() + ms;
    if (cfg.drainRelay >= 0) state.relayStates[cfg.drainRelay] = true;
    _io.emit('relayUpdate', { relays: state.relayStates });
    _io.emit('autoStatus',  buildAutoStatus());
    console.log(`[TRAY${idx+1}] Draining ${ms / 1000}s`);
    st.timer = setTimeout(() => {
        console.log(`[TRAY${idx+1}] Drain time up`);
        finishCycle(idx);
    }, ms);
}

// รอบถัดไปถูกตั้งไว้แล้วตั้งแต่ startFilling — ที่นี่แค่ปิดปั๊มแล้วกลับไปรอ
function finishCycle(idx) {
    const st  = trayState[idx];
    const cfg = getTrayConfig(idx);
    if (cfg.drainRelay >= 0) state.relayStates[cfg.drainRelay] = false;
    st.phase        = 'idle';
    st.phaseEndTime = 0;
    _io.emit('relayUpdate', { relays: state.relayStates });
    _io.emit('autoStatus',  buildAutoStatus());
    console.log(`[TRAY${idx+1}] Cycle complete`);
}

function stopAllTrays() {
    for (let i = 0; i < 2; i++) {
        const st  = trayState[i];
        const cfg = getTrayConfig(i);
        clearTimeout(st.timer);
        clearTimeout(st.nextTimer);
        if (st.phase !== 'idle') {
            if (cfg.fillRelay  >= 0) state.relayStates[cfg.fillRelay]  = false;
            if (cfg.drainRelay >= 0) state.relayStates[cfg.drainRelay] = false;
        }
        st.phase = 'idle';  st.phaseEndTime = 0;  st.nextTime = 0;
    }
}

// ลังปลูกวัดด้วยสวิตช์ลูกลอยที่ระดับเต็ม (2026-10-26 แทน SR04 ที่ติดระยะบอด)
// 1 = น้ำเต็ม, 0 = ยังไม่เต็ม, null = ไม่มีข้อมูล (firmware เก่า) — อ่านจาก trayFloat เท่านั้น
// ห้ามอ่าน waterLevel[3]/[5]: server ใส่ 0 ตอนไม่เต็ม ซึ่งไม่ได้แปลว่าลังว่าง
function trayFull(data, idx) {
    const f = Array.isArray(data.trayFloat) ? data.trayFloat[idx] : null;
    return f === 1 ? true : f === 0 ? false : null;
}

// ค่าลูกลอยล่าสุด — fillTimedOut ใช้แยกว่า "น้ำไม่ถึง" หรือ "ไม่มีข้อมูล"
let lastTrayFloat = [null, null];

// ลูกลอยยก = หยุดเติมแล้วเริ่มแช่ (FillTime เป็นเพดาน ดู fillTimedOut)
function checkTrayFilling(data) {
    lastTrayFloat = [0, 1].map(i => trayFull(data, i));
    if (!autoMode) return;
    for (let idx = 0; idx < 2; idx++) {
        if (trayState[idx].phase !== 'filling') continue;
        if (lastTrayFloat[idx] === true) {
            console.log(`[TRAY${idx+1}] ลูกลอยยก — น้ำเต็ม หยุดเติม`);
            trayState[idx].alert = null;
            startSoaking(idx);
        }
    }
}

// สูบออกใช้ DrainTime อย่างเดียว — ลูกลอยตัวเดียวที่ระดับเต็มบอกไม่ได้ว่าน้ำลดถึงไหน
function checkTrayDraining() {}

// กันน้ำล้นทั้ง AUTO และ MANUAL: ลูกลอยยกแล้วปั๊มเติมลัง (FillRelay/RefillRelay) ยังเปิดอยู่ → ปิด
// (กดปั๊มเองตอนจับเวลาแล้วลืม = น้ำล้นกล่องโฟม) เรียกหลังสุดใน /api/data ก่อนตอบ relayStates
// ปั๊มน้ำเปล่า R1/R2 ไม่อยู่ในลูป AUTO แล้ว (2026-10-26) — กดเองใน MANUAL แต่ยังถูกตัดตรงนี้
function enforceFloatCutoff(data) {
    let changed = false;
    for (let idx = 0; idx < 2; idx++) {
        if (trayFull(data, idx) !== true) continue;
        const cfg = getTrayConfig(idx);
        for (const r of [cfg.fillRelay, cfg.refillRelay]) {
            if (r >= 0 && state.relayStates[r]) {
                state.relayStates[r] = false;
                changed = true;
                console.log(`[FLOAT] ลัง${idx + 1} น้ำเต็ม → ปิด R${r + 1}`);
            }
        }
    }
    if (changed && _io) _io.emit('relayUpdate', { relays: state.relayStates });
}

// ============================================================
//  Auto Status
// ============================================================

function buildAutoStatus() {
    const now = Date.now();
    return {
        autoMode,
        autoSettings,
        doseLabel,
        doseCooldownIn: Math.max(0, (lastDoseTime + DOSE_COOLDOWN) - now),
        trayStatus: trayState.map(st => ({
            phase:       st.phase,
            phaseEndsIn: Math.max(0, st.phaseEndTime - now),
            nextCycleIn: st.nextTime ? Math.max(0, st.nextTime - now) : 0,
            alert:       st.alert
        }))
    };
}

// ============================================================
//  pH / Dose
// ============================================================

function activateDose(relayIdx, label) {
    if (relayIdx < 0 || relayIdx >= RELAY_COUNT) return;
    lastDoseTime  = Date.now();
    doseLabel     = label;
    state.relayStates[relayIdx] = true;
    _io.emit('relayUpdate', { relays: state.relayStates });
    _io.emit('autoStatus',  buildAutoStatus());
    console.log(`[AUTO] Dose ${label} → R${relayIdx + 1} (${autoSettings.doseTime}s)`);

    setTimeout(() => {
        state.relayStates[relayIdx] = false;
        doseLabel = '';
        _io.emit('relayUpdate', { relays: state.relayStates });
        _io.emit('autoStatus',  buildAutoStatus());
        console.log(`[AUTO] Dose done`);
    }, autoSettings.doseTime * 1000);
}

function checkPHControl(data) {
    if (!autoMode) return;
    if (Date.now() - lastDoseTime < DOSE_COOLDOWN) return;
    if (doseLabel) return;

    const ph1 = data.ph;
    const ph2 = data.ph2;

    // ph1/ph2 = null หมายถึง sensor error (probe หลุด/ลอย) — ห้ามโดสตามค่านี้
    // ถัง PH มีแต่น้ำยาลด pH → โดสเฉพาะตอน pH สูงเกิน Max; pH ต่ำทำอะไรไม่ได้
    if (ph1 != null && ph1 > autoSettings.ph1Max && autoSettings.ph1Relay >= 0) {
        activateDose(autoSettings.ph1Relay, `pH↓ ลัง1 (${ph1.toFixed(1)} > ${autoSettings.ph1Max})`);
    } else if (ph2 != null && ph2 > autoSettings.ph2Max && autoSettings.ph2Relay >= 0) {
        activateDose(autoSettings.ph2Relay, `pH↓ ลัง2 (${ph2.toFixed(1)} > ${autoSettings.ph2Max})`);
    }
}

module.exports = {
    // state refs (writable by routes)
    get autoMode()     { return autoMode; },
    set autoMode(v)    { autoMode = v; },
    get autoSettings() { return autoSettings; },
    set autoSettings(v){ autoSettings = v; },
    get programState() { return programState; },
    // constants
    RELAY_COUNT,
    DOSE_COOLDOWN,
    FILL_TIMEOUT_MS,
    // functions
    setIO,
    normalizeSettings,
    persistProgram,
    restoreProgram,
    DEFAULT_SETTINGS,
    getProgramStatus,
    getTrayConfig,
    scheduleTray,
    startAutoCycles,
    startFilling,
    startSoaking,
    startDraining,
    finishCycle,
    stopAllTrays,
    checkTrayFilling,
    checkTrayDraining,
    enforceFloatCutoff,
    buildAutoStatus,
    activateDose,
    checkPHControl,
    get trayState() { return trayState; }
};
