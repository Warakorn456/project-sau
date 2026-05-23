const express    = require('express');
const session    = require('express-session');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const fs         = require('fs');
const crypto     = require('crypto');
require('dotenv').config();

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

// ============================================================
//  Middleware
// ============================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'smart-farm-secret-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 8 * 60 * 60 * 1000 } // 8 ชั่วโมง
}));

function requireAuth(req, res, next) {
    if (req.session.user) return next();
    res.redirect('/');
}

function requireAdmin(req, res, next) {
    if (req.session.role === 'admin') return next();
    res.status(403).json({ error: 'ไม่มีสิทธิ์' });
}

// ============================================================
//  User Management
// ============================================================

const USERS_FILE = path.join(__dirname, 'users.json');

function hashPassword(password, salt) {
    return crypto.createHmac('sha256', salt).update(password).digest('hex');
}

function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('[Users] Load error:', e.message);
    }
    return [];
}

function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function initDefaultAdmin() {
    const users = loadUsers();
    if (users.length === 0) {
        const username = process.env.ADMIN_USER || 'admin';
        const password = process.env.ADMIN_PASS || 'farm1234';
        const salt = crypto.randomBytes(16).toString('hex');
        users.push({ username, salt, passwordHash: hashPassword(password, salt), role: 'admin' });
        saveUsers(users);
        console.log(`[Users] Created default admin: ${username}`);
    }
}

app.use('/assets', requireAuth, express.static(path.join(__dirname, 'public')));

// ============================================================
//  State: ข้อมูลปัจจุบัน
// ============================================================

let sensorData = {
    temperature: 0,
    humidity:    0,
    light:       0,
    ph:          7.0,
    ph2:         7.0,
    voltage:     0,
    current:     0,
    power:       0,
    waterLevel:  [0, 0, 0, 0, 0, 0, 0],
    connected:   false,
    timestamp:   null
};

let relayStates   = new Array(10).fill(false);
let lastESP32Ping = 0;

// ============================================================
//  Auto Mode
// ============================================================

let autoMode       = false;
let autoSettings   = {
    // pH
    ph1Min: 5.5,  ph1Max: 7.0,
    ph1UpRelay: -1, ph1DownRelay: -1,
    ph2Min: 5.5,  ph2Max: 7.0,
    ph2UpRelay: -1, ph2DownRelay: -1,
    doseTime: 3,
    // น้ำเติมอัตโนมัติ ลัง1
    tray1RefillRelay:  -1,
    tray1RefillMin:    20,
    tray1RefillMax:    80,
    tray1RefillSensor:  3,
    // น้ำเติมอัตโนมัติ ลัง2
    tray2RefillRelay:  -1,
    tray2RefillMin:    20,
    tray2RefillMax:    80,
    tray2RefillSensor:  5,
    // วงจรน้ำ ลัง1 (Flood & Drain)
    tray1FillTarget:   80,  // % ระดับที่หยุดเติม
    tray1SoakTime:     30,  // นาทีที่แช่
    tray1DrainTarget:  20,  // % ระดับที่หยุดสูบออก
    tray1CycleHours:   6,   // ชั่วโมงต่อรอบ
    tray1FillRelay:   0,    // R1 ปั๊มน้ำเติมลัง1
    tray1DrainRelay:  7,    // R8 ปั๊มน้ำวนลัง1ออก
    tray1Sensor:      3,    // index sensor ลังปลูกผัก1
    // วงจรน้ำ ลัง2
    tray2FillTarget:   80,
    tray2SoakTime:     30,
    tray2DrainTarget:  20,
    tray2CycleHours:   6,
    tray2FillRelay:   1,    // R2 ปั๊มน้ำเติมลัง2
    tray2DrainRelay:  9,    // R10 ปั๊มน้ำวนลัง2ออก
    tray2Sensor:      5     // index sensor ลังปลูกผัก2
};
let refillActive = [false, false];

const DOSE_COOLDOWN    = 5 * 60 * 1000;
const FILL_TIMEOUT_MS  = 30 * 60 * 1000; // safety timeout ขณะเติมน้ำ
let lastDoseTime    = 0;
let doseLabel       = '';

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

function scheduleTray(idx) {
    const st  = trayState[idx];
    const cfg = getTrayConfig(idx);
    clearTimeout(st.timer);
    if (!autoMode || cfg.cycleHours <= 0) return;
    const ms  = cfg.cycleHours * 3600 * 1000;
    st.nextTime = Date.now() + ms;
    st.timer    = setTimeout(() => startFilling(idx), ms);
    io.emit('autoStatus', buildAutoStatus());
    console.log(`[TRAY${idx+1}] Next cycle in ${cfg.cycleHours}h`);
}

