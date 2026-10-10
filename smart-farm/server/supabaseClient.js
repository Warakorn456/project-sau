// ============================================================
//  supabaseClient.js — ตัวคุยกับ Supabase (PostgREST) ที่ใช้ร่วมกันทุก store
//
//  ตั้ง SUPABASE_URL + SUPABASE_SERVICE_KEY แล้วข้อมูลจะไปอยู่บน Postgres ของ Supabase
//  ไม่ตั้ง = แต่ละ store เก็บลงไฟล์ในเครื่องเอง (โหมดรันในเครื่อง)
//
//  ใช้ fetch ที่มีมากับ Node 18+ จึงไม่ต้องเพิ่ม dependency
// ============================================================

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const useSupabase  = Boolean(SUPABASE_URL && SUPABASE_KEY);

async function sbFetch(pathAndQuery, options = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
        ...options,
        headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`${res.status} ${res.statusText} ${body.slice(0, 200)}`);
    }
    return res;
}

// project ref = ส่วนหน้าของ host (xxxx.supabase.co) — ไม่ใช่ความลับ ใช้บอกว่า server ต่อโปรเจกต์ไหน
const SUPABASE_REF = (() => {
    try { return new URL(SUPABASE_URL).host.split('.')[0]; } catch { return ''; }
})();

// ตารางนี้มีอยู่ในโปรเจกต์ที่ server ต่ออยู่ไหม — ใช้วิเคราะห์ error PGRST205 (หาตารางไม่เจอ)
async function tableExists(name) {
    try {
        await sbFetch(`${name}?select=*&limit=0`);
        return true;
    } catch (e) {
        return /PGRST205|42P01/.test(e.message) ? false : null;   // null = ไม่แน่ใจ (เน็ต/สิทธิ์)
    }
}

module.exports = { SUPABASE_URL, SUPABASE_REF, useSupabase, sbFetch, tableExists };
