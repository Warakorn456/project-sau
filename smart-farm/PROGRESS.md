# Smart Farm — บันทึกความคืบหน้า (PROGRESS)

> ไฟล์นี้สรุปว่าโปรเจกต์ทำอะไร แก้อะไรไปแล้ว และอยู่ขั้นตอนไหน
> สำหรับให้ตัวเอง/AI session ใหม่เข้าใจ context ได้เร็ว (อ่านคู่กับ `CLAUDE.md`)

---

## โปรเจกต์นี้คืออะไร

**ระบบปลูกผักไฮโดรโปนิกส์อัตโนมัติ** 3 ส่วน:
- **ESP32** (`smart-farm/esp32/smart_farm/smart_farm.ino`) — อ่านเซ็นเซอร์ + ควบคุม relay 10 ตัว
- **Node.js server** (`smart-farm/server/`) — รับข้อมูล, Auto Mode, เก็บประวัติ, broadcast Socket.io
- **Web dashboard** — แสดงผล real-time + กราฟ + ควบคุม relay

ESP32 ส่งข้อมูลไป **cloud server: `https://project-sau.onrender.com`** (ตั้งใน `SERVER_URL` ของ .ino) ทุก 5 วินาที

---

## สถานะเซ็นเซอร์ (อัปเดต 2026-06-19)

| ค่า | เซ็นเซอร์ | ขา | สถานะ |
|-----|-----------|-----|-------|
| อุณหภูมิ / ความชื้น | DHT11 | GPIO4 | ✅ ใช้ได้ |
| แสง (lux) | BH1750 | I2C 21/22 | ✅ ใช้ได้ |
| แรงดัน/กระแส/กำลัง | INA219 | I2C 21/22 | ✅ ใช้ได้ |
| ระดับน้ำ 7 ถัง | Ultrasonic SR04M-2 | TRIG=25, ECHO=26,27,32,33,VP(36),VN(39) | ✅ ใช้ได้ครบ 7 |
| pH ลัง1 | pH probe (PH-4502C) | GPIO34 | ❌ สัญญาณยังไม่นิ่ง (ดูหัวข้อ pH ด้านล่าง) |
| pH ลัง2 | — | — | ⚠️ ต้องเพิ่ม **ADS1115** (GPIO13 ถูกย้ายไปทำ relay) |

---

## สิ่งที่แก้ล่าสุด (Server code review — 2026-06-18/19)

**Commit: "Security + bug fixes"** — push แล้ว ✅ Render deploy ใหม่แล้ว

### Bug fixes
1. **NaN bug ใน `routes.js`** (`/api/auto-settings`)
   - `parseInt(s.tray1Sensor) ?? 3` → ผิด เพราะ `parseInt(undefined) = NaN`, `NaN ?? 3 = NaN`
   - แก้เป็น `parseInt(s.tray1Sensor) >= 0 ? parseInt(s.tray1Sensor) : 3`
   - แก้ทั้ง `tray1Sensor` (line 203) และ `tray2Sensor` (line 210)

2. **Session expiry silent failure ใน `dashboard.js`**
   - เพิ่ม `checkSession(r)` function ตรวจ redirect ไป `/login`
   - แสดง toast "Session หมดอายุ" แล้ว redirect อัตโนมัติ
   - ใช้ใน `loadMe()` และ `toggleProgram()`

3. **START button ไม่มี feedback ใน `dashboard.js`**
   - เพิ่ม optimistic UI: ปุ่ม disabled + "กำลังเริ่ม..." ขณะรอ fetch
   - อัปเดต UI ทันทีเมื่อ API ตอบกลับ ไม่ต้องรอ Socket.io

### Security
4. **Rate limiting บน `/login`** (routes.js)
   - ติดตั้ง `express-rate-limit` แล้ว
   - จำกัด 10 ครั้ง / 15 นาที ต่อ IP
   - ป้องกัน brute force password

---

## สถานะ pH ลัง1 (ปัญหาที่ยังค้างอยู่)

### อาการ
- raw ADC (GPIO34) แกว่ง 1041–3219 mV ไม่มีแพทเทิร์น
- pH คำนวณออกมา 3–15 กระโดดทุก reading
- ไม่ใช่ปัญหา calibration — เป็นปัญหา hardware noise

