// ============================================================
//  state.js — Shared mutable state across modules
// ============================================================

const state = {
    sensorData: {
        temperature: 0,
        humidity:    0,
        light:       0,
        ph:          7.0,
        ph2:         7.0,
        voltage:     0,
        current:     0,
        power:       0,
        waterLevel:  [-1, -1, -1, -1, -1, -1],   // mm, -1 = ยังไม่ได้ค่า/เซ็นเซอร์ไม่ตอบ
        connected:   false,
        timestamp:   null
    },
    relayStates:   new Array(8).fill(false),   // ต้องเท่า RELAY_COUNT ใน autoMode.js
    lastESP32Ping: 0,
    // หน้าประวัติ/รายงานแสดงค่าย้อนหลังจำลองแทนค่าจริง (สวิตช์ในหน้าควบคุม, stateStore key 'simHistory')
    simHistory:    false,
    // เวลา (ms) ที่ server เริ่มเก็บระดับน้ำเป็น mm — record ก่อนหน้านี้เป็น % (หน้าเว็บแปลงตอนอ่าน)
    // stateStore key 'waterMmSince' ตั้งครั้งเดียวตอน boot แรกของโค้ดรุ่น mm
    waterMmSince:  null
};

module.exports = state;
