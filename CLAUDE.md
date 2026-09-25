# Smart Farm — CLAUDE.md

ระบบปลูกผักไฮโดรโปนิกส์อัตโนมัติ ประกอบด้วย ESP32 (อ่านเซ็นเซอร์/ควบคุม Relay) + Node.js Server (สมองกลาง) + Web Dashboard (แสดงผล Real-time)

## โครงสร้างโปรเจกต์

```
Project SAU/
├── index.html                          — Portfolio เจ้าของโปรเจกต์ (static)
└── smart-farm/
    ├── esp32/
    │   └── smart_farm/
    │       └── smart_farm.ino          — Firmware C++ สำหรับ ESP32
    └── server/
        ├── server.js                   — entry point (middleware, socket.io, shutdown)
        ├── routes.js                   — API routes ทั้งหมด
        ├── state.js                    — state กลางที่ทุก module ใช้ร่วมกัน
        ├── autoMode.js                 — Auto Mode (pH control, flood & drain)
        ├── persistence.js              — history.json, users.json (scrypt), auto-settings
        ├── stateStore.js               — สถานะที่ต้องรอด restart (autoSettings, program): ไฟล์ หรือ Supabase
        ├── supabaseClient.js           — sbFetch/useSupabase ที่ cropStore + stateStore ใช้ร่วมกัน
        ├── cropCycles.js               — รอบปลูก แยกตามลัง (logic)
        ├── cropStore.js                — ที่เก็บข้อมูลรอบปลูก: ไฟล์ หรือ Supabase
        ├── supabase-setup.sql          — SQL สร้างตาราง รันครั้งเดียวบน Supabase
        ├── package.json
        ├── Procfile                    — สำหรับ deploy บน Railway/Render
        ├── history.json                — ข้อมูลเซ็นเซอร์ย้อนหลัง 24h (auto-generated)
        ├── users.json                  — ผู้ใช้ (auto-generated)
        ├── data/crops/                 — รอบปลูก ตอนรันในเครื่อง (auto-generated, git ignore)
        ├── .env                        — credentials จริง (ไม่ commit)
        ├── .env.example                — template ตัวอย่าง
        ├── views/
        │   ├── login.html              — หน้า Login
        │   └── dashboard.html          — หน้า Dashboard (HTML structure)
        └── public/
            ├── css/style.css           — CSS ทั้งหมด
            └── js/dashboard.js         — Frontend JavaScript (Socket.io + Chart.js)
```

## สถาปัตยกรรม

```
ESP32 ──HTTP POST /api/data──▶ Node.js Server ──Socket.io──▶ Browser
  ▲      (ทุก 5 วินาที)              │                           │
  │                                  │ Auto Mode Logic            │
  └──── รับ relayStates กลับ ◀──────┘         กด Relay ──────────┘
                                                  POST /api/relay
```

**ข้อสำคัญ:** โปรเจกต์นี้ต้องการ Node.js server จริง — ไม่สามารถเป็น static file ได้ เพราะ ESP32 ต้องการ endpoint รับข้อมูล และ Auto Mode logic ต้องรันบน server ตลอดเวลา

## แต่ละภาษาทำอะไร

| ไฟล์ | ภาษา | หน้าที่ |
|------|------|---------|
| `smart_farm.ino` | C++ (Arduino) | อ่านเซ็นเซอร์, ส่งข้อมูลไป server, รับ/ปฏิบัติคำสั่ง Relay |
| `server.js` | Node.js (JS) | รับข้อมูล ESP32, Auto Mode, บันทึกประวัติ, broadcast Socket.io |
| `dashboard.html` + `login.html` | HTML | โครงสร้างหน้าเว็บ |
| `style.css` | CSS | ธีมสีเขียว, Responsive (mobile + desktop) |
| `dashboard.js` | JS (Browser) | อัปเดต UI real-time, กราฟ Chart.js, ส่งคำสั่ง Relay |
| `history.json` | JSON | เก็บข้อมูลเซ็นเซอร์ทุก 1 นาที ย้อนหลัง 24h |

## Hardware (ESP32)

### เซ็นเซอร์
| เซ็นเซอร์ | ขา | วัดอะไร |
|-----------|-----|---------|
| DHT11 | GPIO 4 | อุณหภูมิ (°C), ความชื้น (%) |
| BH1750 | I2C (SDA=21, SCL=22) | แสงสว่าง (lux) |
| INA219 | I2C (SDA=21, SCL=22) | แรงดัน (V), กระแส (A), กำลัง (W) |
| pH sensor ลัง1 | GPIO 34 (ADC1) | pH น้ำลัง1 |
| pH sensor ลัง2 | GPIO 39 = ขา **VN** (ADC1) | pH น้ำลัง2 — ย้ายมาจาก GPIO13 เดิม ไม่ต้องใช้ ADS1115 แล้ว |
| JSN-SR04T × 6 | TRIG=25, ECHO=26,27,32,33,35,36 | ระดับน้ำ 6 ถัง (%) — ECHO ตัวสุดท้าย GPIO36 = ขา **VP** |

**หมายเหตุบอร์ด (ESP32 DOIT DevKit V1 38pin):** ขา GPIO36/39 บนบอร์ดจริงไม่มีพิมพ์เลข "D36"/"D39" — พิมพ์เป็น **VP** (=36) และ **VN** (=39) แทน ต่อสายที่ขา VP/VN ให้ตรงกับที่โค้ดใช้เป็น 36/39

### Relay (8 ตัว) — Active LOW
จำนวนกำหนดที่ `RELAY_COUNT` ใน `.ino` และ `autoMode.js` + ความยาว `RELAY_NAMES` ใน `dashboard.js` — ต้องเท่ากันทั้ง 3 ที่