function startFilling(idx) {
    if (!autoMode) return;
    const st  = trayState[idx];
    const cfg = getTrayConfig(idx);
    st.phase       = 'filling';
    st.nextTime    = 0;
    st.phaseEndTime = Date.now() + FILL_TIMEOUT_MS;
    if (cfg.fillRelay >= 0) relayStates[cfg.fillRelay] = true;
    io.emit('relayUpdate', { relays: relayStates });
    io.emit('autoStatus',  buildAutoStatus());
    console.log(`[TRAY${idx+1}] Filling → target ${cfg.fillTarget}%`);
    // safety timeout ถ้า sensor ไม่แจ้ง
    st.timer = setTimeout(() => {
        console.log(`[TRAY${idx+1}] Fill timeout — moving to soak`);
        startSoaking(idx);
    }, FILL_TIMEOUT_MS);
}

function startSoaking(idx) {
    const st  = trayState[idx];
    const cfg = getTrayConfig(idx);
    clearTimeout(st.timer);
    if (cfg.fillRelay >= 0) relayStates[cfg.fillRelay] = false;
    st.phase        = 'soaking';
    st.phaseEndTime = Date.now() + cfg.soakTime * 60 * 1000;
    io.emit('relayUpdate', { relays: relayStates });
    io.emit('autoStatus',  buildAutoStatus());
    console.log(`[TRAY${idx+1}] Soaking ${cfg.soakTime} min`);
    st.timer = setTimeout(() => startDraining(idx), cfg.soakTime * 60 * 1000);
}

function startDraining(idx) {
    if (!autoMode) return;
    const st  = trayState[idx];
    const cfg = getTrayConfig(idx);
    st.phase        = 'draining';
    st.phaseEndTime = Date.now() + FILL_TIMEOUT_MS; // safety timeout
    if (cfg.drainRelay >= 0) relayStates[cfg.drainRelay] = true;
    io.emit('relayUpdate', { relays: relayStates });
    io.emit('autoStatus',  buildAutoStatus());
    console.log(`[TRAY${idx+1}] Draining → target ${cfg.drainTarget}%`);
    st.timer = setTimeout(() => {
        console.log(`[TRAY${idx+1}] Drain safety timeout`);
        finishCycle(idx);
    }, FILL_TIMEOUT_MS);
}

function finishCycle(idx) {
    const st  = trayState[idx];
    const cfg = getTrayConfig(idx);
    if (cfg.drainRelay >= 0) relayStates[cfg.drainRelay] = false;
    st.phase        = 'idle';
    st.phaseEndTime = 0;
    io.emit('relayUpdate', { relays: relayStates });
    console.log(`[TRAY${idx+1}] Cycle complete`);
    scheduleTray(idx);
}

