// ============================================================
//  persistence.js — File I/O: users, auto-settings, history
// ============================================================

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

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

// ============================================================
//  Auto-settings persistence
// ============================================================

function loadAutoSettings(autoSettings) {
    try {
        if (fs.existsSync(AUTO_SETTINGS_FILE)) {
            const saved = JSON.parse(fs.readFileSync(AUTO_SETTINGS_FILE, 'utf8'));
            Object.assign(autoSettings, saved);
            console.log('[AutoSettings] Loaded from file');
        }
    } catch (e) {
        console.error('[AutoSettings] Load error:', e.message);
    }
}

function saveAutoSettingsToFile(autoSettings) {
    try {
        fs.writeFileSync(AUTO_SETTINGS_FILE, JSON.stringify(autoSettings, null, 2));
        console.log('[AutoSettings] Saved');
    } catch (e) {
        console.error('[AutoSettings] Save error:', e.message);
    }
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
    loadUsers,
    saveUsers,
    initDefaultAdmin,
    loadAutoSettings,
    saveAutoSettingsToFile,
    loadHistory,
    saveHistory,
    recordHistory,
    getHistoryData
};