| Index | GPIO | ชื่อ | ใช้ใน Auto Mode |
|-------|------|------|------|
| R1 (0) | 2 | ปั๊มเติมลัง1 | `tray1RefillRelay` |
| R2 (1) | 5 | ปั๊มเติมลัง2 | `tray2RefillRelay` |
| R3 (2) | 13 | ปั๊มเติม PH ลัง1 | `ph1Relay` |
| R4 (3) | 23 | ปั๊มเติม PH ลัง2 | `ph2Relay` |
| R5 (4) | 14 | ถังน้ำวน1 → ลัง1 | `tray1FillRelay` |
| R6 (5) | 15 | ลัง1 → ถังน้ำวน1 | `tray1DrainRelay` |
| R7 (6) | 16 (ป้ายบอร์ด: RX2) | ถังน้ำวน2 → ลัง2 | `tray2FillRelay` |
| R8 (7) | 17 (ป้ายบอร์ด: TX2) | ลัง2 → ถังน้ำวน2 | `tray2DrainRelay` |

(เดิมมี 10 ตัว: สาร A/B แยกลัง + GPIO18/19 — ตัดออกเมื่อเปลี่ยนเป็นถัง PH ถังเดียว
`auto-settings.json` เก่าที่มี index 8/9 หรือ key `*UpRelay/*DownRelay` จะถูก `normalizeSettings()` ล้างตอน boot)

### ถัง 6 ถัง (Ultrasonic index) — ECHO ขาตามลำดับ 26, 27, 32, 33, 35, 36
```
[0]=ถังน้ำวนลัง2  [1]=ถัง PH        [2]=ถังน้ำเติม
[3]=ลังปลูกผัก1   [4]=ถังน้ำวนลัง1  [5]=ลังปลูกผัก2
```
ชื่อถังกำหนดที่ `WATER_NAMES` ใน `dashboard.js` ที่เดียว (ขับทั้งกราฟ, dropdown, สถานะรัน)
index 0/1 เคยเป็นถังสารA/สารB — record รอบปลูกเก่าจึงโชว์ค่าถังเดิมภายใต้ชื่อใหม่ ไม่ได้ migrate
ความสูงถังทุกตัวตั้งต้นที่ 50 ซม. — แก้ใน `TANK_HEIGHT[6]` ในไฟล์ .ino

## Server (Node.js)

### Dependencies
```
express         — HTTP server + routing
express-session — Login/session management
socket.io       — Real-time push to browser
dotenv          — โหลด .env
```

### Environment Variables (.env)
```
ADMIN_USER=admin
ADMIN_PASS=farm1234
SESSION_SECRET=<random string>
PORT=3000

# ที่เก็บข้อมูลรอบปลูกถาวร — ไม่ใส่ = เก็บลงไฟล์ data/crops/ เหมือนเดิม (โหมดรันในเครื่อง)
SUPABASE_URL=<Project URL จาก Supabase>
SUPABASE_SERVICE_KEY=<service_role key — ไม่ใช่ anon key>

# รหัสลับที่ ESP32 ส่งใน header X-Device-Key — ต้องตรงกับ DEVICE_KEY ใน smart_farm.ino
# ว่าง = ยอมรับทุกคำขอ (ตั้ง "หลัง" flash firmware ใหม่ ไม่งั้นบอร์ดเก่าโดน 401)
DEVICE_KEY=<32 hex>
```

ไม่ตั้ง `SESSION_SECRET` = สุ่มใหม่ทุก boot (ทุกคนต้องล็อกอินใหม่หลัง restart) / `ADMIN_PASS` ยังเป็น
`farm1234` = server เตือนใน log ทุกครั้งที่ boot — **ต้องตั้งทั้งคู่บน Render**

### API Routes
| Method | Path | ใช้โดย | หน้าที่ |
|--------|------|--------|---------|
| GET | `/` | Browser | หน้า Login |
| POST | `/login` | Browser | ตรวจสอบ credentials |
| GET | `/dashboard` | Browser | หน้า Dashboard (ต้อง auth) |
| GET | `/logout` | Browser | ออกจากระบบ |
| POST | `/api/data` | ESP32 | รับข้อมูลเซ็นเซอร์ → ตอบกลับด้วย relayStates — ต้องมี header `X-Device-Key` เมื่อตั้ง `DEVICE_KEY` (ไม่ตรง = 401) ค่าเซ็นเซอร์ที่อ่านไม่ได้เป็น `null` ไม่ใช่ 0 |
| GET | `/api/history` | Browser | ดึงประวัติ 24h |
| POST | `/api/relay` | Browser | สั่งเปิด/ปิด Relay (manual mode) |
| POST | `/api/mode` | Browser | สลับ AUTO / MANUAL |
| POST | `/api/auto-settings` | Browser | บันทึกการตั้งค่า Auto Mode |
| GET | `/api/crops` | Browser | `{trays, trayNames, actives:{1,2}, cycles}` — รอบที่ active แยกตามลัง |
| GET | `/api/crops/:id` | Browser | รายละเอียดรอบปลูก + `records` ทั้งหมด (มีฟิลด์ `tray`) |
| POST | `/api/crops/start` | Browser | body `{cropName, tray}` — admin, 400 ถ้าลังนั้นมีรอบ active อยู่ |
| POST | `/api/crops/:id/end` | Browser | เก็บเกี่ยว/ปิดรอบตาม id — admin |
| POST | `/api/crops/manual` | Browser | บันทึกค่าที่วัดด้วยมือ `{ts, t,h,l,p,p2,v,c, w:[6], note}` — admin, 400 ถ้าค่าเกินช่วง/เวลาอนาคต/ว่าง |
| DELETE | `/api/crops/manual/:id` | Browser | ลบค่าที่วัดด้วยมือ — admin |

### Socket.io Events (Server → Browser)
ต้องล็อกอินก่อน — `io.engine.use(sessionMiddleware)` + `io.use` ปฏิเสธด้วย `unauthorized`
(หน้าเว็บจับ `connect_error` แล้วพาไปหน้า login)

| Event | ข้อมูล |
|-------|--------|
| `sensorData` | ค่าเซ็นเซอร์ล่าสุด + connected status |
| `relayUpdate` | สถานะ relay ทั้ง 8 ตัว |
| `autoStatus` | สถานะ Auto Mode + countdown timer |
| `historyPoint` | จุดข้อมูลใหม่ทุก 1 นาที (append กราฟ) |

## Auto Mode Logic (server.js)