function stopAllTrays() {
    for (let i = 0; i < 2; i++) {
        const st  = trayState[i];
        const cfg = getTrayConfig(i);
        clearTimeout(st.timer);
        if (st.phase !== 'idle') {
            if (cfg.fillRelay  >= 0) relayStates[cfg.fillRelay]  = false;
            if (cfg.drainRelay >= 0) relayStates[cfg.drainRelay] = false;
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


function activateDose(relayIdx, label) {
    if (relayIdx < 0 || relayIdx > 9) return;
    lastDoseTime  = Date.now();
    doseLabel     = label;
    relayStates[relayIdx] = true;
    io.emit('relayUpdate', { relays: relayStates });
    io.emit('autoStatus',  buildAutoStatus());
    console.log(`[AUTO] Dose ${label} → R${relayIdx + 1} (${autoSettings.doseTime}s)`);

    setTimeout(() => {
        relayStates[relayIdx] = false;
        doseLabel = '';
        io.emit('relayUpdate', { relays: relayStates });
        io.emit('autoStatus',  buildAutoStatus());
        console.log(`[AUTO] Dose done`);
    }, autoSettings.doseTime * 1000);
}

function checkRefill(data) {
    if (!autoMode) return;
    const cfgs = [
        { idx: 0, relay: autoSettings.tray1RefillRelay, min: autoSettings.tray1RefillMin,
          max: autoSettings.tray1RefillMax, sensor: autoSettings.tray1RefillSensor },
        { idx: 1, relay: autoSettings.tray2RefillRelay, min: autoSettings.tray2RefillMin,
          max: autoSettings.tray2RefillMax, sensor: autoSettings.tray2RefillSensor }
    ];
    for (const cfg of cfgs) {
        if (cfg.relay < 0) continue;
        const level = (data.waterLevel || [])[cfg.sensor];
        if (typeof level !== 'number' || level < 0) continue;
        if (!refillActive[cfg.idx] && level < cfg.min) {
            refillActive[cfg.idx] = true;
            relayStates[cfg.relay] = true;
            io.emit('relayUpdate', { relays: relayStates });
            console.log(`[REFILL] Tray${cfg.idx + 1} ON — level ${level.toFixed(1)}% < ${cfg.min}%`);
        } else if (refillActive[cfg.idx] && level >= cfg.max) {
            refillActive[cfg.idx] = false;
            relayStates[cfg.relay] = false;
            io.emit('relayUpdate', { relays: relayStates });
            console.log(`[REFILL] Tray${cfg.idx + 1} OFF — level ${level.toFixed(1)}% >= ${cfg.max}%`);
        }
    }
}

function checkPHControl(data) {
    if (!autoMode) return;
    if (Date.now() - lastDoseTime < DOSE_COOLDOWN) return;
    if (doseLabel) return; // dose กำลังทำงานอยู่

    const ph1 = data.ph;
    const ph2 = data.ph2;

    // ลัง1
    if (ph1 < autoSettings.ph1Min && autoSettings.ph1UpRelay >= 0) {
        activateDose(autoSettings.ph1UpRelay, `pH↑ ลัง1 (${ph1.toFixed(1)} < ${autoSettings.ph1Min})`);
    } else if (ph1 > autoSettings.ph1Max && autoSettings.ph1DownRelay >= 0) {
        activateDose(autoSettings.ph1DownRelay, `pH↓ ลัง1 (${ph1.toFixed(1)} > ${autoSettings.ph1Max})`);
    }
    // ลัง2
    else if (ph2 < autoSettings.ph2Min && autoSettings.ph2UpRelay >= 0) {
        activateDose(autoSettings.ph2UpRelay, `pH↑ ลัง2 (${ph2.toFixed(1)} < ${autoSettings.ph2Min})`);
    } else if (ph2 > autoSettings.ph2Max && autoSettings.ph2DownRelay >= 0) {
        activateDose(autoSettings.ph2DownRelay, `pH↓ ลัง2 (${ph2.toFixed(1)} > ${autoSettings.ph2Max})`);
    }
}

// ============================================================
//  ประวัติข้อมูล 24 ชั่วโมง
//  เก็บทุก 1 นาที → สูงสุด 1,440 รายการ
// ============================================================

const HISTORY_FILE    = path.join(__dirname, 'history.json');
const HISTORY_MAX_MS  = 24 * 60 * 60 * 1000; // 24 ชั่วโมง
const RECORD_INTERVAL = 60 * 1000;            // บันทึกทุก 1 นาที
const SAVE_INTERVAL   = 5  * 60 * 1000;       // เขียนไฟล์ทุก 5 นาที

let historyData     = [];
let lastRecordTime  = 0;
let lastSaveTime    = 0;

function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            const cutoff = Date.now() - HISTORY_MAX_MS;
            historyData = parsed.filter(d => new Date(d.ts).getTime() > cutoff);
            console.log(`[History] Loaded ${historyData.length} records from file`);
        }
    } catch (e) {
        console.error('[History] Load error:', e.message);
        historyData = [];
    }
}

function saveHistory() {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(historyData));
        console.log(`[History] Saved ${historyData.length} records`);
    } catch (e) {
        console.error('[History] Save error:', e.message);
    }
}

function recordHistory(data) {
    const now = Date.now();
    if (now - lastRecordTime < RECORD_INTERVAL) return; // ยังไม่ถึงเวลา
    lastRecordTime = now;

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

    historyData.push(point);

    // ลบข้อมูลที่เก่ากว่า 24 ชั่วโมง
    const cutoff = now - HISTORY_MAX_MS;
    historyData = historyData.filter(d => new Date(d.ts).getTime() > cutoff);

    // Broadcast จุดใหม่ไปยัง browser ทุกตัว
    io.emit('historyPoint', point);

    // เขียนไฟล์ทุก 5 นาที
    if (now - lastSaveTime > SAVE_INTERVAL) {
        lastSaveTime = now;
        saveHistory();
    }
}

// ============================================================
//  Routes: หน้าเว็บ
// ============================================================

