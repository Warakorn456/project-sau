// ============================================================
//  ช่วง pH และอายุเก็บเกี่ยวตั้งต้นของแต่ละผัก (ข้อมูลจำลอง) — ค่าทั่วไปของไฮโดรโปนิกส์
//
//  ใช้ร่วมกัน 2 ฝั่ง ที่เดียว:
//    - browser: <script> ก่อน dashboard.js → SIM_CROP_PROFILES / SIM_DEFAULT_PROFILE / simProfile เป็น global
//    - server:  require('./public/js/sim-profiles') ใน routes.js — ส่งช่วง pH ของรอบที่เก็บเกี่ยวแล้ว
//               ให้ viewer โดยไม่ส่งชื่อผัก (ค่าจำลองของ viewer กับ admin จึงตรงกัน)
//               + TANK_DEPTH_MM ที่ routes.js / autoMode.js / dashboard.js ใช้ร่วมกัน
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

    // ความลึกถัง (mm, ปากถังถึงก้น) ตาม index waterLevel — ต้องตรงกับ TANK_DEPTH_MM ใน smart_farm.ino
    // [0]=ถังน้ำวนลัง2 [1]=ถัง PH [2]=ถังน้ำเติม [3]=ลังปลูกผัก1 [4]=ถังน้ำวนลัง1 [5]=ลังปลูกผัก2
    // ระดับน้ำทั้งระบบเป็น mm จากก้นถัง (-1 = เซ็นเซอร์ไม่ตอบ) — เดิมเป็น % ใช้ pctToMm แปลงค่าเก่า
    const TANK_DEPTH_MM = [300, 300, 300, 150, 300, 150];
    const pctToMm = (pct, i) => (typeof pct === 'number' && pct >= 0)
        ? Math.round(pct / 100 * TANK_DEPTH_MM[i]) : pct;

    const api = { SIM_CROP_PROFILES, SIM_DEFAULT_PROFILE, simProfile, TANK_DEPTH_MM, pctToMm };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else Object.assign(root, api);
})(this);
