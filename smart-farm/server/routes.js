// ============================================================
//  routes.js — All Express routes
// ============================================================

const path        = require('path');
const crypto      = require('crypto');
const rateLimit   = require('express-rate-limit');
const state       = require('./state');
const am          = require('./autoMode');
const persist     = require('./persistence');
const cropCycles  = require('./cropCycles');

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'ลองเข้าสู่ระบบมากเกินไป กรุณารอ 15 นาที',
    standardHeaders: true,
    legacyHeaders: false,
});

// null/undefined = เซ็นเซอร์อ่านไม่ได้ (ESP32 ส่ง null) — ต้องแยกจาก 0 จริง
// เดิมแปลงเป็น 0 แล้วถูกบันทึกลงรายงานว่า 0°C / 0 lux ดึงค่าเฉลี่ยต่ำลงเงียบๆ
function parseNum(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

// ระดับน้ำ: -1 = เซ็นเซอร์ไม่ตอบ (ไม่ใช่ null — Auto Mode และรายงานใช้ -1 เป็นสัญญาณนี้อยู่แล้ว)
const WATER_COUNT = 6;
function parseWaterLevels(arr) {
    const src = Array.isArray(arr) ? arr : [];
    const out = [];
    for (let i = 0; i < WATER_COUNT; i++) {
        const n = parseNum(src[i]);
        out.push(n === null ? -1 : n);
    }
    return out;
}

// ------------------------------------------------------------
//  Device key — กันคนอื่นยิงค่าเซ็นเซอร์ปลอมเข้า POST /api/data
//  (ค่าปลอมสั่ง Auto Mode ได้จริง: pH สูง = จ่ายน้ำยาลด pH, และถูกบันทึกลงรายงานรอบปลูก)
//  ไม่ตั้ง DEVICE_KEY = ยอมรับทุกคำขอ (โหมดเดิม ใช้ตอนบอร์ดยังเป็น firmware เก่า)
// ------------------------------------------------------------
const DEVICE_KEY = process.env.DEVICE_KEY || '';
if (!DEVICE_KEY) {
    console.warn('[Security] ⚠️  ยังไม่ได้ตั้ง DEVICE_KEY — ใครก็ส่งค่าเซ็นเซอร์เข้า /api/data ได้');
}

function requireDevice(req, res, next) {
    if (!DEVICE_KEY) return next();
    const got = Buffer.from(String(req.get('X-Device-Key') || ''));
    const want = Buffer.from(DEVICE_KEY);
    if (got.length === want.length && crypto.timingSafeEqual(got, want)) return next();
    res.status(401).json({ ok: false, error: 'invalid device key' });
}

// ------------------------------------------------------------
//  ตรวจค่าการตั้งค่า Auto Mode — ค่าผิดช่วงสั่งปั๊มผิดได้จริง
//  (เช่น pH Max 0.7 แทน 7.0 = จ่ายน้ำยาลด pH ทุก 5 นาทีไม่หยุด) จึงตอบ 400 ไม่ใช่เดาค่าให้
// ------------------------------------------------------------
class SettingsError extends Error {}

function num(v, def, min, max, label) {
    if (v === undefined || v === null || v === '') return def;
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) {
        throw new SettingsError(`${label} ต้องอยู่ระหว่าง ${min}–${max}`);
    }
    return n;
}