### pH Control
- เช็คทุกครั้งที่รับข้อมูลจาก ESP32
- ถัง PH เป็น**น้ำยาลด pH** ปั๊มเดียวต่อลัง — ถ้า pH สูงกว่า `ph1Max` → เปิด `ph1Relay` ชั่วคราว (`doseTime` วินาที)
- pH ต่ำกว่า `ph1Min` **ไม่ทำอะไร** (ไม่มีน้ำยาเพิ่ม pH แล้ว; `phXMin` เก็บไว้แค่แสดงช่วงเป้าหมาย)
- มี cooldown 5 นาทีระหว่าง dose

### Flood & Drain (ลัง 1 และ 2)
```
idle → filling → soaking → draining → idle (วนซ้ำทุก cycleHours ชั่วโมง)
```
- `filling`: เปิด fillRelay จนระดับน้ำถึง fillTarget% (หรือ safety timeout 30 นาที)
- `soaking`: ปิด fillRelay รอ soakTime นาที
- `draining`: เปิด drainRelay รอ drainTime นาที แล้วปิด schedule รอบถัดไป

### เติมน้ำ R1/R2 (`checkRefill`) — เติมจากถังน้ำเติม **เข้าลังปลูกโดยตรง**
- ⚠️ ห้ามเติมตามระดับลังตลอดเวลา: หลังระบายน้ำลังต่ำ (~20%) เป็นปกติ ถ้าเติมตอนนั้น ลังจะเต็มค้างจนรอบถัดไป
  (รากแช่น้ำหลายชั่วโมงแทน soakTime) — กฎอยู่ที่ `refillAllowed(idx)`:
  - เปิด Flood & Drain (`cycleHours > 0`): เติมได้เฉพาะช่วง `soaking`; เข้าช่วง filling/draining/idle = ปิดปั๊มเติมทันที
  - ปิด Flood & Drain (`cycleHours = 0`): ลังควรเต็มตลอด → เติมตามระดับ `refillMin`→`refillMax`

### สถานะรอด restart (`stateStore.js`)
- `autoSettings` และ `program` = `{running, startTime, mode, autoMode, trayNext:[ms,ms]}` เก็บที่ตาราง
  Supabase `app_state` (ไม่ตั้ง env = `data/app-state.json`) — `persistProgram()` ทุกครั้งที่เปลี่ยน/schedule
- boot: `server.js` รอโหลดให้เสร็จก่อน `listen` → `restoreProgram()` schedule ต่อด้วยเวลาที่เหลือ (เลยแล้ว = 1 นาที)
- `auto-settings.json` เดิมถูกอ่านเป็น fallback ครั้งเดียวเพื่อ migrate — เบราว์เซอร์ไม่ส่งสำเนาใน localStorage กลับไปทับแล้ว

### ตรวจค่าการตั้งค่า (`/api/auto-settings`)
- `num(v, def, min, max, label)` ค่าผิดช่วง = 400 พร้อมเหตุผล (ไม่เดาค่าให้) — `0` ใช้ได้ (`cycleHours 0` = ปิด)
- ข้ามฟิลด์: pHMin < pHMax, refillMin < refillMax, drainTarget < fillTarget

### Failsafe (firmware)
- ไม่ได้คำตอบที่ใช้ได้จาก server เกิน `FAILSAFE_MS` (30 วิ) → `checkFailsafe()` ปิด relay ทุกตัว
  (เรียกต้น `loop()` และในลูปรอ WiFi) — ไม่งั้นเน็ตหลุดตอนปั๊มเปิด = ปั๊มเปิดค้าง

## History Data

- บันทึกลง `history.json` ทุก 1 นาที, เขียนไฟล์ทุก 5 นาที
- เก็บย้อนหลัง 24 ชั่วโมง (max 1,440 รายการ)
- โหลดกลับอัตโนมัติเมื่อ server restart

```js
// รูปแบบแต่ละ record
{
  ts: "2024-01-01T12:00:00.000Z",
  t: 28.5,   h: 72.0,   l: 850,
  p: 6.2,    p2: 6.5,
  v: 12.1,   c: 1.23,   pw: 14.9,
  w: [45, 60, 80, 55, 70, 50]  // waterLevel 6 ถัง (%)
}
```

## รอบปลูก (Crop Cycles) — `cropCycles.js`

ลังปลูกมี 2 ลัง ปลูกคนละชนิดได้ และ **เริ่ม/เก็บเกี่ยวคนละวันได้** จึงมีรอบ active พร้อมกันลังละ 1 รอบ
(`activeCycles = {1: null, 2: null}`) แยกจาก `history.json` ตรงที่เก็บทุก record ไว้จนเก็บเกี่ยว ไม่ evict

**บันทึกทุก 5 นาที** (`RECORD_INTERVAL`) — 20 วัน = 5,760 records/ลัง ≈ 1.6 MB
ที่เก็บจริงอยู่ใน **`cropStore.js`** ซึ่งสลับได้ระหว่างไฟล์กับ Supabase ตาม env (ดูหัวข้อ deploy)
ฟังก์ชันที่แตะที่เก็บข้อมูลเป็น **async** หมด (`startCycle` / `endCycle` / `getCycleDetail` /
`saveActiveCycles` / `loadActiveCyclesOnBoot`) — route ที่เรียกต้อง `await`

```js
// index.json — 1 entry ต่อ 1 รอบปลูก
{ id: "cycle_t2_1788681344633_b0c201",   // "_t2_" เป็นแค่ป้ายให้คนอ่าน ห้าม parse
  tray: 2,                                // 1 | 2  ← อ่านลังจากฟิลด์นี้เสมอ
  cropName: "คะน้า", startTime: 1788681344633, endTime: null,
  status: "active",                       // "active" | "completed"
  recordCount: 1 }                        // อัปเดตตอน flush เท่านั้น (ล้าหลังได้ถึง 5 นาที)
```

**⚠️ record ใน `cycle_*.json` ไม่แยกตามลัง** — เป็นรูปแบบเดียวกับ history ทุกไบต์ และเขียน
**object ตัวเดียวกัน** ลงทุกรอบที่ active อยู่ (`recordCropData` สร้าง point ครั้งเดียวแล้ว push
reference เดียวกัน — ห้ามแก้ค่าใน record ภายหลัง ถ้าจะแก้ต้อง clone ก่อน)
การกรองว่าลังไหนเห็นค่าอะไรทำที่ `TRAY_VIEW` ใน `dashboard.js` ล้วนๆ

