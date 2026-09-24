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
    tray1RefillMin:    20,
    tray1RefillMax:    80,
    tray1RefillSensor:  3,
    // น้ำเติมอัตโนมัติ ลัง2
    tray2RefillRelay:   1,
    tray2RefillMin:    20,
    tray2RefillMax:    80,
    tray2RefillSensor:  5,
    // วงจรน้ำ ลัง1 (Flood & Drain)
    tray1FillTarget:   80,
    tray1SoakTime:     30,
    tray1DrainTarget:  20,
    tray1CycleHours:   6,
    tray1FillRelay:   4,
    tray1DrainRelay:  5,
    tray1Sensor:      3,
    // วงจรน้ำ ลัง2
    tray2FillTarget:   80,
    tray2SoakTime:     30,
    tray2DrainTarget:  20,
    tray2CycleHours:   6,
    tray2FillRelay:   6,
    tray2DrainRelay:  7,
    tray2Sensor:      5
};
let autoSettings = { ...DEFAULT_SETTINGS };
let refillActive = [false, false];

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
//  เก็บเวลารอบถัดไปของแต่ละลังด้วย จะได้ไม่เลื่อนรอบออกไปอีก cycleHours ทุกครั้งที่ restart
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
let trayState = [
    { phase: 'idle', timer: null, phaseEndTime: 0, nextTime: 0 },
    { phase: 'idle', timer: null, phaseEndTime: 0, nextTime: 0 }
];

function getTrayConfig(idx) {
    const s = autoSettings;
    return idx === 0
        ? { fillTarget: s.tray1FillTarget, soakTime: s.tray1SoakTime,
            drainTarget: s.tray1DrainTarget, cycleHours: s.tray1CycleHours,
            fillRelay: s.tray1FillRelay,     drainRelay: s.tray1DrainRelay,
            sensor: s.tray1Sensor }
        : { fillTarget: s.tray2FillTarget, soakTime: s.tray2SoakTime,
            drainTarget: s.tray2DrainTarget, cycleHours: s.tray2CycleHours,
            fillRelay: s.tray2FillRelay,     drainRelay: s.tray2DrainRelay,
            sensor: s.tray2Sensor };
}

// io is stored lazily via setIO() so tray functions can use it
let _io = null;
function setIO(io) { _io = io; }

// delayMs ใช้ตอนกลับมาหลัง restart (เวลาที่เหลือของรอบเดิม) — ปกติรอเต็ม cycleHours
function scheduleTray(idx, delayMs) {
    const st  = trayState[idx];
    const cfg = getTrayConfig(idx);
    clearTimeout(st.timer);
    if (!autoMode || cfg.cycleHours <= 0) {
        st.nextTime = 0;
        persistProgram();
        return;
    }
    const ms  = delayMs !== undefined ? delayMs : cfg.cycleHours * 3600 * 1000;
    st.nextTime = Date.now() + ms;
    st.timer    = setTimeout(() => startFilling(idx), ms);
    if (_io) _io.emit('autoStatus', buildAutoStatus());
    persistProgram();
    console.log(`[TRAY${idx+1}] Next cycle in ${(ms / 3600000).toFixed(2)}h`);
}

function startFilling(idx) {
    if (!autoMode) return;
    const st  = trayState[idx];
    const cfg = getTrayConfig(idx);
    st.phase        = 'filling';
    st.nextTime     = 0;
    st.phaseEndTime = Date.now() + FILL_TIMEOUT_MS;
    stopRefillIfNotAllowed(idx);
    if (cfg.fillRelay >= 0) state.relayStates[cfg.fillRelay] = true;
    _io.emit('relayUpdate', { relays: state.relayStates });
    _io.emit('autoStatus',  buildAutoStatus());
    console.log(`[TRAY${idx+1}] Filling → target ${cfg.fillTarget}%`);
    st.timer = setTimeout(() => {
        console.log(`[TRAY${idx+1}] Fill timeout — moving to soak`);
        startSoaking(idx);
    }, FILL_TIMEOUT_MS);
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
    st.phase        = 'draining';
    st.phaseEndTime = Date.now() + FILL_TIMEOUT_MS;
    stopRefillIfNotAllowed(idx);   // ห้ามเติมน้ำใหม่เข้าลังระหว่างระบายออก
    if (cfg.drainRelay >= 0) state.relayStates[cfg.drainRelay] = true;
    _io.emit('relayUpdate', { relays: state.relayStates });
    _io.emit('autoStatus',  buildAutoStatus());
    console.log(`[TRAY${idx+1}] Draining → target ${cfg.drainTarget}%`);
    st.timer = setTimeout(() => {
        console.log(`[TRAY${idx+1}] Drain safety timeout`);
        finishCycle(idx);
    }, FILL_TIMEOUT_MS);
}

function finishCycle(idx) {
    const st  = trayState[idx];
    const cfg = getTrayConfig(idx);
    if (cfg.drainRelay >= 0) state.relayStates[cfg.drainRelay] = false;
    st.phase        = 'idle';
    st.phaseEndTime = 0;
    stopRefillIfNotAllowed(idx);
    _io.emit('relayUpdate', { relays: state.relayStates });
    console.log(`[TRAY${idx+1}] Cycle complete`);
    scheduleTray(idx);
}