const USERNAME_RE = /^[A-Za-z0-9_.\-ก-๙]{1,32}$/;

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

        if (!persist.verifyPassword(username, password)) return res.redirect('/?error=1');

        const user = persist.findUser(username);
        // สร้าง session ใหม่ทุกครั้งที่ล็อกอิน — กัน session fixation (id เดิมก่อนล็อกอินใช้ต่อไม่ได้)
        req.session.regenerate(err => {
            if (err) return res.redirect('/?error=1');
            req.session.user = username;
            req.session.role = user ? user.role : 'viewer';
            res.redirect('/dashboard');
        });
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

    app.post('/api/data', requireDevice, (req, res) => {
        const d = req.body || {};

        state.sensorData = {
            temperature: parseNum(d.temperature),
            humidity:    parseNum(d.humidity),
            light:       parseNum(d.light),
            ph:          parseNum(d.ph),
            ph2:         parseNum(d.ph2),
            voltage:     parseNum(d.voltage),
            current:     parseNum(d.current),
            power:       parseNum(d.power),
            waterLevel:  parseWaterLevels(d.waterLevel),
            connected:   true,
            timestamp:   new Date().toISOString()
        };

        // คู่กับ log "ESP32 disconnected (timeout)" ใน server.js — ได้ทั้งขาหลุดและขากลับมา
        // ทำให้ไล่ย้อนหลังใน log ของ Render ได้ว่าบอร์ดเงียบไปตอนไหน นานเท่าไหร่
        const silentMs = state.lastESP32Ping ? Date.now() - state.lastESP32Ping : 0;
        if (silentMs > 60000) {
            console.log(`[Server] ESP32 กลับมาแล้ว หลังเงียบไป ${Math.round(silentMs / 1000)} วินาที`);
        }

        state.lastESP32Ping = Date.now();

        io.emit('sensorData', state.sensorData);
        persist.recordHistory(state.sensorData, io);
        cropCycles.recordCropData(state.sensorData);
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
        // ชื่อถูกนำไปแสดงในตารางผู้ใช้ — จำกัดตัวอักษรไว้ตั้งแต่ต้นทาง (หน้าเว็บ escape ซ้ำอีกชั้น)
        if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
            return res.status(400).json({ error: 'ชื่อผู้ใช้ 1–32 ตัว ใช้ได้เฉพาะ ก-ฮ A-Z a-z 0-9 _ . -' });
        }
        if (typeof password !== 'string' || password.length < 6) {
            return res.status(400).json({ error: 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร' });
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
    //  API: Browser — crop cycles (รอบปลูก)
    // --------------------------------------------------------

    app.get('/api/crops', requireAuth, (req, res) => {
        res.json({
            trays:     cropCycles.TRAYS,
            trayNames: cropCycles.TRAY_NAMES,
            actives:   cropCycles.getActiveCycleSummaries(),  // { "1": {...}|null, "2": {...}|null }
            cycles:    cropCycles.getCycleList()
        });
    });

    app.get('/api/crops/:id', requireAuth, async (req, res) => {
        const cycle = await cropCycles.getCycleDetail(req.params.id);
        if (!cycle) return res.status(404).json({ error: 'ไม่พบข้อมูลรอบปลูก' });
        res.json(cycle);
    });

    app.post('/api/crops/start', requireAuth, requireAdmin, async (req, res) => {
        const cropName = (req.body.cropName || '').trim().slice(0, 60);
        const tray     = parseInt(req.body.tray, 10);

        if (!cropName) return res.status(400).json({ error: 'กรุณาระบุชื่อพืช' });
        if (!cropCycles.TRAYS.includes(tray)) {
            return res.status(400).json({ error: 'กรุณาระบุลังปลูก (1 หรือ 2)' });
        }

        const cycle = await cropCycles.startCycle(cropName, tray);
        if (!cycle) {
            return res.status(400).json({
                error: `${cropCycles.TRAY_NAMES[tray]} มีรอบปลูกที่กำลังดำเนินอยู่แล้ว`
            });
        }
        // เขียนที่เก็บข้อมูลไม่ได้ — ต้องบอกทันที ไม่ใช่ปล่อยให้ปลูกไป 20 วันแล้วค่อยรู้ว่าไม่มีข้อมูล
        if (cycle.error === 'storage') {
            return res.status(503).json({
                error: 'บันทึกรอบปลูกไม่สำเร็จ — ต่อฐานข้อมูลไม่ได้ ยังไม่ได้เริ่มรอบปลูก'
            });
        }

        res.json({ ok: true, cycle });
    });

    app.post('/api/crops/:id/end', requireAuth, requireAdmin, async (req, res) => {
        const cycle = await cropCycles.endCycle(req.params.id);
        if (!cycle) {
            return res.status(400).json({ error: 'ไม่พบรอบปลูกที่กำลังดำเนินอยู่ตาม id นี้' });
        }
        res.json({ ok: true, cycle });
    });

    // ค่าที่วัดด้วยมือ — ไม่ผูกกับรอบปลูก ทุกรอบที่ช่วงเวลาครอบ ts จะเห็นค่านี้
    app.post('/api/crops/manual', requireAuth, requireAdmin, async (req, res) => {
        const result = await cropCycles.addManualEntry(req.body || {}, req.session.user);
        if (result.error === 'storage') {
            return res.status(503).json({ error: 'บันทึกไม่สำเร็จ — ต่อฐานข้อมูลไม่ได้' });
        }
        if (result.error) return res.status(400).json({ error: result.error });
        res.json({ ok: true, entry: result.entry });
    });

    app.delete('/api/crops/manual/:id', requireAuth, requireAdmin, async (req, res) => {
        const ok = await cropCycles.deleteManualEntry(req.params.id);
        if (ok === false) return res.status(404).json({ error: 'ไม่พบรายการนี้' });
        if (ok === null)  return res.status(503).json({ error: 'ลบไม่สำเร็จ — ต่อฐานข้อมูลไม่ได้' });
        res.json({ ok: true });
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
        am.persistProgram();
        res.json({ ok: true, autoMode: am.autoMode });
    });

    app.post('/api/auto-settings', requireAuth, requireAdmin, (req, res) => {
        const s  = req.body || {};
        const D  = am.DEFAULT_SETTINGS;
        const ri = v => { const n = parseInt(v); return (n >= 0 && n < am.RELAY_COUNT) ? n : -1; };
        const si = (v, def) => { const n = parseInt(v); return (n >= 0 && n < WATER_COUNT) ? n : def; };

        let next;
        try {
            const tray = (t) => {
                const p = `tray${t}`;
                const L = `ลัง${t}`;
                return {
                    [`${p}RefillRelay`]:  ri(s[`${p}RefillRelay`]),
                    [`${p}RefillMin`]:    num(s[`${p}RefillMin`],   D[`${p}RefillMin`],   0, 100, `เติมน้ำเมื่อต่ำกว่า (${L})`),
                    [`${p}RefillMax`]:    num(s[`${p}RefillMax`],   D[`${p}RefillMax`],   0, 100, `หยุดเติมที่ (${L})`),
                    [`${p}RefillSensor`]: si(s[`${p}RefillSensor`], D[`${p}RefillSensor`]),
                    [`${p}FillTarget`]:   num(s[`${p}FillTarget`],  D[`${p}FillTarget`],  0, 100, `เติมน้ำถึง (${L})`),
                    [`${p}SoakTime`]:     num(s[`${p}SoakTime`],    D[`${p}SoakTime`],    0, 240, `แช่นาน นาที (${L})`),
                    [`${p}DrainTarget`]:  num(s[`${p}DrainTarget`], D[`${p}DrainTarget`], 0, 100, `สูบออกถึง (${L})`),
                    // 0 = ปิด Flood & Drain ของลังนั้น (เดิม 0 ถูกเปลี่ยนเป็น 6 ชม. เพราะ `|| def`)
                    [`${p}CycleHours`]:   num(s[`${p}CycleHours`],  D[`${p}CycleHours`],  0, 48,  `ทำซ้ำทุก ชม. (${L})`),
                    [`${p}FillRelay`]:    ri(s[`${p}FillRelay`])  >= 0 ? ri(s[`${p}FillRelay`])  : D[`${p}FillRelay`],
                    [`${p}DrainRelay`]:   ri(s[`${p}DrainRelay`]) >= 0 ? ri(s[`${p}DrainRelay`]) : D[`${p}DrainRelay`],
                    [`${p}Sensor`]:       si(s[`${p}Sensor`], D[`${p}Sensor`])
                };
            };
            next = {
                ph1Min: num(s.ph1Min, D.ph1Min, 3, 10, 'pH ต่ำสุด ลัง1'),
                ph1Max: num(s.ph1Max, D.ph1Max, 3, 10, 'pH สูงสุด ลัง1'),
                ph1Relay: ri(s.ph1Relay),
                ph2Min: num(s.ph2Min, D.ph2Min, 3, 10, 'pH ต่ำสุด ลัง2'),
                ph2Max: num(s.ph2Max, D.ph2Max, 3, 10, 'pH สูงสุด ลัง2'),
                ph2Relay: ri(s.ph2Relay),
                doseTime: num(s.doseTime, D.doseTime, 1, 30, 'เวลา Dose (วินาที)'),
                ...tray(1),
                ...tray(2)
            };
            for (const t of [1, 2]) {
                if (next[`ph${t}Min`] >= next[`ph${t}Max`]) {
                    throw new SettingsError(`pH ต่ำสุดต้องน้อยกว่า pH สูงสุด (ลัง${t})`);
                }
                if (next[`tray${t}RefillMin`] >= next[`tray${t}RefillMax`]) {
                    throw new SettingsError(`"เติมน้ำเมื่อต่ำกว่า" ต้องน้อยกว่า "หยุดเติมที่" (ลัง${t})`);
                }
                if (next[`tray${t}DrainTarget`] >= next[`tray${t}FillTarget`]) {
                    throw new SettingsError(`"สูบออกถึง" ต้องน้อยกว่า "เติมน้ำถึง" (ลัง${t})`);
                }
            }
        } catch (e) {
            if (e instanceof SettingsError) return res.status(400).json({ error: e.message });
            throw e;
        }

        am.autoSettings = next;
        for (let i = 0; i < 2; i++) {
            if (am.autoMode && am.trayState[i].phase === 'idle') am.scheduleTray(i);
        }
        io.emit('autoStatus', am.buildAutoStatus());
        persist.saveAutoSettings(am.autoSettings)
            .catch(e => console.error('[AutoSettings] Save error:', e.message));
        res.json({ ok: true });
    });

    // --------------------------------------------------------
    //  API: Browser — program start/stop/mode
    // --------------------------------------------------------

    app.post('/api/program/mode', requireAuth, requireAdmin, (req, res) => {
        if (!am.programState.running) return res.status(400).json({ error: 'ยังไม่ได้เริ่มโปรแกรม' });
        am.programState.mode = req.body.mode === 'auto' ? 'auto' : 'manual';
        am.persistProgram();
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
        am.persistProgram();
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
        am.persistProgram();
        res.json({ ok: true });
    });

    // --------------------------------------------------------
    //  API: Browser — relay control
    // --------------------------------------------------------

    app.post('/api/relay', requireAuth, requireAdmin, (req, res) => {
        const index = parseInt(req.body.index);
        const st    = Boolean(req.body.state);

        if (index >= 0 && index < am.RELAY_COUNT) {
            state.relayStates[index] = st;
            io.emit('relayUpdate', { relays: state.relayStates });
        }

        res.json({ ok: true });
    });
}

module.exports = { setupRoutes };