เหตุผลที่ไม่แยก key ตามลัง: วัดจริงแล้วรูปแบบ "แยกลัง" **กินที่มากกว่า 3%** (148 vs 144 ไบต์/record
— `ts` กินไป 31 ไบต์ และ key ของ object แพงกว่าช่องใน array) แถมยังต้อง migrate ไฟล์เก่าเป็น 10 MB
และต้องแยกโค้ด `renderAllCharts`/`computeDailySummary` เป็นสองทางซึ่งใช้ร่วมกับหน้าประวัติอยู่

**การแมปเซ็นเซอร์ → ลัง**

| | ลัง1 | ลัง2 | ใช้ร่วมกัน |
|---|---|---|---|
| pH | `p` | `p2` | — |
| ระดับน้ำลังปลูก | `w[3]` | `w[5]` | — |
| ถังน้ำวน | `w[4]` | `w[0]` | — |
| ถัง PH / น้ำเติม | | | `w[1]` `w[2]` |
| อุณหภูมิ/ความชื้น/แสง/ไฟฟ้า | | | `t` `h` `l` `v` `c` `pw` |

ทั้ง 2 ลังเห็นถังละ 4 ถัง → ตารางสรุปรายวัน 34 คอลัมน์เท่ากัน

**Migration:** รอบเก่าที่ไม่มีฟิลด์ `tray` จะถูกเติมเป็น `tray: 1` ใน `loadIndex()` — แตะแค่
`index.json` ไม่เคยเปิดไฟล์ record และรันซ้ำได้ไม่มีผลข้างเคียง

**⚠️ `server.js` SIGTERM/SIGINT ต้องเรียก `saveActiveCycles()` (มี s)** ไม่งั้นข้อมูลทั้ง 2 ลัง
หายได้ถึง 5 นาทีทุกครั้งที่ restart แบบเงียบๆ

## ค่าที่วัดด้วยมือ (Manual Entries)

ใช้ตอน ESP32 ออฟไลน์ แต่มีคนวัดค่าเองจริง (pH meter, ไม้บรรทัด) — ฟอร์ม `admin-only` ท้ายหน้ารายงาน
ช่องกรอกสร้างจาก `EXPORT_COLUMNS` (มีฟิลด์ `unit` ไว้ให้ฟอร์มใช้)

- **เก็บแยกจาก record ของเซ็นเซอร์** — `data/crops/manual.json` หรือตาราง Supabase `crop_manual_records`
  (**ต้องรัน `supabase-setup.sql` ซ้ำ 1 ครั้งบน Supabase** ถึงจะมีตารางนี้ — รันซ้ำได้ปลอดภัย)
- **ไม่ผูกกับรอบปลูก** — รายการกลางรายการเดียว `getCycleDetail` แนบ `manual:[...]` ที่ ts อยู่ในช่วงของรอบ
  กรอกครั้งเดียวขึ้นทั้ง 2 ลัง (เหมือน record ของเซ็นเซอร์ที่เป็นภาพรวมทั้งฟาร์ม)
- `renderCropReport` รวม `manual` (ใส่ `src:'manual'`) เข้า `cycle.records` แล้วเรียงตาม ts →
  กราฟ/ตารางรายวัน/coverage/PDF ใช้ชุดเดียวกัน; `hourlyRows` ตั้ง `row.manual` ให้ชั่วโมงที่มีค่าวัดด้วยมือ
- **⚠️ PDF ต้องทำเครื่องหมายเสมอ** — เวลาในตารางเป็น `9:00*` + แถวตัวเอียง และ `#print-meta` มีบรรทัดอธิบาย
  ห้ามเอาออก: ผู้ใช้นำ PDF ไปใส่เล่มโปรเจกต์จบ คนอ่านต้องแยกได้ว่าค่าไหนไม่ได้มาจากเซ็นเซอร์
- ช่วงค่าที่ server ยอมรับอยู่ที่ `MANUAL_FIELDS` ใน `cropCycles.js` (กันพิมพ์ผิด ไม่ใช่เกณฑ์ของพืช)

## ข้อมูลจำลอง (ส่งออก PDF แบบจำลอง)

ปุ่ม "ส่งออก PDF" เปิด `#export-modal` ให้เลือก **ค่าจริง** (`exportReportPdf`) หรือ **ข้อมูลจำลอง**
(`exportSimulatedPdf`) — อาจารย์ที่ปรึกษาอนุญาตให้ใช้ในเล่มเพราะเวลาทดลองไม่พอ (2026-09-24)

- ทั้ง 2 โหมดจบที่ `printReportDoc({rows, title, metaHtml, footer})` ตัวเดียวกัน
- `simulateCycleRecords(opts)` สร้าง 1 record/ชั่วโมง (ที่ :30) แล้วผ่าน `hourlyRows()` เหมือนค่าจริง
  → ตาราง/กราฟใช้เส้นทางเดียวกัน; seed = hash ของตัวเลือกทั้งหมด → ตั้งค่าเหมือนเดิมได้ตัวเลขเหมือนเดิม
- ช่วง pH/อายุเก็บเกี่ยวต่อผักอยู่ที่ `SIM_CROP_PROFILES`, สภาพแวดล้อมที่ `SIM_ENV` (แก้ pH/วัน/วันเริ่ม ได้ในหน้าต่าง)
  ช่องชื่อผักเว้นว่าง = ลังนั้นไม่ได้ปลูก → pH/ระดับน้ำของลังนั้นเป็น `-`
- **⚠️ ห้ามเอาป้าย "ข้อมูลจำลอง" ออก** — หัวเอกสาร (`#print-title`), บรรทัดแรกของ `#print-meta` และ
  `<tfoot id="print-sim-footer">` (ซ้ำท้ายตารางทุกหน้า ใช้ tfoot ไม่ใช่ `position: fixed` เพราะ fixed ทับแถวสุดท้ายของหน้า)
  การระบุว่าเป็นข้อมูลจำลองคือสิ่งที่ทำให้ใช้ในงานวิชาการได้
