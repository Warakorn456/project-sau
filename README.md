# Smart Farm — ระบบปลูกผักไฮโดรโปนิกส์อัตโนมัติ

ระบบควบคุมและมอนิเตอร์ฟาร์มผักไฮโดรโปนิกส์แบบ Real-time ผ่านเว็บ ประกอบด้วย ESP32 + Node.js Server + Web Dashboard

## สถาปัตยกรรม

```
ESP32 ──HTTP POST /api/data──▶ Node.js Server ──Socket.io──▶ Browser Dashboard
  ▲         (ทุก 5 วินาที)           │                              │
  │                                  │ Auto Mode Logic               │
  └────── รับ relayStates กลับ ◀────┘          กด Relay ────────────┘
                                                   POST /api/relay
```

## โครงสร้างโปรเจกต์

```
Project SAU/
├── index.html                        — Portfolio เจ้าของโปรเจกต์
└── smart-farm/
    ├── esp32/
    │   └── smart_farm/
    │       └── smart_farm.ino        — Firmware C++ สำหรับ ESP32
    └── server/
        ├── server.js                 — Node.js backend หลัก
        ├── package.json
        ├── Procfile                  — สำหรับ deploy บน Railway
        ├── history.json              — ข้อมูลเซ็นเซอร์ย้อนหลัง 24h
        ├── .env                      — credentials (ไม่ commit)
        ├── .env.example              — template ตัวอย่าง
        ├── views/
        │   ├── login.html            — หน้า Login
        │   └── dashboard.html        — หน้า Dashboard
        └── public/
            ├── css/style.css         — CSS ทั้งหมด
            └── js/dashboard.js       — Frontend JavaScript
```

## Hardware (ESP32)

### เซ็นเซอร์

| เซ็นเซอร์ | ขา | วัดอะไร |
|-----------|-----|---------|
| DHT11 | GPIO 4 | อุณหภูมิ (°C), ความชื้น (%) |
| BH1750 | I2C | แสงสว่าง (lux) |
| INA219 | I2C | แรงดัน (V), กระแส (A), กำลัง (W) |
| pH sensor ลัง 1 | GPIO 34 | pH น้ำลัง 1 |
| pH sensor ลัง 2 | GPIO 13 | pH น้ำลัง 2 |
| JSN-SR04T × 7 | TRIG=25, ECHO=26-39 | ระดับน้ำ 7 ถัง (%) |

### Relay 10 ตัว (Active LOW)

| Index | GPIO | ชื่อ |
|-------|------|------|
| R1 | 2 | น้ำเติมลัง 1 |
| R2 | 5 | น้ำเติมลัง 2 |
| R3 | 12 | สารA ลัง 1 |
| R4 | 23 | สารA ลัง 2 |
| R5 | 14 | สารB ลัง 1 |
| R6 | 15 | สารB ลัง 2 |
| R7 | 16 | วนลัง 1 เข้า |
| R8 | 17 | วนลัง 1 ออก |
| R9 | 18 | วนลัง 2 เข้า |
| R10 | 19 | วนลัง 2 ออก |

### ถัง 7 ถัง (Ultrasonic index)

```
[0] ถังสารA      [1] ถังสารB      [2] ถังน้ำเติม
[3] ลังปลูกผัก1  [4] ถังน้ำวนลัง1
[5] ลังปลูกผัก2  [6] ถังน้ำวนลัง2
```

## วิธีรันในเครื่อง

### ความต้องการ
- Node.js v16+
- Arduino IDE (สำหรับ Upload firmware ESP32)

### ขั้นตอน

1. ติดตั้ง dependencies
```powershell
cd "D:\Project SAU\smart-farm\server"
npm install
```

2. สร้างไฟล์ `.env` จาก template
```powershell
copy .env.example .env
```

3. แก้ค่าใน `.env`
```
ADMIN_USER=admin
ADMIN_PASS=farm1234
SESSION_SECRET=your-secret-key
PORT=3000
```

4. รัน Server
```powershell
node server.js
```

5. เปิดเบราว์เซอร์ที่ `http://localhost:3000`

## API Routes

| Method | Path | ใช้โดย | หน้าที่ |
|--------|------|--------|---------|
| GET | `/` | Browser | หน้า Login |
| POST | `/login` | Browser | ตรวจสอบ credentials |
| GET | `/dashboard` | Browser | หน้า Dashboard (ต้อง login) |
| GET | `/logout` | Browser | ออกจากระบบ |
| POST | `/api/data` | ESP32 | รับข้อมูลเซ็นเซอร์ |
| GET | `/api/history` | Browser | ดึงประวัติ 24h |
| POST | `/api/relay` | Browser | สั่ง Relay (manual) |
| POST | `/api/mode` | Browser | สลับ AUTO / MANUAL |
| POST | `/api/auto-settings` | Browser | บันทึกการตั้งค่า Auto Mode |

## Auto Mode

### pH Control
- ตรวจสอบค่า pH ทุกครั้งที่รับข้อมูลจาก ESP32
- เปิด Relay สารปรับ pH ชั่วคราวเมื่อค่าออกนอกช่วงที่กำหนด
- มี Cooldown 5 นาทีระหว่างการ dose

### Flood & Drain Cycle
```
idle → filling → soaking → draining → idle (วนซ้ำตาม cycleHours)
```

### ปั๊มน้ำ
- เปิดทุก `pumpInterval` ชั่วโมง นาน `pumpDuration` นาที

## วิธี Deploy บน Railway

1. Push โค้ดโฟลเดอร์ `server/` ขึ้น GitHub
2. สร้าง Project ใหม่บน [railway.app](https://railway.app) → Deploy from GitHub
3. ตั้ง Environment Variables ใน Railway dashboard
4. Railway ใช้ `Procfile` (`web: node server.js`) รัน server อัตโนมัติ
5. แก้ `SERVER_URL` ใน `smart_farm.ino` ให้ตรงกับ URL ที่ได้จาก Railway แล้ว Upload ใหม่

## Dependencies

| Package | หน้าที่ |
|---------|---------|
| express | HTTP server + routing |
| express-session | Login/session management |
| socket.io | Real-time push to browser |
| dotenv | โหลด environment variables |
