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
        ├── persistence.js              — history.json, users.json, auto-settings
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

### Relay (10 ตัว) — Active LOW
| Index | GPIO | ชื่อ |
|-------|------|------|
| R1 (0) | 2 | น้ำเติมลัง1 |
| R2 (1) | 5 | น้ำเติมลัง2 |
| R3 (2) | 13 | สารA ลัง1 |
| R4 (3) | 23 | สารA ลัง2 |
| R5 (4) | 14 | สารB ลัง1 |
| R6 (5) | 15 | สารB ลัง2 |
| R7 (6) | 16 (ป้ายบอร์ด: RX2) | วนลัง1 เข้า |
| R8 (7) | 17 (ป้ายบอร์ด: TX2) | วนลัง1 ออก |
| R9 (8) | 18 | วนลัง2 เข้า |
| R10 (9) | 19 | วนลัง2 ออก |

### ถัง 6 ถัง (Ultrasonic index)
```
[0]=ถังสารA  [1]=ถังสารB      [2]=ถังน้ำเติม
[3]=ลังปลูกผัก1  [4]=ถังน้ำวนลัง1  [5]=ลังปลูกผัก2
```
(ถังน้ำวนลัง2 เดิม index [6] ถูกตัดออก เพราะ GPIO39 ย้ายไปให้ pH ลัง2 แทน)
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
```

### API Routes
| Method | Path | ใช้โดย | หน้าที่ |
|--------|------|--------|---------|
| GET | `/` | Browser | หน้า Login |
| POST | `/login` | Browser | ตรวจสอบ credentials |
| GET | `/dashboard` | Browser | หน้า Dashboard (ต้อง auth) |
| GET | `/logout` | Browser | ออกจากระบบ |
| POST | `/api/data` | ESP32 | รับข้อมูลเซ็นเซอร์ → ตอบกลับด้วย relayStates |
| GET | `/api/history` | Browser | ดึงประวัติ 24h |
| POST | `/api/relay` | Browser | สั่งเปิด/ปิด Relay (manual mode) |
| POST | `/api/mode` | Browser | สลับ AUTO / MANUAL |
| POST | `/api/auto-settings` | Browser | บันทึกการตั้งค่า Auto Mode |
| GET | `/api/crops` | Browser | `{trays, trayNames, actives:{1,2}, cycles}` — รอบที่ active แยกตามลัง |
| GET | `/api/crops/:id` | Browser | รายละเอียดรอบปลูก + `records` ทั้งหมด (มีฟิลด์ `tray`) |
| POST | `/api/crops/start` | Browser | body `{cropName, tray}` — admin, 400 ถ้าลังนั้นมีรอบ active อยู่ |
| POST | `/api/crops/:id/end` | Browser | เก็บเกี่ยว/ปิดรอบตาม id — admin |

### Socket.io Events (Server → Browser)
| Event | ข้อมูล |
|-------|--------|
| `sensorData` | ค่าเซ็นเซอร์ล่าสุด + connected status |
| `relayUpdate` | สถานะ relay ทั้ง 10 ตัว |
| `autoStatus` | สถานะ Auto Mode + countdown timer |
| `historyPoint` | จุดข้อมูลใหม่ทุก 1 นาที (append กราฟ) |

## Auto Mode Logic (server.js)

### pH Control
- เช็คทุกครั้งที่รับข้อมูลจาก ESP32
- ถ้า pH ต่ำกว่า `ph1Min` → เปิด `ph1UpRelay` ชั่วคราว (`doseTime` วินาที)
- ถ้า pH สูงกว่า `ph1Max` → เปิด `ph1DownRelay` ชั่วคราว
- มี cooldown 5 นาทีระหว่าง dose

### Flood & Drain (ลัง 1 และ 2)
```
idle → filling → soaking → draining → idle (วนซ้ำทุก cycleHours ชั่วโมง)
```
- `filling`: เปิด fillRelay จนระดับน้ำถึง fillTarget% (หรือ safety timeout 30 นาที)
- `soaking`: ปิด fillRelay รอ soakTime นาที
- `draining`: เปิด drainRelay รอ drainTime นาที แล้วปิด schedule รอบถัดไป

### ปั๊มน้ำทั่วไป
- เปิดทุก `pumpInterval` ชั่วโมง นาน `pumpDuration` นาที

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
| ถังน้ำวน | `w[4]` | **ไม่มีเซ็นเซอร์** | — |
| ถังสารA/สารB/น้ำเติม | | | `w[0]` `w[1]` `w[2]` |
| อุณหภูมิ/ความชื้น/แสง/ไฟฟ้า | | | `t` `h` `l` `v` `c` `pw` |

ลัง2 ไม่มีถังน้ำวนเพราะ ultrasonic index `[6]` เดิมถูกตัดตอนยก GPIO39 ไปให้ pH2 — คอลัมน์นี้
จึงหายไปเองในรายงานลัง2 (34 คอลัมน์ vs ลัง1 37 คอลัมน์)

**Migration:** รอบเก่าที่ไม่มีฟิลด์ `tray` จะถูกเติมเป็น `tray: 1` ใน `loadIndex()` — แตะแค่
`index.json` ไม่เคยเปิดไฟล์ record และรันซ้ำได้ไม่มีผลข้างเคียง

**⚠️ `server.js` SIGTERM/SIGINT ต้องเรียก `saveActiveCycles()` (มี s)** ไม่งั้นข้อมูลทั้ง 2 ลัง
หายได้ถึง 5 นาทีทุกครั้งที่ restart แบบเงียบๆ

## ส่งออก PDF (รายงานรอบปลูก)

ปุ่ม "ส่งออก PDF" เรียก `exportReportPdf()` ซึ่ง**ไม่ได้พิมพ์หน้าจอ** แต่สร้างเอกสารแยกที่
`#print-report` (ใน `dashboard.html`) เพราะหน้าจอเป็นมุมมองรายลัง แต่ PDF ต้อง**รวมทั้งฟาร์ม**