- `confirmExport()` ต้องรอ `hidden.bs.modal` ก่อนพิมพ์ ไม่งั้นฉากหลังมืดของ modal ติดไปใน PDF

## ส่งออก PDF (รายงานรอบปลูก)

ปุ่ม "ส่งออก PDF" เรียก `exportReportPdf()` ซึ่ง**ไม่ได้พิมพ์หน้าจอ** แต่สร้างเอกสารแยกที่
`#print-report` (ใน `dashboard.html`) เพราะหน้าจอเป็นมุมมองรายลัง แต่ PDF ต้อง**รวมทั้งฟาร์ม**

ทำได้โดยไม่ต้องเพิ่ม API เพราะ `recordCropData` เขียน record ตัวเดียวกันลงทุกรอบที่ active
→ record ของรอบใดรอบหนึ่งมีค่าของทั้ง 2 ลังครบอยู่แล้ว

**โครงเอกสาร:** หัวเอกสาร (พืชทั้ง 2 ลัง, ช่วงวัน) → กราฟ 5 อัน → ขึ้นหน้าใหม่ → ตารางรายชั่วโมง

**⚠️ กราฟกับตารางใช้ตัวเลขชุดเดียวกัน** — `exportReportPdf()` เรียก `hourlyRows()` ครั้งเดียว
แล้วส่งให้ทั้ง `renderPrintTable()` และ `renderPrintCharts()` โดยกราฟแปลงกลับเป็นรูป record
ด้วย `hourlyToRecords()` (แมปด้วย `key` ของ `EXPORT_COLUMNS` ไม่ใช่ลำดับ) เพื่อใช้
`renderAllCharts` เดิมได้ ห้ามเปลี่ยนให้กราฟกลับไปใช้ record ดิบ ไม่งั้นตัวเลขสองที่จะไม่ตรงกัน

กราฟใช้ **`PRINT_VIEW`** (ไม่ใช่ `TRAY_VIEW.all`) = pH 2 เส้น + ระดับน้ำ **4 ถังตามตาราง**
(ลัง1 / ลัง2 / น้ำเติม / PH) ตัดถังน้ำวนลัง2 `w[0]` กับถังน้ำวนลัง1 `w[4]` ที่ไม่มีในตารางออก

แกน X ครอบคลุม **ตั้งแต่ชั่วโมงที่เริ่มปลูกจนถึงเก็บเกี่ยว** เพราะ `hourlyRows` สร้างแถวครบทุก
ชั่วโมงอยู่แล้ว ชั่วโมงที่ไม่มีข้อมูลเป็น `null` → Chart.js วาดเป็น**เส้นขาด** (`spanGaps` ค่าตั้งต้น
เป็น false) เห็นชัดว่าช่วงไหนระบบไม่ได้เก็บข้อมูล ไม่ใช่ลากเส้นตรงข้ามไป

**ตาราง 13 คอลัมน์** (`EXPORT_COLUMNS` ใน `dashboard.js`) — ค่าเป็น**ค่าเฉลี่ยของชั่วโมงนั้น**
จากข้อมูลที่บันทึกทุก 5 นาที `hourlyRows()` สร้างแถวครบทุกชั่วโมงตั้งแต่วันเริ่มถึงวันจบ
ชั่วโมงที่ไม่มีข้อมูลได้แถวว่าง (`-`) ไม่ใช่หายไป

| คอลัมน์ | ฟิลด์ |
|---|---|
| อุณหภูมิ / ความชื้น / แสงสว่าง | `t` `h` `l` |
| PHลัง1 / PHลัง2 | `p` `p2` |
| แรงดัน / กระแส | `v` `c` |
| ระดับน้ำลัง1 / ลัง2 / เติม | `w[3]` `w[5]` `w[2]` |
| **ระดับน้ำ PH** | **`w[1]`** (ถัง PH ถังเดียวที่เติมทั้ง 2 ลัง) |

ไม่มี `กำลัง (pw)`, `ถังน้ำวนลัง2 (w[0])`, `ถังน้ำวนลัง1 (w[4])` ตามแบบที่ผู้ใช้กำหนด

**⚠️ `skipNegative` ใน column spec** — ระดับน้ำใช้ `-1` แทน "เซ็นเซอร์ไม่ตอบ" ไม่ใช่ระดับ 0
`columnValue()` ต้องกรองทิ้งก่อนเฉลี่ย ไม่งั้นค่าเฉลี่ยถูกดึงต่ำลงเงียบๆ (ใช้ทั้งตารางรายชั่วโมง
และตารางสรุปรายวัน)

**⚠️ 3 กับดักที่แก้ไปแล้ว ห้ามทำซ้ำ:**
1. `hourlyRows` ต้อง `new Date(cursor)` ทุกแถว — `cursor` ถูก mutate ทุกรอบ ถ้าเก็บ reference
   ทุกแถวจะกลายเป็นเวลาเดียวกันหมด
2. **ห้ามบังคับขนาด canvas ด้วย `!important`** ขณะ Chart.js อยู่โหมด `responsive`
   จะ resize สู้กันเป็นลูปจนหน้าค้าง — กำหนดความสูงที่กล่องครอบ (`.print-chart-box`) แทน
3. `#print-report` อยู่ใน `.page` ที่ถูก `display:none` เมื่อไม่ใช่หน้าที่เปิดอยู่
   ต้องมี `body.printing #page-report { display: block }` ไม่งั้น canvas ได้พื้นที่ 0x0 กราฟออกมาเปล่า

**กฎ print ที่ขาดไม่ได้** (`style.css`): `@page { size: A4 portrait }`,
`#print-hourly thead { display: table-header-group }` (หัวตารางซ้ำทุกหน้า),
`#print-hourly tr { break-inside: avoid }` (ไม่ตัดแถวคร่อมหน้า)

## Frontend (dashboard.js + Chart.js)

