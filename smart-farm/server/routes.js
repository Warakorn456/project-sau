// ============================================================
//  routes.js — All Express routes
// ============================================================

const path        = require('path');
const crypto      = require('crypto');
const rateLimit   = require('express-rate-limit');
const state       = require('./state');
const am          = require('./autoMode');
const persist     = require('./persistence');

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'ลองเข้าสู่ระบบมากเกินไป กรุณารอ 15 นาที',
    standardHeaders: true,
    legacyHeaders: false,
});

function setupRoutes(app, io) {

    // --------------------------------------------------------
    //  Auth middleware (local helpers)
    // --------------------------------------------------------

    function requireAuth(req, res, next) {
        if (req.session.user) return next();
        res.redirect('/');
    }

    function requireAdmin(req, res, next) {
        if (req.session.role === 'admin') return next();
        res.status(403).json({ error: 'ไม่มีสิทธิ์' });
    }

    // --------------------------------------------------------
    //  Web pages
    // --------------------------------------------------------

    app.get('/', (req, res) => {
        if (req.session.user) return res.redirect('/dashboard');
        res.sendFile(path.join(__dirname, 'views', 'login.html'));
    });

    app.post('/login', loginLimiter, (req, res) => {
        const { username, password } = req.body;
        const users = persist.loadUsers();
        const user  = users.find(u => u.username === username);

        if (user && persist.hashPassword(password, user.salt) === user.passwordHash) {
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

    // --------------------------------------------------------
    //  API: ESP32
    // --------------------------------------------------------

    app.post('/api/data', (req, res) => {
        const d = req.body;

        state.sensorData = {
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

        state.lastESP32Ping = Date.now();

        io.emit('sensorData', state.sensorData);
        persist.recordHistory(state.sensorData, io);
        am.checkRefill(state.sensorData);
        am.checkPHControl(state.sensorData);
        am.checkTrayFilling(state.sensorData);
        am.checkTrayDraining(state.sensorData);

        res.json({ ok: true, relays: state.relayStates });
    });

    // --------------------------------------------------------
    //  API: Browser — user / session
    // --------------------------------------------------------

    app.get('/api/me', requireAuth, (req, res) => {
        let role = req.session.role;
        if (!role) {
            const users = persist.loadUsers();
            const found = users.find(u => u.username === req.session.user);
            role = found ? found.role : 'viewer';
            req.session.role = role;
        }
        res.json({ username: req.session.user, role });
    });

    app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
        const users = persist.loadUsers().map(u => ({ username: u.username, role: u.role }));
        res.json(users);
    });

    app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
        const { username, password, role } = req.body;
        if (!username || !password || !['admin', 'viewer'].includes(role)) {
            return res.status(400).json({ error: 'ข้อมูลไม่ครบหรือ role ไม่ถูกต้อง' });
        }
        const users = persist.loadUsers();
        if (users.find(u => u.username === username)) {
            return res.status(400).json({ error: 'ชื่อผู้ใช้นี้มีอยู่แล้ว' });
        }
        const salt = crypto.randomBytes(16).toString('hex');
        users.push({ username, salt, passwordHash: persist.hashPassword(password, salt), role });
        persist.saveUsers(users);
        console.log(`[Users] Created: ${username} (${role})`);
        res.json({ ok: true });
    });

    app.delete('/api/users/:username', requireAuth, requireAdmin, (req, res) => {
        const target = req.params.username;
        if (target === req.session.user) {
            return res.status(400).json({ error: 'ไม่สามารถลบบัญชีตัวเองได้' });
        }
        let users = persist.loadUsers();
        const targetUser = users.find(u => u.username === target);
        if (!targetUser) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
        if (targetUser.role === 'admin' && users.filter(u => u.role === 'admin').length <= 1) {
            return res.status(400).json({ error: 'ต้องมี admin อย่างน้อย 1 คน' });
        }
        users = users.filter(u => u.username !== target);
        persist.saveUsers(users);
        console.log(`[Users] Deleted: ${target}`);
        res.json({ ok: true });
    });

    // --------------------------------------------------------
    //  API: Browser — history
    // --------------------------------------------------------

    app.get('/api/history', requireAuth, (req, res) => {
        res.json(persist.getHistoryData());
    });

    // --------------------------------------------------------
    //  API: Browser — mode & auto-settings
    // --------------------------------------------------------

    app.post('/api/mode', requireAuth, requireAdmin, (req, res) => {
        const { mode } = req.body;
        am.autoMode = mode === 'auto';
        if (am.autoMode) {
            am.scheduleTray(0);
            am.scheduleTray(1);
        } else {
            for (let i = 0; i < 2; i++) {
                if (am.refillActive[i]) {
                    const r = i === 0 ? am.autoSettings.tray1RefillRelay : am.autoSettings.tray2RefillRelay;
                    if (r >= 0) state.relayStates[r] = false;
                    am.refillActive[i] = false;
                }
            }
            am.stopAllTrays();
            io.emit('relayUpdate', { relays: state.relayStates });
            io.emit('autoStatus', am.buildAutoStatus());
        }
        res.json({ ok: true, autoMode: am.autoMode });
    });

    app.post('/api/auto-settings', requireAuth, requireAdmin, (req, res) => {
        const s  = req.body;
        const ri = v => { const n = parseInt(v); return (n >= 0 && n <= 9) ? n : -1; };
        const pf = (v, def) => parseFloat(v) || def;
        am.autoSettings = {
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
            tray1Sensor:      parseInt(s.tray1Sensor) >= 0 ? parseInt(s.tray1Sensor) : 3,
            tray2FillTarget:   pf(s.tray2FillTarget,80),
            tray2SoakTime:     pf(s.tray2SoakTime,30),
            tray2DrainTarget:  pf(s.tray2DrainTarget,20),
            tray2CycleHours:   pf(s.tray2CycleHours,6),
            tray2FillRelay:   ri(s.tray2FillRelay) >= 0 ? ri(s.tray2FillRelay) : 1,
            tray2DrainRelay:  ri(s.tray2DrainRelay) >= 0 ? ri(s.tray2DrainRelay) : 9,
            tray2Sensor:      parseInt(s.tray2Sensor) >= 0 ? parseInt(s.tray2Sensor) : 5
        };
        for (let i = 0; i < 2; i++) {
            if (am.autoMode && am.trayState[i].phase === 'idle') am.scheduleTray(i);
        }
        io.emit('autoStatus', am.buildAutoStatus());
        persist.saveAutoSettingsToFile(am.autoSettings);
        res.json({ ok: true });
    });

    // --------------------------------------------------------
    //  API: Browser — program start/stop/mode
    // --------------------------------------------------------

    app.post('/api/program/mode', requireAuth, requireAdmin, (req, res) => {
        if (!am.programState.running) return res.status(400).json({ error: 'ยังไม่ได้เริ่มโปรแกรม' });
        am.programState.mode = req.body.mode === 'auto' ? 'auto' : 'manual';
        io.emit('programStatus', am.getProgramStatus());
        res.json({ ok: true });
    });

    app.post('/api/program/start', requireAuth, requireAdmin, (req, res) => {
        const { mode } = req.body;
        am.programState.running   = true;
        am.programState.startTime = Date.now();
        am.programState.mode      = mode === 'auto' ? 'auto' : 'manual';

        am.autoMode = am.programState.mode === 'auto';
        if (am.autoMode) {
            am.scheduleTray(0);
            am.scheduleTray(1);
        } else {
            am.stopAllTrays();
            io.emit('relayUpdate', { relays: state.relayStates });
        }
        io.emit('programStatus', am.getProgramStatus());
        io.emit('autoStatus',    am.buildAutoStatus());
        res.json({ ok: true });
    });

    app.post('/api/program/stop', requireAuth, requireAdmin, (req, res) => {
        am.programState.running   = false;
        am.programState.startTime = null;

        am.autoMode = false;
        for (let i = 0; i < 2; i++) {
            if (am.refillActive[i]) {
                const r = i === 0 ? am.autoSettings.tray1RefillRelay : am.autoSettings.tray2RefillRelay;
                if (r >= 0) state.relayStates[r] = false;
                am.refillActive[i] = false;
            }
        }
        am.stopAllTrays();
        state.relayStates.fill(false);
        io.emit('relayUpdate', { relays: state.relayStates });
        io.emit('programStatus', am.getProgramStatus());
        io.emit('autoStatus',    am.buildAutoStatus());
        res.json({ ok: true });
    });

    // --------------------------------------------------------
    //  API: Browser — relay control
    // --------------------------------------------------------

    app.post('/api/relay', requireAuth, requireAdmin, (req, res) => {
        const index = parseInt(req.body.index);
        const st    = Boolean(req.body.state);

        if (index >= 0 && index < 10) {
            state.relayStates[index] = st;
            io.emit('relayUpdate', { relays: state.relayStates });
        }

        res.json({ ok: true });
    });
}

module.exports = { setupRoutes };
