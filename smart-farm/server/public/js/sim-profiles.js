// ============================================================
//  ช่วง pH และอายุเก็บเกี่ยวตั้งต้นของแต่ละผัก (ข้อมูลจำลอง) — ค่าทั่วไปของไฮโดรโปนิกส์
//
//  ใช้ร่วมกัน 2 ฝั่ง ที่เดียว:
//    - browser: <script> ก่อน dashboard.js → SIM_CROP_PROFILES / SIM_DEFAULT_PROFILE / simProfile เป็น global
//    - server:  require('./public/js/sim-profiles') ใน routes.js — ส่งช่วง pH ของรอบที่เก็บเกี่ยวแล้ว
//               ให้ viewer โดยไม่ส่งชื่อผัก (ค่าจำลองของ viewer กับ admin จึงตรงกัน)
// ============================================================
(function (root) {
    const SIM_CROP_PROFILES = {
        'ผักกาดหอม': { ph: [5.5, 6.5], days: 35 },
        'กรีนโอ๊ค':  { ph: [5.5, 6.5], days: 35 },
        'เรดโอ๊ค':   { ph: [5.5, 6.5], days: 35 },
        'คอส':       { ph: [5.5, 6.5], days: 40 },
        'ผักบุ้ง':    { ph: [5.5, 6.5], days: 25 },
        'คะน้า':     { ph: [6.0, 7.0], days: 40 },
        'กวางตุ้ง':  { ph: [6.0, 7.0], days: 30 },
        'ผักโขม':    { ph: [6.0, 7.0], days: 35 },
        'ขึ้นฉ่าย':   { ph: [6.0, 7.0], days: 50 },
        'โหระพา':    { ph: [5.5, 6.5], days: 40 }
    };
    const SIM_DEFAULT_PROFILE = { ph: [5.5, 6.5], days: 30 };
    const simProfile = name => SIM_CROP_PROFILES[(name || '').trim()] || SIM_DEFAULT_PROFILE;

    const api = { SIM_CROP_PROFILES, SIM_DEFAULT_PROFILE, simProfile };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else Object.assign(root, api);
})(this);
