// ============================================================
//  persistence.js — File I/O: users, auto-settings, history
// ============================================================

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const stateStore = require('./stateStore');
const { pctToMm } = require('./public/js/sim-profiles');

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
    // ไม่ต้องรอ — ล็อกอินผ่านแล้ว อัปเกรดไม่สำเร็จก็แค่อัปเกรดใหม่ครั้งหน้า
    saveUsers(users).then(ok => console.log(ok
        ? `[Users] อัปเกรดรหัสผ่านของ ${username} เป็น scrypt`
        : '[Users] อัปเกรดรหัสผ่านไม่สำเร็จ'));
    return true;
}

function findUser(username) {
    return loadUsers().find(u => u.username === username) || null;
}

// ============================================================
//  ผู้ใช้เก็บผ่าน stateStore key 'users' (Supabase app_state หรือ data/app-state.json)
//  เดิมเก็บแค่ users.json ซึ่งหายทุกครั้งที่ Render restart / redeploy / spin down
//  → user ที่เพิ่มในหน้าจัดการผู้ใช้หายเงียบๆ  users.json อ่านแค่ตอน boot เพื่อ migrate
//
//  เก็บสำเนาไว้ใน memory (usersCache) — login/route อ่านแบบ sync ได้เหมือนเดิม
//  เขียนเป็น async: saveUsers() คืน true/false ให้ route บอกผู้ใช้ตรงๆ เมื่อบันทึกไม่สำเร็จ
// ============================================================

let usersCache = [];
// false = อ่านจาก Supabase ไม่ได้ตอน boot → ห้ามเขียนทับ ไม่งั้นรายชื่อจริงบน Supabase
// ถูกแทนด้วยรายการว่าง/admin คนเดียวที่สร้างขึ้นตอนนี้
let usersWritable = true;

const cloneUsers = users => users.map(u => ({ ...u }));

function readUsersFile() {
    try {
        if (fs.existsSync(USERS_FILE)) return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } catch (e) {
        console.error('[Users] อ่าน users.json ไม่สำเร็จ:', e.message);
    }
    return [];
}

async function loadUsersOnBoot() {
    try {
        await loadUsersFromStore();
    } catch (e) {
        usersWritable = false;   // ไม่รู้ว่าข้างนอกมีอะไร — อย่าเขียนทับ
        console.error('[Users] โหลดรายชื่อผู้ใช้ไม่สำเร็จ:', e.message);
    }
}

async function loadUsersFromStore(retries = 2) {
    let saved = await stateStore.readState('users');
    // null = อ่านไม่ได้ (เน็ต/Supabase สะดุด, ยังไม่มีตาราง app_state) — ลองซ้ำก่อนยอมแพ้
    for (let i = 0; saved === null && i < retries; i++) {
        await new Promise(r => setTimeout(r, 2000));
        saved = await stateStore.readState('users');
    }

    if (saved === null) {
        usersWritable = false;
        // ครั้งแรก (cache ว่าง) ใช้ users.json ถ้ามี — ครั้งที่ลองซ้ำทีหลังไม่แตะ cache ที่ล็อกอินอยู่
        if (!usersCache.length) usersCache = readUsersFile();
        console.error('[Users] ⚠️ อ่านรายชื่อผู้ใช้ไม่ได้ — ใช้ชั่วคราวใน memory ไม่บันทึกทับ ' +
                      '(จะลองอ่านใหม่ตอนเพิ่ม/ลบผู้ใช้):', stateStore.getLastError());
        return;
    }

    usersWritable = true;
    if (Array.isArray(saved)) {
        usersCache = saved;
        console.log(`[Users] Loaded ${saved.length} users`);
        return;
    }

    // ยังไม่มี key 'users' — ย้ายจาก users.json เดิม (ครั้งเดียว)
    usersCache = readUsersFile();
    if (usersCache.length && await stateStore.writeState('users', usersCache)) {
        console.log(`[Users] ย้าย ${usersCache.length} users จาก users.json เดิม`);
    }
}

// เรียกก่อนเพิ่ม/ลบผู้ใช้ — ถ้าตอน boot อ่านไม่ได้ ลองอ่านใหม่ตอนนี้ (เช่น เพิ่งสร้างตาราง app_state)
// คืน true ถ้าเขียนได้แล้ว ไม่ต้อง restart server
async function ensureUsersWritable() {
    if (usersWritable) return true;
    await loadUsersFromStore(0);
    if (usersWritable) await initDefaultAdmin();   // รายชื่อใหม่อาจยังไม่มี admin
    return usersWritable;
}

// เหตุผลที่บันทึกไม่ได้ล่าสุด (ข้อความจาก Supabase/ไฟล์) — ให้หน้าเว็บของ admin แสดง
function usersStoreError() {
    return stateStore.getLastError();
}

function loadUsers() {
    return cloneUsers(usersCache);
}

