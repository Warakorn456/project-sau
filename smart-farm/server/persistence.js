// ============================================================
//  persistence.js — File I/O: users, auto-settings, history
// ============================================================

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const stateStore = require('./stateStore');

// ============================================================
//  File paths
// ============================================================

const USERS_FILE         = path.join(__dirname, 'users.json');
const AUTO_SETTINGS_FILE = path.join(__dirname, 'auto-settings.json');
const HISTORY_FILE       = path.join(__dirname, 'history.json');

// ============================================================
//  History constants
// ============================================================

const HISTORY_MAX_MS  = 24 * 60 * 60 * 1000; // 24 ชั่วโมง
const RECORD_INTERVAL = 60 * 1000;            // บันทึกทุก 1 นาที
const SAVE_INTERVAL   = 5  * 60 * 1000;       // เขียนไฟล์ทุก 5 นาที

let historyData    = [];
let lastRecordTime = 0;
let lastSaveTime   = 0;

// ============================================================
//  User helpers
// ============================================================

// รหัสผ่านเก็บเป็น "scrypt$<hex>" — scrypt ช้าโดยตั้งใจ ถ้า users.json หลุดออกไปจะเดารหัสได้ยาก
// รูปแบบเก่า (HMAC-SHA256 รอบเดียว ไม่มี prefix) ยังล็อกอินได้ และถูกอัปเกรดเป็น scrypt
// ตอนล็อกอินสำเร็จครั้งแรก (ดู verifyPassword) จึงไม่ต้องให้ใครตั้งรหัสใหม่
const SCRYPT_PREFIX = 'scrypt$';

function hashPassword(password, salt) {
    return SCRYPT_PREFIX + crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function legacyHash(password, salt) {
    return crypto.createHmac('sha256', salt).update(String(password)).digest('hex');
}

function safeEqual(a, b) {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// คืน true ถ้ารหัสถูก — ถ้าผ่านด้วยรูปแบบเก่า จะอัปเกรดแล้วบันทึกทันที
function verifyPassword(username, password) {
    if (typeof username !== 'string' || typeof password !== 'string') return false;
    const users = loadUsers();
    const user  = users.find(u => u.username === username);
    if (!user) return false;

    if (String(user.passwordHash).startsWith(SCRYPT_PREFIX)) {
        return safeEqual(hashPassword(password, user.salt), user.passwordHash);
    }
    if (!safeEqual(legacyHash(password, user.salt), user.passwordHash)) return false;

    user.passwordHash = hashPassword(password, user.salt);
    try {
        saveUsers(users);
        console.log(`[Users] อัปเกรดรหัสผ่านของ ${username} เป็น scrypt`);
    } catch (e) {
        console.error('[Users] อัปเกรดรหัสผ่านไม่สำเร็จ:', e.message);
    }
    return true;
}

function findUser(username) {
    return loadUsers().find(u => u.username === username) || null;
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

const DEFAULT_ADMIN_PASS = 'farm1234';

function initDefaultAdmin() {
    // users.json บน Render หายทุก restart → admin ถูกสร้างใหม่จาก ADMIN_PASS ทุกครั้ง
    // ถ้าไม่ได้ตั้ง รหัสจะเป็นค่าตั้งต้นที่เขียนอยู่ในเอกสารของโปรเจกต์ ต้องเตือนให้เห็นชัด
    if (!process.env.ADMIN_PASS || process.env.ADMIN_PASS === DEFAULT_ADMIN_PASS) {
        console.warn('============================================================');
        console.warn('  ⚠️  ADMIN_PASS ยังเป็นค่าตั้งต้น (farm1234) — ใครก็เข้าหน้าควบคุมได้');
        console.warn('      ตั้ง ADMIN_PASS ใน .env หรือ Environment ของ Render');
        console.warn('============================================================');
    }

    const users = loadUsers();
    if (users.length === 0) {
        const username = process.env.ADMIN_USER || 'admin';
        const password = process.env.ADMIN_PASS || DEFAULT_ADMIN_PASS;
        const salt = crypto.randomBytes(16).toString('hex');
        users.push({ username, salt, passwordHash: hashPassword(password, salt), role: 'admin' });
        saveUsers(users);
        console.log(`[Users] Created default admin: ${username}`);
    }
}

// ============================================================
//  Auto-settings persistence — เก็บผ่าน stateStore (Supabase หรือไฟล์)
//  auto-settings.json เดิมอ่านเป็น fallback ครั้งเดียวเพื่อ migrate
// ============================================================

async function loadAutoSettings(autoSettings) {
    let saved = await stateStore.readState('autoSettings');
    if (saved === undefined) {
        try {
            if (fs.existsSync(AUTO_SETTINGS_FILE)) {
                saved = JSON.parse(fs.readFileSync(AUTO_SETTINGS_FILE, 'utf8'));
                console.log('[AutoSettings] ย้ายจาก auto-settings.json เดิม');
                await stateStore.writeState('autoSettings', saved);
            }
        } catch (e) {
            console.error('[AutoSettings] อ่าน auto-settings.json ไม่สำเร็จ:', e.message);
        }
    }
    if (saved && typeof saved === 'object') {
        Object.assign(autoSettings, saved);
        console.log('[AutoSettings] Loaded');
    }
}

async function saveAutoSettings(autoSettings) {
    const ok = await stateStore.writeState('autoSettings', autoSettings);
    if (ok) console.log('[AutoSettings] Saved');
    return ok;
}

// ============================================================
//  History
// ============================================================

function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const raw    = fs.readFileSync(HISTORY_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            const cutoff = Date.now() - HISTORY_MAX_MS;
            historyData  = parsed.filter(d => new Date(d.ts).getTime() > cutoff);
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

// io is passed in so this module can emit 'historyPoint'
function recordHistory(data, io) {
    const now = Date.now();
    if (now - lastRecordTime < RECORD_INTERVAL) return;
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

function getHistoryData() {
    return historyData;
}

module.exports = {
    USERS_FILE,
    AUTO_SETTINGS_FILE,
    HISTORY_FILE,
    HISTORY_MAX_MS,
    RECORD_INTERVAL,
    SAVE_INTERVAL,
    hashPassword,
    verifyPassword,
    findUser,
    loadUsers,
    saveUsers,
    initDefaultAdmin,
    loadAutoSettings,
    saveAutoSettings,
    loadHistory,
    saveHistory,
    recordHistory,
    getHistoryData
};
