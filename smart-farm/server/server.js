// ============================================================
//  server.js — Entry point (thin main file)
// ============================================================

require('dotenv').config();

const express    = require('express');
const session    = require('express-session');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const crypto     = require('crypto');

const state       = require('./state');
const am          = require('./autoMode');
const persist     = require('./persistence');
const cropCycles  = require('./cropCycles');
const { setupRoutes } = require('./routes');

// ============================================================
//  Express + Socket.io setup
// ============================================================

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

am.setIO(io);

// ============================================================
//  Middleware
// ============================================================

// Render/Railway วาง server ไว้หลัง proxy 1 ชั้น — ถ้าไม่บอก Express, req.ip ของทุกคนจะเป็น IP
// ของ proxy ตัวเดียวกัน แล้ว rate limit ของหน้า login จะนับรวมทุกคน (ใครกรอกผิด 10 ครั้ง
// ทุกคนโดนล็อก 15 นาที) และ cookie secure:'auto' จะไม่รู้ว่าเป็น https
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ไม่ตั้ง SESSION_SECRET = สุ่มใหม่ทุกครั้งที่ boot (ทุกคนต้องล็อกอินใหม่หลัง restart)
// ดีกว่าใช้ค่าคงที่ที่อยู่ในโค้ด ซึ่งใครอ่านโค้ดก็ปลอม cookie ได้
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
    sessionSecret = crypto.randomBytes(32).toString('hex');
    console.warn('[Security] ⚠️  ยังไม่ได้ตั้ง SESSION_SECRET — ใช้ค่าสุ่มชั่วคราว (restart แล้วต้องล็อกอินใหม่)');
}

const sessionMiddleware = session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 8 * 60 * 60 * 1000,   // 8 ชั่วโมง
        httpOnly: true,
        sameSite: 'lax',
        secure: 'auto'                // https (Render) = secure, http (localhost) = ไม่ secure
    }
});
app.use(sessionMiddleware);

// Socket.io ต้องล็อกอินก่อนเหมือนหน้าเว็บ — ไม่งั้นใครก็ต่อเข้ามาดูค่าเซ็นเซอร์สดได้
io.engine.use(sessionMiddleware);
io.use((socket, next) => {
    const sess = socket.request.session;
    if (sess && sess.user) return next();
    next(new Error('unauthorized'));
});

function requireAuth(req, res, next) {
    if (req.session.user) return next();
    res.redirect('/');
}

app.use('/assets', requireAuth, express.static(path.join(__dirname, 'public')));

// ============================================================
//  Routes
// ============================================================

setupRoutes(app, io);

// ============================================================
//  ESP32 connection watchdog (timeout 15 วินาที)
// ============================================================

setInterval(() => {
    if (state.sensorData.connected && Date.now() - state.lastESP32Ping > 15000) {
        state.sensorData.connected = false;
        io.emit('sensorData', state.sensorData);
        const on = state.relayStates.map((v, i) => v ? `R${i + 1}` : null).filter(Boolean);
        console.log('[Server] ESP32 disconnected (timeout)' +
            (on.length ? ` — relay ที่เปิดอยู่ (${on.join(', ')}) บอร์ดจะปิดเองภายใน 30 วิ (failsafe)` : ''));
    }
}, 5000);

// ============================================================
//  Socket.io
// ============================================================

io.on('connection', (socket) => {
    console.log('[Socket] Browser connected:', socket.id);

    socket.emit('sensorData',    state.sensorData);
    socket.emit('relayUpdate',   { relays: state.relayStates });
    socket.emit('autoStatus',    am.buildAutoStatus());
    socket.emit('programStatus', am.getProgramStatus());

    socket.on('disconnect', () => {
        console.log('[Socket] Browser disconnected:', socket.id);
    });
});

// ============================================================
//  Graceful shutdown
// ============================================================

// การเขียนข้อมูลรอบปลูกเป็น async (อาจไปที่ Supabase) จึงต้องรอให้เสร็จก่อนออก
// แล้วต้อง process.exit() เอง — server ยัง listen อยู่ event loop จะไม่ว่างเอง
let shuttingDown = false;
async function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[Server] ได้รับ ${signal} — กำลังบันทึกข้อมูลก่อนปิด...`);

    persist.saveHistory();
    try {
        await persist.saveAutoSettings(am.autoSettings);
    } catch (e) {
        console.error('[Server] บันทึกการตั้งค่าไม่สำเร็จ:', e.message);
    }
    try {
        await cropCycles.saveActiveCycles();
        console.log('[Server] บันทึกข้อมูลรอบปลูกเรียบร้อย');
    } catch (e) {
        console.error('[Server] บันทึกข้อมูลรอบปลูกไม่สำเร็จ:', e.message);
    }
    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// ============================================================
//  Start
// ============================================================

// ต้องโหลดการตั้งค่า + สถานะโปรแกรมให้เสร็จก่อน listen — ไม่งั้นข้อมูลแรกจาก ESP32
// จะถูกประมวลผลด้วยค่าตั้งต้น (Auto Mode ปิด) ก่อนที่สถานะจริงจะโหลดกลับมา
async function boot() {
    persist.initDefaultAdmin();
    persist.loadHistory();
    try {
        await persist.loadAutoSettings(am.autoSettings);
    } catch (e) {
        console.error('[AutoSettings] โหลดไม่สำเร็จ ใช้ค่าตั้งต้น:', e.message);
    }
    am.normalizeSettings();
    try {
        await am.restoreProgram();
    } catch (e) {
        console.error('[Program] โหลดสถานะไม่สำเร็จ เริ่มแบบ MANUAL:', e.message);
    }
    cropCycles.ensureDataDir();
    cropCycles.loadActiveCyclesOnBoot()
        .catch(e => console.error('[Crops] โหลดรอบปลูกตอน boot ไม่สำเร็จ:', e.message));

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`\n============================`);
        console.log(`  Smart Farm Server`);
        console.log(`  http://localhost:${PORT}`);
        console.log(`============================\n`);
    });
}

boot();