### หน้าเว็บ (Multi-page SPA)
| Page ID | เมนู | เนื้อหา |
|---------|------|---------|
| `page-overview` | ภาพรวม | sensor cards real-time |
| `page-water` | ระดับน้ำ | water bar 6 ถัง |
| `page-control` | ควบคุม (admin) | mode toggle + auto settings + relay grid |
| `page-history` | ประวัติ | กราฟ Chart.js 5 แท็บ |
| `page-users` | จัดการผู้ใช้ (admin) | CRUD user table |

### กราฟ (ข้อมูล 24 ชั่วโมง)
- อุณหภูมิ & ความชื้น (dual Y-axis)
- แสงสว่าง
- pH ลัง1 และ ลัง2 (scale 0–14)
- แรงดัน & กระแส (dual Y-axis)
- ระดับน้ำ 6 ถัง (scale 0–100%)

### Layout โครงสร้าง
```
body
├── .sidebar (fixed left, 260px)
│   ├── brand
│   ├── nav-items (ภาพรวม / ระดับน้ำ / ควบคุม / ประวัติ / ผู้ใช้)
│   └── .sidebar-footer
│       ├── .theme-toggle-btn  ← ปุ่มสลับ Dark/Light mode
│       └── .sidebar-user-row  ← avatar + username + logout
├── .main-wrapper (margin-left: 260px)
│   ├── .topbar (mobile only, sticky)
│   │   └── menu | brand | theme-btn | esp-status
│   ├── .desk-infobar (desktop, sticky, แสดงทุกหน้า)
│   │   └── clock-display | esp-status-desk | last-update
│   └── main.content
│       └── .page (active/inactive สลับด้วย goPage())
└── .bottom-nav (mobile only, fixed bottom)
```

### Dark Mode
- toggle ด้วย `document.body.classList.toggle('dark')`
- บันทึกใน `localStorage` key `'theme'`
- โหลดทันทีด้วย `<script>` ต้นสุดของ `<body>` (ป้องกัน FOUC)
- CSS override ผ่าน `body.dark { --bg: ...; --card-bg: ...; ... }`

### ธีม (ซ้อนกันเป็นชั้น ท้าย `style.css`)
ฟอนต์ **IBM Plex Sans Thai** ทั้งเว็บ (`style.css`, `dashboard.html`, `login.html` และ
`Chart.defaults.font.family` ใน `dashboard.js`) เขียวเป็น accent สีเดียว

```
style.css → base → DARK MODE → THEME: CLEAN MINIMAL → THEME: LIQUID GLASS
                                 (@media screen)       (@media screen) ← ชั้นที่เห็นจริง
```

**`THEME: LIQUID GLASS` (2026-09-25)** — ชั้นบนสุด ทับ Clean Minimal ด้วย cascade ปกติ
(ไม่ได้ลบชั้นเดิม ย้อนกลับเป็นธีมมินิมอลได้ด้วยการลบบล็อกนี้ก้อนเดียว)
- พื้นหลัง aurora ที่ `body::before` (fixed, `z-index:-1`) — **ต้องมี ไม่งั้น `backdrop-filter`
  ไม่มีอะไรให้เบลอ** กระจกจะเหลือแค่พื้นทึบจาง ๆ
- ผิวกระจก = `--glass-bg` + `backdrop-filter` + `inset 0 1px 0 var(--glass-spec)` (เส้นแสงขอบบน)
  ใช้ `inset box-shadow` ไม่ใช่ `::before` เพื่อไม่ชนกับ pseudo-element ที่การ์ดบางตัวใช้อยู่
- มี fallback พื้นทึบใต้ `@supports not (backdrop-filter)` และ `prefers-reduced-transparency`
  (เบลอไม่ได้แล้วพื้นโปร่ง 60% = ตัวหนังสือทับ aurora อ่านไม่ออก)

**⚠️ กฎที่ห้ามละเมิดในชั้นธีม:**
1. ห่อทั้งชั้นด้วย `@media screen` — กระจก/เงา/ไล่สี ห้ามหลุดไปโดน `#print-report`
   (แก้หน้าตา PDF ที่ส่วน "Print / Export PDF" เท่านั้น)
2. **ห้ามใส่ `backdrop-filter` / `filter` / `transform` ที่ `.main-wrapper`, `.content`, `.page`**
   — สร้าง containing block ใหม่ให้ลูกที่เป็น `position: fixed` แล้ว `.sidebar`, `.bottom-nav`
   และ Bootstrap modal `#export-modal` (อยู่ใน `main.content`) จะเพี้ยนตำแหน่งทันที
3. ชั้นธีมมาทีหลัง จึงทับกฎที่ specificity เท่ากันข้างบน — **ต้องประกาศซ้ำในชั้นเอง**:
   `.btn-add-user.crop-harvest-btn` (สีส้ม) และ `.sensor-grid` 2 คอลัมน์บนมือถือ
4. ขอบของ **ช่องกรอก** และ **รางแถบระดับน้ำ** ห้ามใช้ `--glass-border` (ขาวโปร่ง) —
   บนการ์ดกระจกสีขาวจะกลืนหายไปจนไม่รู้ว่าตรงไหนกรอกได้ ใช้ `color-mix(... var(--text-mid) ...)`
5. ตัวเลขเซ็นเซอร์/ตาราง ใช้สีทึบเต็ม + `font-variant-numeric: tabular-nums` (ไม่กระตุกตอนอัปเดต)

- print บังคับ `body, body.dark { background:#fff; color:#000 }` — พิมพ์จาก dark mode ได้กระดาษขาว
- `login.html` ไม่โหลด `style.css` จึงมี token ชุดเล็ก + aurora ของตัวเอง (ต้องแก้คู่กันเสมอ)
  และอ่าน `localStorage.theme` เหมือน dashboard

### โลโก้ต้นอ่อน (SVG — ไม่ใช่ emoji แล้ว)
กระเบื้องมุมมนไล่สีเขียว + ต้นอ่อนสีขาว + เส้นพื้นดิน วาดด้วย `<path>` ล้วน ไม่มีไฟล์รูปภายนอก
ใช้ 3 ที่: sidebar (38px / 34px ในชั้นธีม) · แถบบนมือถือ (26px) · หน้า login (64px)
\+ เป็น favicon แบบ data URI ทั้ง 2 หน้า (`#` ต้องเข้ารหัสเป็น `%23`)