async function saveUsers(users) {
    if (!usersWritable) {
        console.error('[Users] ไม่บันทึก — ยังอ่านรายชื่อผู้ใช้จากที่เก็บไม่ได้');
        return false;
    }
    const ok = await stateStore.writeState('users', users);
    if (ok) usersCache = cloneUsers(users);
    return ok;
}

const DEFAULT_ADMIN_PASS = 'farm1234';

// เรียกหลัง loadUsersOnBoot()
// ADMIN_PASS ที่ตั้งไว้ใน env เป็นรหัสของ ADMIN_USER เสมอ (ซิงก์ทุก boot) — เดิม users.json หาย
// ทุก restart admin จึงถูกสร้างใหม่จาก env ทุกครั้ง ตอนนี้รายชื่อรอดแล้ว ถ้าไม่ซิงก์
// การเปลี่ยน ADMIN_PASS บน Render จะไม่มีผล (ไม่มีหน้าเปลี่ยนรหัสในเว็บ)
async function initDefaultAdmin() {
    // ถ้าไม่ได้ตั้ง รหัสจะเป็นค่าตั้งต้นที่เขียนอยู่ในเอกสารของโปรเจกต์ ต้องเตือนให้เห็นชัด
    if (!process.env.ADMIN_PASS || process.env.ADMIN_PASS === DEFAULT_ADMIN_PASS) {
        console.warn('============================================================');
        console.warn('  ⚠️  ADMIN_PASS ยังเป็นค่าตั้งต้น (farm1234) — ใครก็เข้าหน้าควบคุมได้');
        console.warn('      ตั้ง ADMIN_PASS ใน .env หรือ Environment ของ Render');
        console.warn('============================================================');
    }

    const username = process.env.ADMIN_USER || 'admin';
    const password = process.env.ADMIN_PASS || DEFAULT_ADMIN_PASS;
    const users = loadUsers();
    const existing = users.find(u => u.username === username);

    let msg = null;
    if (users.length === 0 || (process.env.ADMIN_PASS && !existing)) {
        const salt = crypto.randomBytes(16).toString('hex');
        users.push({ username, salt, passwordHash: hashPassword(password, salt), role: 'admin' });
        msg = `Created admin: ${username}`;
    } else if (process.env.ADMIN_PASS && existing &&
               (existing.role !== 'admin' ||
                !safeEqual(hashPassword(password, existing.salt), existing.passwordHash))) {
        existing.role = 'admin';
        existing.passwordHash = hashPassword(password, existing.salt);
        msg = `ซิงก์รหัสของ ${username} ตาม ADMIN_PASS`;
    }
    if (!msg) return;

    // บันทึกไม่ได้ก็ยังต้องล็อกอินได้ — ใส่ใน memory ไว้ก่อน
    if (!(await saveUsers(users))) usersCache = cloneUsers(users);
    console.log(`[Users] ${msg}`);
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
        const migrated = migrateWaterUnit(saved);
        Object.assign(autoSettings, saved);
        console.log('[AutoSettings] Loaded');
        if (migrated) await stateStore.writeState('autoSettings', autoSettings);
    }
}

// ระดับน้ำเปลี่ยนจาก % เป็น mm (2026-10-11) — ค่าที่บันทึกไว้ก่อนหน้าไม่มี waterUnit:'mm'
// แปลงตามความลึกของถังที่ฟิลด์นั้นอ้าง (Refill → RefillSensor, Fill/Drain → Sensor)
// ต้องทำกับ saved ก่อน merge: หลัง merge แล้ว waterUnit มาจากค่าตั้งต้นจะแยกไม่ออก
function migrateWaterUnit(saved) {
    if (saved.waterUnit === 'mm') return false;
    for (const t of [1, 2]) {
        const p = `tray${t}`;
        const def = t === 1 ? 3 : 5;
        const sensorOf = key => Number.isInteger(saved[key]) ? saved[key] : def;
        const fields = [
            [`${p}RefillMin`,   sensorOf(`${p}RefillSensor`)],
            [`${p}RefillMax`,   sensorOf(`${p}RefillSensor`)],
            [`${p}FillTarget`,  sensorOf(`${p}Sensor`)],
            [`${p}DrainTarget`, sensorOf(`${p}Sensor`)]
        ];
        for (const [key, sensor] of fields) {
            if (typeof saved[key] === 'number') saved[key] = pctToMm(saved[key], sensor);
        }
    }
    saved.waterUnit = 'mm';
    console.log('[AutoSettings] แปลงระดับน้ำจาก % เป็น mm');
    return true;
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
    loadUsersOnBoot,
    ensureUsersWritable,
    usersStoreError,
    initDefaultAdmin,
    loadAutoSettings,
    saveAutoSettings,
    loadHistory,
    saveHistory,
    recordHistory,
    getHistoryData
};