ทำได้โดยไม่ต้องเพิ่ม API เพราะ `recordCropData` เขียน record ตัวเดียวกันลงทุกรอบที่ active
→ record ของรอบใดรอบหนึ่งมีค่าของทั้ง 2 ลังครบอยู่แล้ว

**โครงเอกสาร:** หัวเอกสาร (พืชทั้ง 2 ลัง, ช่วงวัน) → กราฟ 5 อันด้วย `TRAY_VIEW.all`
(pH 2 เส้น + ถังครบ 6) → ขึ้นหน้าใหม่ → ตารางรายชั่วโมง

**ตาราง 13 คอลัมน์** (`EXPORT_COLUMNS` ใน `dashboard.js`) — ค่าเป็น**ค่าเฉลี่ยของชั่วโมงนั้น**
จากข้อมูลที่บันทึกทุก 5 นาที `hourlyRows()` สร้างแถวครบทุกชั่วโมงตั้งแต่วันเริ่มถึงวันจบ
ชั่วโมงที่ไม่มีข้อมูลได้แถวว่าง (`-`) ไม่ใช่หายไป

| คอลัมน์ | ฟิลด์ |
|---|---|
| อุณหภูมิ / ความชื้น / แสงสว่าง | `t` `h` `l` |
| PHลัง1 / PHลัง2 | `p` `p2` |
| แรงดัน / กระแส | `v` `c` |
| ระดับน้ำลัง1 / ลัง2 / เติม | `w[3]` `w[5]` `w[2]` |
| **ระดับน้ำ PH** | **`w[1]`** (ถังสารB — จะเป็นถัง pH ถังเดียวที่เติมทั้ง 2 ลัง) |

ไม่มี `กำลัง (pw)`, `ถังสารA (w[0])`, `ถังน้ำวนลัง1 (w[4])` ตามแบบที่ผู้ใช้กำหนด

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

### CSS Design Tokens (`:root`)
| Variable | Light | Dark | ใช้กับ |
|----------|-------|------|-------|
| `--bg` | `#f0fdf4` | `#0c1a12` | พื้นหลังหลัก |
| `--card-bg` | `#ffffff` | `#152018` | การ์ด, panel |
| `--border` | `#e2f0e8` | `#1e3628` | เส้นขอบทั่วไป |
| `--text` | `#1a2e1f` | `#e2f0e8` | ตัวหนังสือหลัก |
| `--text-mid` | `#4a6455` | `#7ab88a` | ตัวหนังสือรอง |
| `--primary` | `#16a34a` | เหมือนกัน | สีเขียวหลัก |
| `--primary-pale` | `#dcfce7` | `#1a3524` | พื้นหลัง badge/bar |
| `--sidebar-w` | `260px` | — | ความกว้าง sidebar |

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

**ยังไม่ได้ย้ายไป Supabase:** `history.json` (เก็บแค่ 24 ชม. หายไม่กระทบมาก) และ `users.json`
(user ที่ไม่ใช่ admin จะหายทุกครั้งที่ restart) — ถ้าจะย้ายเพิ่มก็ทำที่ `persistence.js`

## การแก้ไขโค้ด

- **แก้ Logic ESP32:** แก้ใน `smart_farm.ino` → Upload ผ่าน Arduino IDE ใหม่
- **แก้ Auto Mode / API:** แก้ใน `server.js` → restart server
- **แก้ UI / กราฟ:** แก้ใน `dashboard.js` หรือ `style.css`
- **แก้ HTML structure:** แก้ใน `dashboard.html`
- **เพิ่ม/ลด Relay:** แก้ `RELAY_NAMES` ใน `dashboard.js` และ `RELAY_PINS` ใน .ino
- **เพิ่ม/ลดถัง:** แก้ `TANK_HEIGHT`, echo pins ใน .ino และ `TRAY_VIEW` ใน `dashboard.js`
- **เพิ่ม/ลดชนิดผักใน dropdown:** แก้ `CROP_PRESETS` ใน `dashboard.js` (ช่องกรอกใช้ `<datalist>`
  จึงพิมพ์ชื่อนอกรายการเองได้เสมอ และชื่อผักที่เคยปลูกจะถูกเติมเข้ารายการอัตโนมัติ)
- **⚠️ `TRAY_VIEW` (`dashboard.js`) คือแหล่งความจริงเดียวว่าค่าไหนเป็นของลังไหน** — ขับทั้ง
  เส้นกราฟและคอลัมน์ตารางสรุปรายวัน ห้าม hardcode ชื่อ/สี/index ของถังหรือ pH ที่อื่นอีก
  ไม่งั้นหัวตารางกับตัวข้อมูลจะเหลื่อมกัน (บั๊กเดิม: หัวแถว 2 มี 39 `<th>` ทั้งที่ต้องมี 42)
- **แก้ Dark Mode colors:** แก้ CSS variables ใน `body.dark {}` ส่วนท้ายของ `style.css`
- **⚠️ ห้ามลบ `min-width: 0` ใน `.main-wrapper` และ `.content`** — `body` เป็น flex row และ flex item
  มีค่าเริ่มต้น `min-width: auto` ที่ "ไม่ยอมหดต่ำกว่าความกว้างเนื้อหา" ตารางสรุปรายวันในหน้ารายงาน
  มี 34–37 คอลัมน์ (สร้างหัวตารางจาก `summaryColumns()` — ลัง1 37, ลัง2 34; เดิม 43 คอลัมน์ตายตัว)
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
