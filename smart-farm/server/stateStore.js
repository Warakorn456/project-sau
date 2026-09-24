// ============================================================
//  stateStore.js — เก็บสถานะของระบบที่ต้องรอด restart (key → value)
//
//  ใช้กับ: การตั้งค่า Auto Mode ('autoSettings') และสถานะโปรแกรม ('program')
//  ไฟล์บน Render หายทุกครั้งที่ redeploy / restart / spin down — ถ้าเก็บแค่ในไฟล์
//  ฟาร์มจะกลับเป็น MANUAL เงียบๆ หลัง restart ทุกครั้ง จึงเก็บบน Supabase เมื่อตั้ง env ไว้
//
//  1) Supabase: ตาราง app_state (key, value jsonb) — ดู supabase-setup.sql
//  2) ไฟล์:     data/app-state.json (โหมดรันในเครื่อง)
//
//  กลืน error เองและคืนค่าปลอดภัย — ระบบรดน้ำต้องไม่ล้มเพราะฐานข้อมูลล่ม
// ============================================================

const path = require('path');
const fs   = require('fs');
const { useSupabase, sbFetch } = require('./supabaseClient');

const STATE_FILE = path.join(__dirname, 'data', 'app-state.json');

function readFileState() {
    return fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
}

// คืน value, undefined ถ้าไม่มี key นี้, null ถ้าอ่านไม่ได้
async function readState(key) {
    if (useSupabase) {
        try {
            const res  = await sbFetch(`app_state?key=eq.${encodeURIComponent(key)}&select=value`);
            const rows = await res.json();
            return rows.length ? rows[0].value : undefined;
        } catch (e) {
            console.error(`[StateStore] อ่าน ${key} จาก Supabase ไม่สำเร็จ:`, e.message);
            return null;
        }
    }
    try {
        return readFileState()[key];
    } catch (e) {
        console.error(`[StateStore] อ่าน ${key} จากไฟล์ไม่สำเร็จ:`, e.message);
        return null;
    }
}

async function writeState(key, value) {
    if (useSupabase) {
        try {
            await sbFetch('app_state', {
                method: 'POST',
                headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
                body: JSON.stringify([{ key, value, updated_at: new Date().toISOString() }])
            });
            return true;
        } catch (e) {
            console.error(`[StateStore] เขียน ${key} ลง Supabase ไม่สำเร็จ:`, e.message);
            return false;
        }
    }
    try {
        fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
        const all = readFileState();
        all[key] = value;
        fs.writeFileSync(STATE_FILE, JSON.stringify(all, null, 2));
        return true;
    } catch (e) {
        console.error(`[StateStore] เขียน ${key} ลงไฟล์ไม่สำเร็จ:`, e.message);
        return false;
    }
}

module.exports = { readState, writeState };
