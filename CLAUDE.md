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
        ├── server.js                   — Node.js backend หลัก
        ├── package.json
        ├── Procfile                    — สำหรับ deploy บน Railway
        ├── history.json                — ข้อมูลเซ็นเซอร์ย้อนหลัง 24h (auto-generated)
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
| BH1750 | I2C | แสงสว่าง (lux) |
| INA219 | I2C | แรงดัน (V), กระแส (A), กำลัง (W) |
| pH sensor ลัง1 | GPIO 34 (ADC1) | pH น้ำลัง1 |
| pH sensor ลัง2 | GPIO 13 (ADC2) | pH น้ำลัง2 — ถ้าค่าไม่นิ่งให้ใช้ ADS1115 แทน |
| JSN-SR04T × 7 | TRIG=25, ECHO=26-39 | ระดับน้ำ 7 ถัง (%) |

### Relay (10 ตัว) — Active LOW
| Index | GPIO | ชื่อ |
|-------|------|------|
| R1 (0) | 2 | น้ำเติมลัง1 |
| R2 (1) | 5 | น้ำเติมลัง2 |
| R3 (2) | 12 | สารA ลัง1 |
| R4 (3) | 23 | สารA ลัง2 |
| R5 (4) | 14 | สารB ลัง1 |
| R6 (5) | 15 | สารB ลัง2 |
| R7 (6) | 16 | วนลัง1 เข้า |
| R8 (7) | 17 | วนลัง1 ออก |
| R9 (8) | 18 | วนลัง2 เข้า |
| R10 (9) | 19 | วนลัง2 ออก |

### ถัง 7 ถัง (Ultrasonic index)
```
[0]=ถังสารA  [1]=ถังสารB  [2]=ถังน้ำเติม
[3]=ลังปลูกผัก1  [4]=ถังน้ำวนลัง1
[5]=ลังปลูกผัก2  [6]=ถังน้ำวนลัง2
```
ความสูงถังทุกตัวตั้งต้นที่ 50 ซม. — แก้ใน `TANK_HEIGHT[7]` ในไฟล์ .ino

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
  w: [45, 60, 80, 55, 70, 50, 65]  // waterLevel 7 ถัง (%)
}
```

## Frontend (dashboard.js + Chart.js)

กราฟที่แสดง (ข้อมูล 24 ชั่วโมง):
- อุณหภูมิ & ความชื้น (dual Y-axis)
- แสงสว่าง
- pH ลัง1 และ ลัง2 (scale 0–14)
- แรงดัน & กระแส (dual Y-axis)
- ระดับน้ำ 7 ถัง (scale 0–100%)

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

## การแก้ไขโค้ด

- **แก้ Logic ESP32:** แก้ใน `smart_farm.ino` → Upload ผ่าน Arduino IDE ใหม่
- **แก้ Auto Mode / API:** แก้ใน `server.js` → restart server
- **แก้ UI / กราฟ:** แก้ใน `dashboard.js` หรือ `style.css`
- **แก้ HTML structure:** แก้ใน `dashboard.html`
- **เพิ่ม/ลด Relay:** แก้ `RELAY_NAMES` ใน `dashboard.js` และ `RELAY_PINS` ใน .ino
- **เพิ่ม/ลดถัง:** แก้ `TANK_HEIGHT`, echo pins ใน .ino และ `waterNames` ใน `dashboard.js`

## pH Calibration (สำคัญ)

ค่าตั้งต้นในโค้ด: `Vmid = 2.5V`, `Slope = 0.18 V/pH`
ต้องสอบเทียบด้วย Buffer Solution pH4 และ pH7 แล้วแก้ค่า `Slope` ใน `readPH()` ของ .ino ให้ตรงกับ sensor จริง