- `dashboard.html` นิยาม `<symbol id="sprout-logo">` **ครั้งเดียว** ต้น `<body>` แล้วเรียกด้วย
  `<use href="#sprout-logo">` — ห้าม copy ทั้งก้อนไปวางซ้ำ เพราะ `id` ของ `<linearGradient>`
  เป็น global ทั้งหน้า จะชนกันเอง
- **`login.html` มีสำเนาของตัวเอง** (คนละเอกสาร) — แก้รูปที่ไหนต้องแก้อีกที่ให้ตรงกันเสมอ
- ⚠️ **`<defs>` ต้องอยู่นอก `<symbol>`** ไม่งั้น `<use>` resolve `url(#sprout-tile)` ไม่เจอ
- ⚠️ **`.svg-sprite` ห้ามซ่อนด้วย `display: none`** ด้วยเหตุผลเดียวกัน — ใช้
  `position:absolute; width:0; height:0; overflow:hidden` แทน
  (อาการเวลาพลาด 2 ข้อนี้: โลโก้ออกมาเป็นเส้นจาง ๆ ไม่มีกระเบื้องเขียว)
- `🌱` ที่เหลือใน `dashboard.html` / `dashboard.js` เป็น bullet นำหน้าสถานะลังปลูก คนละเรื่องกับโลโก้

### สีแกน/เส้นกริดของกราฟ (`dashboard.js`)
`CHART_INK` / `CHART_GRID` / `CHART_AXIS` เป็น **ฟังก์ชัน** ที่ใส่ไว้ใน `BASE_OPTS.scales`
Chart.js เรียกใหม่ทุกครั้งที่วาด จึงสลับ light/dark ได้โดยไม่ต้องแก้ options เลย
(`toggleTheme()` แค่เรียก `applyChartTheme()` ซึ่งสั่ง `chart.update('none')` เฉย ๆ)
- ทั้งสามเช็ค `body.printing` ก่อน → ตอนสร้าง PDF คืน**สีเข้มเสมอ** ไม่สนธีมบนจอ
  (ไม่งั้น export ตอน dark mode จะได้ป้ายแกนสีอ่อนบนกระดาษขาว)
- `Chart.defaults.color` เป็น global ที่กราฟของ PDF ใช้ร่วมด้วย — **ห้ามผูกกับธีม**
- ⚠️ **ห้ามเขียนทับ `chart.options.scales.*` ด้วย spread** — `chart.options` ที่อ่านออกมาเป็น
  proxy ของ Chart.js พอ spread กลับเข้าไปจะติดคีย์ภายในมาด้วย แล้ว resolver ระเบิดเป็น
  `t.startsWith is not a function` ตอนสร้างกราฟของ PDF (เคยพลาดมาแล้ว)

### CSS Design Tokens (`:root`)
| Variable | Light | Dark | ใช้กับ |
|----------|-------|------|-------|
| `--bg` | `#f5f7f5` | `#0e1310` | พื้นหลังหลัก |
| `--card-bg` | `#ffffff` | `#151b17` | การ์ด, panel, sidebar |
| `--border` | `#e5e9e6` | `#242c27` | เส้นขอบทั่วไป |
| `--border-strong` | `#cdd5d0` | `#36413a` | ขอบ input, hover การ์ด |
| `--text` | `#17201a` | `#e6ece8` | ตัวหนังสือหลัก |
| `--text-mid` | `#5d6a62` | `#919e96` | ตัวหนังสือรอง |
| `--primary` | `#16a34a` | เหมือนกัน | สีเขียวหลัก (accent เดียว) |
| `--primary-pale` | `#e7f6ec` | `#173020` | พื้นเมนู active / badge |
| `--primary-ink` | `#15803d` | `#4ade80` | ตัวหนังสือเขียวบน `--primary-pale` |
| `--track` | `#edf1ee` | `#222a25` | ราง progress bar ระดับน้ำ |
| `--sidebar-w` | `252px` | — | ความกว้าง sidebar |

**Glass tokens** (ชุดของ Liquid Glass — อยู่ใน `:root` / `body.dark` เหมือนกัน):
`--glass-bg` (การ์ด) · `--glass-bg-soft` (ชั้นรอง/ช่องกรอก) · `--glass-bg-chrome` (sidebar, แถบบน,
เมนูล่าง) · `--glass-border` · `--glass-spec` (เส้นแสงขอบบน) · `--glass-edge` · `--glass-shadow`
· `--glass-shadow-lg` · `--glass-blur` · `--radius-glass` (18px) · `--radius-glass-sm` (12px)
ตัวเดิมข้างบน**ไม่ได้ถูกแทนที่** ยังเป็น fallback ให้เครื่องที่ไม่รองรับ `backdrop-filter` และให้หน้า print

## วิธีรันในเครื่อง

```powershell
cd "D:\Project SAU\smart-farm\server"
node server.js
# เปิด http://localhost:3000
# Login: admin / farm1234
```

## วิธี Deploy บน Railway (ไม่ต้องเปิดโน๊ตบุ๊ค)

1. Push โค้ดโฟลเดอร์ `server/` ขึ้น GitHub
2. สร้าง Project ใหม่บน railway.app → Deploy from GitHub
3. ตั้ง Environment Variables ใน Railway dashboard
4. Railway ใช้ `Procfile` (`web: node server.js`) รัน server อัตโนมัติ
5. แก้ `SERVER_URL` ใน `smart_farm.ino` ให้ตรงกับ URL ที่ได้จาก Railway แล้ว Upload ใหม่

### ⚠️ disk แบบ ephemeral — เหตุผลที่ต้องมี Supabase

ข้อเท็จจริงจากเอกสาร Render:
- **Free instance ต่อ persistent disk ไม่ได้เลย** เป็นฟีเจอร์ของ paid เท่านั้น
- ไฟล์ที่เขียนตอนรันหายทุกครั้งที่ **redeploy / restart / spin down**
- spin down เกิดหลังไม่มี traffic **15 นาที** (นับ WebSocket ด้วย)

