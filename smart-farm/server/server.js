// ============================================================
//  server.js — Entry point (thin main file)
// ============================================================

require('dotenv').config();

const express    = require('express');
const session    = require('express-session');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');

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
        console.log('[Server] ESP32 disconnected (timeout)');
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
    persist.saveAutoSettingsToFile(am.autoSettings);
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

persist.initDefaultAdmin();
persist.loadHistory();
persist.loadAutoSettings(am.autoSettings);
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