function stopAllTrays() {
    for (let i = 0; i < 2; i++) {
        const st  = trayState[i];
        const cfg = getTrayConfig(i);
        clearTimeout(st.timer);
        if (st.phase !== 'idle') {
            if (cfg.fillRelay  >= 0) state.relayStates[cfg.fillRelay]  = false;
            if (cfg.drainRelay >= 0) state.relayStates[cfg.drainRelay] = false;
        }
        st.phase = 'idle';  st.phaseEndTime = 0;  st.nextTime = 0;
    }
}

function checkTrayFilling(data) {
    if (!autoMode) return;
    for (let idx = 0; idx < 2; idx++) {
        if (trayState[idx].phase !== 'filling') continue;
        const cfg   = getTrayConfig(idx);
        const level = (data.waterLevel || [])[cfg.sensor];
        if (typeof level === 'number' && level >= cfg.fillTarget) {
            console.log(`[TRAY${idx+1}] Level ${level}% reached target ${cfg.fillTarget}%`);
            startSoaking(idx);
        }
    }
}

function checkTrayDraining(data) {
    if (!autoMode) return;
    for (let idx = 0; idx < 2; idx++) {
        if (trayState[idx].phase !== 'draining') continue;
        const cfg   = getTrayConfig(idx);
        const level = (data.waterLevel || [])[cfg.sensor];
        if (typeof level === 'number' && level >= 0 && level <= cfg.drainTarget) {
            console.log(`[TRAY${idx+1}] Level ${level.toFixed(1)}% reached drain target ${cfg.drainTarget}%`);
            finishCycle(idx);
        }
    }
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
            nextCycleIn: st.phase === 'idle' ? Math.max(0, st.nextTime - now) : 0
        }))
    };
}

// ============================================================
//  pH / Dose / Refill
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

// ------------------------------------------------------------
//  เติมน้ำ (R1/R2) — ปั๊มเติมน้ำจากถังน้ำเติม "เข้าลังปลูกโดยตรง"
//
//  ⚠️ ห้ามเติมตามระดับลังตลอดเวลา: หลัง Flood & Drain ระบายน้ำ ลังจะต่ำ (~20%) เป็นปกติ
//  ถ้าเติมตอนนั้น ปั๊มจะเติมน้ำใหม่จนลังเต็ม 80% แล้วรากแช่น้ำค้างไปถึงรอบถัดไป (หลายชั่วโมง)
//  แทนที่จะแช่แค่ soakTime — กฎจึงเป็น:
//    - ลังนั้นเปิด Flood & Drain (cycleHours > 0): เติมได้เฉพาะช่วง soaking (ลังควรเต็มอยู่
//      ถ้าต่ำกว่า refillMin แปลว่าน้ำหาย) ช่วง filling/draining/idle ห้ามเติม
//    - ปิด Flood & Drain (cycleHours = 0): ลังควรเต็มตลอด → เติมตามระดับ
// ------------------------------------------------------------

function refillConfig(idx) {
    const s = autoSettings;
    return idx === 0
        ? { idx, relay: s.tray1RefillRelay, min: s.tray1RefillMin, max: s.tray1RefillMax, sensor: s.tray1RefillSensor }
        : { idx, relay: s.tray2RefillRelay, min: s.tray2RefillMin, max: s.tray2RefillMax, sensor: s.tray2RefillSensor };
}

function refillAllowed(idx) {
    if (!autoMode) return false;
    if (getTrayConfig(idx).cycleHours <= 0) return true;
    return trayState[idx].phase === 'soaking';
}

function stopRefillIfNotAllowed(idx) {
    if (!refillActive[idx] || refillAllowed(idx)) return;
    const cfg = refillConfig(idx);
    refillActive[idx] = false;
    if (cfg.relay >= 0) state.relayStates[cfg.relay] = false;
    console.log(`[REFILL] Tray${idx + 1} OFF — ช่วง ${trayState[idx].phase} ห้ามเติมน้ำ`);
}

function checkRefill(data) {
    if (!autoMode) return;
    for (const cfg of [refillConfig(0), refillConfig(1)]) {
        if (cfg.relay < 0) continue;
        if (!refillAllowed(cfg.idx)) {
            if (refillActive[cfg.idx]) {
                stopRefillIfNotAllowed(cfg.idx);
                _io.emit('relayUpdate', { relays: state.relayStates });
            }
            continue;
        }
        const level = (data.waterLevel || [])[cfg.sensor];
        if (typeof level !== 'number' || level < 0) continue;
        if (!refillActive[cfg.idx] && level < cfg.min) {
            refillActive[cfg.idx] = true;
            state.relayStates[cfg.relay] = true;
            _io.emit('relayUpdate', { relays: state.relayStates });
            console.log(`[REFILL] Tray${cfg.idx + 1} ON — level ${level.toFixed(1)}% < ${cfg.min}%`);
        } else if (refillActive[cfg.idx] && level >= cfg.max) {
            refillActive[cfg.idx] = false;
            state.relayStates[cfg.relay] = false;
            _io.emit('relayUpdate', { relays: state.relayStates });
            console.log(`[REFILL] Tray${cfg.idx + 1} OFF — level ${level.toFixed(1)}% >= ${cfg.max}%`);
        }
    }
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
    get refillActive() { return refillActive; },
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
    refillAllowed,
    DEFAULT_SETTINGS,
    getProgramStatus,
    getTrayConfig,
    scheduleTray,
    startFilling,
    startSoaking,
    startDraining,
    finishCycle,
    stopAllTrays,
    checkTrayFilling,
    checkTrayDraining,
    buildAutoStatus,
    activateDose,
    checkRefill,
    checkPHControl,
    get trayState() { return trayState; }
};
