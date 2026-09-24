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

module.exports = { SUPABASE_URL, useSupabase, sbFetch };