app.get('/', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const users = loadUsers();
    const user  = users.find(u => u.username === username);

    if (user && hashPassword(password, user.salt) === user.passwordHash) {
        req.session.user = username;
        req.session.role = user.role;
        return res.redirect('/dashboard');
    }
    res.redirect('/?error=1');
});

app.get('/dashboard', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// ============================================================
//  Routes: API สำหรับ ESP32
// ============================================================

app.post('/api/data', (req, res) => {
    const d = req.body;

    sensorData = {
        temperature: Number(d.temperature) || 0,
        humidity:    Number(d.humidity)    || 0,
        light:       Number(d.light)       || 0,
        ph:          Number(d.ph)          || 0,
        ph2:         Number(d.ph2)         || 0,
        voltage:     Number(d.voltage)     || 0,
        current:     Number(d.current)     || 0,
        power:       Number(d.power)       || 0,
        waterLevel:  Array.isArray(d.waterLevel)
                        ? d.waterLevel.map(Number)
                        : [0, 0, 0, 0, 0, 0, 0],
        connected:   true,
        timestamp:   new Date().toISOString()
    };

    lastESP32Ping = Date.now();

    io.emit('sensorData', sensorData);
    recordHistory(sensorData);
    checkRefill(sensorData);
    checkPHControl(sensorData);
    checkTrayFilling(sensorData);
    checkTrayDraining(sensorData);

    res.json({ ok: true, relays: relayStates });
});

// ============================================================
//  Routes: API สำหรับ Browser
// ============================================================

// ข้อมูล user ปัจจุบัน
app.get('/api/me', requireAuth, (req, res) => {
    let role = req.session.role;
    if (!role) {
        const users = loadUsers();
        const found = users.find(u => u.username === req.session.user);
        role = found ? found.role : 'viewer';
        req.session.role = role;
    }
    res.json({ username: req.session.user, role });
});

// จัดการ Users (admin only)
app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
    const users = loadUsers().map(u => ({ username: u.username, role: u.role }));
    res.json(users);
});

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password || !['admin', 'viewer'].includes(role)) {
        return res.status(400).json({ error: 'ข้อมูลไม่ครบหรือ role ไม่ถูกต้อง' });
    }
    const users = loadUsers();
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'ชื่อผู้ใช้นี้มีอยู่แล้ว' });
    }
    const salt = crypto.randomBytes(16).toString('hex');
    users.push({ username, salt, passwordHash: hashPassword(password, salt), role });
    saveUsers(users);
    console.log(`[Users] Created: ${username} (${role})`);
    res.json({ ok: true });
});

app.delete('/api/users/:username', requireAuth, requireAdmin, (req, res) => {
    const target = req.params.username;
    if (target === req.session.user) {
        return res.status(400).json({ error: 'ไม่สามารถลบบัญชีตัวเองได้' });
    }
    let users = loadUsers();
    const targetUser = users.find(u => u.username === target);
    if (!targetUser) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    if (targetUser.role === 'admin' && users.filter(u => u.role === 'admin').length <= 1) {
        return res.status(400).json({ error: 'ต้องมี admin อย่างน้อย 1 คน' });
    }
    users = users.filter(u => u.username !== target);
    saveUsers(users);
    console.log(`[Users] Deleted: ${target}`);
    res.json({ ok: true });
});

// ดึงประวัติย้อนหลัง 24 ชั่วโมง
app.get('/api/history', requireAuth, (req, res) => {
    res.json(historyData);
});

// สลับ AUTO / MANUAL
app.post('/api/mode', requireAuth, requireAdmin, (req, res) => {
    const { mode } = req.body;
    autoMode = mode === 'auto';
    if (autoMode) {
        scheduleTray(0);
        scheduleTray(1);
    } else {
        for (let i = 0; i < 2; i++) {
            if (refillActive[i]) {
                const r = i === 0 ? autoSettings.tray1RefillRelay : autoSettings.tray2RefillRelay;
                if (r >= 0) relayStates[r] = false;
                refillActive[i] = false;
            }
        }
        stopAllTrays();
        io.emit('relayUpdate', { relays: relayStates });
        io.emit('autoStatus', buildAutoStatus());
    }
    res.json({ ok: true, autoMode });
});