### สิ่งที่ต้องแก้ (ตามลำดับ)
1. **จุ่ม probe ในน้ำ** — probe ในอากาศ = input ลอย = ค่ากระโดด
2. **GND ต้องแน่นจริง** — บัดกรีหรือเสียบตรง ไม่ผ่าน breadboard หลายรู
3. **ต่อ capacitor 100nF (ceramic)** ระหว่าง GPIO34 กับ GND — กรอง noise
4. **calibrate หลังสัญญาณนิ่งแล้ว** — ใช้ buffer solution pH4 และ pH7 วัด Po voltage ทั้งสอง
   - `Slope = (V_pH4 - V_pH7) / 3.0` (V/pH)
   - แก้ค่า `Slope` ใน `readPH()` ของ `smart_farm.ino`
   - ลบ debug print `[pH-DBG]` หลัง calibrate เสร็จ

### สูตร pH ปัจจุบันใน firmware
```cpp
float pH = 7.0 + (2.5 - voltage) / Slope;  // Slope ปัจจุบัน = 0.18 V/pH
```

---

## สิ่งที่แก้ก่อนหน้า (water level debugging — 2026-06-17)

ปัญหาเดิม: **ค่าระดับน้ำไม่เข้า**. ไล่แก้จนครบ 7 ตัว:

1. **เดิมอ่านแค่เซ็นเซอร์ตัวเดียว** → วนอ่านครบ 7
2. **เข้าใจ protocol ผิด** — SR04M-2 (ป้ายขา TX/RX) จริงๆ ทำงานแบบ **trigger/echo เหมือน HC-SR04** ไม่ใช่ UART
3. **ยิง trigger ครั้งเดียว อ่าน echo 7 ขาพร้อมกัน** (`triggerAndReadAll`/`measureAllDistances`)
4. **I2C guard** (`bh1750Ok`/`ina219Ok`) — ถ้า setup ไม่เจอ BH1750/INA219 จะข้ามการอ่าน ไม่งั้น `Wire` ค้างทั้ง loop
5. **ฟิลเตอร์ crosstalk** — ทิ้งค่า dist > ความสูงถัง +10cm
6. **hold ค่าล่าสุด** (`static lastWl[7]`) — กันค่ากระพริบเป็น -1

---

## บทเรียน/กับดักสำคัญ (อย่าหลงซ้ำ)

- **SR04M-2 = trigger/echo ไม่ใช่ UART** (เสียเวลาไล่ UART หลายชั่วโมง)
- **ชื่อขา ESP32:** GPIO36 = **VP**, GPIO39 = **VN** (ไม่พิมพ์เลข). EN = reset ห้ามต่อ
- **I2C guard เช็คแค่ตอน setup** — ต่อ BH1750/INA219 กลับต้อง **กด EN รีบูต**
- **อย่าขนาน PSU 5V 2 ตัว** — เกิด ground offset กวน I2C จนค้าง
- **common ground จุดเดียว** — ไม่งั้น ESP32 brownout reboot (`RTCWDT_RTC_RESET`)
- **upload ติด "No serial data received"** → ถอดสาย USB เสียบใหม่ + กด BOOT(ค้าง)+EN
- **`parseInt(x) ?? default` ไม่ทำงาน** ถ้า x เป็น undefined เพราะ `NaN ?? 3 = NaN` — ใช้ `>= 0 ? x : default` แทน

---

## TODO ที่ยังค้างอยู่ (เรียงตามความสำคัญ)

### Hardware
- [ ] **แก้ pH ลัง1 ให้นิ่งก่อน** — probe จุ่มน้ำ + GND แน่น + cap 100nF → แล้วค่อย calibrate
- [ ] **pH ลัง2** — ซื้อ ADS1115 ต่อ GPIO (I2C ได้เลย), แก้ firmware อ่านผ่าน `ads.readADC_SingleEnded(0)`
- [ ] **ติดตั้งจริงแยกถัง** — crosstalk จะหายเมื่อแต่ละถังมีผนังกั้น

### Software (pending)
- [ ] **programState persistence** — ถ้า Render restart → `programState.running` reset กลับ false, สถานะเดิมหาย
  - แก้: save/load `programState` ใน `persistence.js` (คล้าย `auto-settings.json`)
- [ ] **UX: water level -1% / 0% false alarm** — ถัง index 3,4,5,6 ที่ยังไม่ได้ใส่เซ็นเซอร์ แสดง "วิกฤต" ผิด
  - แก้: ถ้า hold ยังเป็น -1 ให้แสดง "—" แทนตัวเลข
- [ ] **SESSION_SECRET warning** — ถ้าไม่ set env var ใน Render จะใช้ fallback ไม่ปลอดภัย
  - แก้: เพิ่ม `if (!process.env.SESSION_SECRET) console.warn(...)` ใน server.js