ปกติ ESP32 ยิงทุก 2 วินาทีจึงกัน spin down ได้ **แต่ถ้าไฟดับแล้วบอร์ดไม่กลับมาภายใน 15 นาที
Render จะหลับแล้วข้อมูลรอบปลูกที่เก็บมาทั้งรอบหายหมด** (ดู memory: บอร์ดตัวนี้ไม่บูตเองตอนจ่ายไฟ)

**ทางแก้ที่ใช้อยู่:** ตั้ง `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` แล้วข้อมูลรอบปลูกจะไปอยู่บน
Postgres ของ Supabase (free 500 MB) แทนไฟล์ — รอดทุกกรณีข้างบน
รัน `smart-farm/server/supabase-setup.sql` ใน SQL Editor ครั้งเดียวเพื่อสร้างตาราง

ทางเลือกอื่นที่ **ใช้ไม่ได้** (เช็คแล้ว): Neon free จำกัด 100 CU-hours/เดือน แต่งานนี้เขียนทุก 5 นาที
= compute ตื่นตลอด 24 ชม. โควตาหมดกลางเดือน / Render Postgres free หมดอายุใน 30 วัน

**ย้ายไป Supabase แล้วด้วย:** การตั้งค่า Auto Mode + สถานะโปรแกรม (ตาราง `app_state` — รัน SQL ซ้ำ 1 ครั้ง)

**ยังไม่ได้ย้ายไป Supabase:** `history.json` (เก็บแค่ 24 ชม. หายไม่กระทบมาก) และ `users.json`
(user ที่ไม่ใช่ admin จะหายทุกครั้งที่ restart) — ถ้าจะย้ายเพิ่มก็ทำที่ `persistence.js`

## การแก้ไขโค้ด

- **แก้ Logic ESP32:** แก้ใน `smart_farm.ino` → Upload ผ่าน Arduino IDE ใหม่
- **แก้ Auto Mode / API:** แก้ใน `server.js` → restart server
- **แก้ UI / กราฟ:** แก้ใน `dashboard.js` หรือ `style.css`
- **แก้ HTML structure:** แก้ใน `dashboard.html`
- **เพิ่ม/ลด Relay:** แก้ `RELAY_COUNT`+`RELAY_PINS` ใน .ino, `RELAY_COUNT` ใน `autoMode.js`, `relayStates` ใน `state.js` และ `RELAY_NAMES` ใน `dashboard.js`
- **เพิ่ม/ลดถัง:** แก้ `TANK_HEIGHT`, echo pins ใน .ino, `WATER_NAMES`+`TRAY_VIEW` ใน `dashboard.js` และ water cards ใน `dashboard.html`
- **เพิ่ม/ลดชนิดผักใน dropdown:** แก้ `CROP_PRESETS` ใน `dashboard.js` (ช่องกรอกใช้ `<datalist>`
  จึงพิมพ์ชื่อนอกรายการเองได้เสมอ และชื่อผักที่เคยปลูกจะถูกเติมเข้ารายการอัตโนมัติ)
- **⚠️ `TRAY_VIEW` (`dashboard.js`) คือแหล่งความจริงเดียวว่าค่าไหนเป็นของลังไหน** — ขับทั้ง
  เส้นกราฟและคอลัมน์ตารางสรุปรายวัน ห้าม hardcode ชื่อ/สี/index ของถังหรือ pH ที่อื่นอีก
  ไม่งั้นหัวตารางกับตัวข้อมูลจะเหลื่อมกัน (บั๊กเดิม: หัวแถว 2 มี 39 `<th>` ทั้งที่ต้องมี 42)
- **แก้ Dark Mode colors:** แก้ CSS variables ใน `body.dark {}` ส่วนท้ายของ `style.css`
- **⚠️ ห้ามลบ `min-width: 0` ใน `.main-wrapper` และ `.content`** — `body` เป็น flex row และ flex item
  มีค่าเริ่มต้น `min-width: auto` ที่ "ไม่ยอมหดต่ำกว่าความกว้างเนื้อหา" ตารางสรุปรายวันในหน้ารายงาน
  มี 34 คอลัมน์ (สร้างหัวตารางจาก `summaryColumns()` — เดิมเคย 43 คอลัมน์ตายตัว)
  \+ `white-space: nowrap` จึงดัน `.main-wrapper` ให้กว้างเกินจอ (วัดจริงตอน 43 คอลัมน์: จอ 1703px
  แต่ `.main-wrapper` 2180px) แล้วทั้งหน้าเลื่อนแนวนอน — พอเลื่อน `sidebar` ที่ `position: fixed`
  จะค้างอยู่กับที่แล้วทับเนื้อหา **`overflow-x: auto` ที่ `.daily-summary-wrap` ช่วยไม่ได้เลย**
  เพราะตัวมันไม่เคยถูกบีบให้แคบตั้งแต่แรก — เพิ่มตารางกว้างๆ ที่ไหนก็ต้องมีตัวห่อ `overflow-x: auto`
  คู่กับ `min-width: 0` ของ flex item เสมอ
- **แก้ข้อมูลใน infobar:** แก้ `#clock`, `#esp-status-desk`, `#last-update` ใน `.desk-infobar` ของ `dashboard.html`

## Role-based Access Control

| Role | สิทธิ์ |
|------|-------|
| `admin` | ดูทุกหน้า + ควบคุม relay + ตั้งค่า auto mode + จัดการ user |
| `viewer` | ดูได้เฉพาะ ภาพรวม / ระดับน้ำ / ประวัติ |

- Element ที่ต้องการ admin ใส่ class `admin-only` → ซ่อนอัตโนมัติสำหรับ viewer
- API `/api/me` ส่งกลับ `{ username, role }`
- Users เก็บใน `server.js` memory (ไม่มี database) — reload server = reset non-admin users

## pH Calibration (สำคัญ)

ค่าตั้งต้นในโค้ด: `Vmid = 2.5V`, `Slope = 0.18 V/pH`
ต้องสอบเทียบด้วย Buffer Solution pH4 และ pH7 แล้วแก้ค่า `Slope` ใน `readPH()` ของ .ino ให้ตรงกับ sensor จริง