// บันทึกการตั้งค่า AUTO
app.post('/api/auto-settings', requireAuth, requireAdmin, (req, res) => {
    const s = req.body;
    const ri = v => { const n = parseInt(v); return (n >= 0 && n <= 9) ? n : -1; };
    const pf = (v, def) => parseFloat(v) || def;
    autoSettings = {
        ph1Min: pf(s.ph1Min,5.5),  ph1Max: pf(s.ph1Max,7.0),
        ph1UpRelay: ri(s.ph1UpRelay), ph1DownRelay: ri(s.ph1DownRelay),
        ph2Min: pf(s.ph2Min,5.5),  ph2Max: pf(s.ph2Max,7.0),
        ph2UpRelay: ri(s.ph2UpRelay), ph2DownRelay: ri(s.ph2DownRelay),
        doseTime:           pf(s.doseTime,3),
        tray1RefillRelay:   ri(s.tray1RefillRelay),
        tray1RefillMin:     pf(s.tray1RefillMin, 20),
        tray1RefillMax:     pf(s.tray1RefillMax, 80),
        tray1RefillSensor:  parseInt(s.tray1RefillSensor) >= 0 ? parseInt(s.tray1RefillSensor) : 3,
        tray2RefillRelay:   ri(s.tray2RefillRelay),
        tray2RefillMin:     pf(s.tray2RefillMin, 20),
        tray2RefillMax:     pf(s.tray2RefillMax, 80),
        tray2RefillSensor:  parseInt(s.tray2RefillSensor) >= 0 ? parseInt(s.tray2RefillSensor) : 5,
        tray1FillTarget:   pf(s.tray1FillTarget,80),
        tray1SoakTime:     pf(s.tray1SoakTime,30),
        tray1DrainTarget:  pf(s.tray1DrainTarget,20),
        tray1CycleHours:   pf(s.tray1CycleHours,6),
        tray1FillRelay:   ri(s.tray1FillRelay) >= 0 ? ri(s.tray1FillRelay) : 0,
        tray1DrainRelay:  ri(s.tray1DrainRelay) >= 0 ? ri(s.tray1DrainRelay) : 7,
        tray1Sensor:      parseInt(s.tray1Sensor) ?? 3,
        tray2FillTarget:   pf(s.tray2FillTarget,80),
        tray2SoakTime:     pf(s.tray2SoakTime,30),
        tray2DrainTarget:  pf(s.tray2DrainTarget,20),
        tray2CycleHours:   pf(s.tray2CycleHours,6),
        tray2FillRelay:   ri(s.tray2FillRelay) >= 0 ? ri(s.tray2FillRelay) : 1,
        tray2DrainRelay:  ri(s.tray2DrainRelay) >= 0 ? ri(s.tray2DrainRelay) : 9,
        tray2Sensor:      parseInt(s.tray2Sensor) ?? 5
    };
    for (let i = 0; i < 2; i++) {
        if (autoMode && trayState[i].phase === 'idle') scheduleTray(i);
    }
    io.emit('autoStatus', buildAutoStatus());
    res.json({ ok: true });
});

// ควบคุม Relay
app.post('/api/relay', requireAuth, requireAdmin, (req, res) => {
    const index = parseInt(req.body.index);
    const state = Boolean(req.body.state);

    if (index >= 0 && index < 10) {
        relayStates[index] = state;
        io.emit('relayUpdate', { relays: relayStates });
    }

    res.json({ ok: true });
});

// ============================================================
//  ตรวจสอบการเชื่อมต่อ ESP32 (timeout 15 วินาที)
// ============================================================

setInterval(() => {
    if (sensorData.connected && Date.now() - lastESP32Ping > 15000) {
        sensorData.connected = false;
        io.emit('sensorData', sensorData);
        console.log('[Server] ESP32 disconnected (timeout)');
    }
}, 5000);

// บันทึกประวัติลงไฟล์อัตโนมัติก่อน process ปิด
process.on('SIGTERM', saveHistory);
process.on('SIGINT',  saveHistory);

// ============================================================
//  Socket.io
// ============================================================

io.on('connection', (socket) => {
    console.log('[Socket] Browser connected:', socket.id);

    socket.emit('sensorData',  sensorData);
    socket.emit('relayUpdate', { relays: relayStates });
    socket.emit('autoStatus',  buildAutoStatus());

    socket.on('disconnect', () => {
        console.log('[Socket] Browser disconnected:', socket.id);
    });
});

// ============================================================
//  Start Server
// ============================================================

initDefaultAdmin(); // สร้าง admin เริ่มต้นถ้ายังไม่มี users
loadHistory();      // โหลดประวัติจากไฟล์ก่อนเปิด server

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n============================`);
    console.log(`  Smart Farm Server`);
    console.log(`  http://localhost:${PORT}`);
    console.log(`============================\n`);
});
