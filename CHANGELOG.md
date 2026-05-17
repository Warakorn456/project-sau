# Changelog — Smart Farm Dashboard

บันทึกการเปลี่ยนแปลงทั้งหมดของโปรเจกต์ เรียงจากใหม่ไปเก่า

---

## [2026-05-17] — UI Improvements

### เพิ่ม
- **Dark / Light Mode toggle** — ปุ่มสลับธีมใน sidebar footer (desktop) และ topbar (mobile)
  - บันทึกค่าใน `localStorage` key `'theme'`
  - โหลดธีมทันทีที่ `<body>` เปิด (ป้องกัน flash)
  - CSS override ผ่าน `body.dark {}` ใน `style.css`
- **Desktop Info Bar** (`.desk-infobar`) — แถบ sticky ด้านบน content แสดงทุกหน้า
  - แสดงนาฬิกา (วันที่ + เวลา real-time), สถานะ ESP32, เวลาอัปเดตล่าสุด
  - ซ่อนบน mobile (แสดงเฉพาะ desktop)
- **Real-time Clock** — `#clock-date` + `#clock-time` อัปเดตทุก 1 วินาที ด้วย `startClock()`
  - วันที่: Thai locale (อา. 17 พ.ค. 2568)
  - เวลา: HH:MM:SS

### แก้ไข
- **Sidebar footer layout** — เปลี่ยนจาก flex row → flex column
  - เพิ่ม `.sidebar-user-row` wrapper สำหรับ avatar + logout
  - ป้องกัน theme button ตกขอบ
- **ESP32 status + clock** — ย้ายจาก `page-overview` header ไปอยู่ใน `.desk-infobar`
  - ทำให้แสดงทุกหน้า ไม่หายเมื่อเปลี่ยน page

---

## [2026-05-17] — Project Documentation

### เพิ่ม
- **`README.md`** — เอกสารโปรเจกต์ครบถ้วน (สถาปัตยกรรม, hardware, API, วิธีรัน, deploy)
- **`CLAUDE.md`** — คำอธิบายโปรเจกต์สำหรับ Claude Code (โครงสร้าง, logic, hardware, CSS tokens)
- **`CHANGELOG.md`** — ไฟล์นี้

### แก้ไข
- **`CLAUDE.md`** — อัปเดตเพิ่ม UI layout, dark mode, CSS design tokens, role-based access

---

## [2026-05-17] — Auto Push Hook

### เพิ่ม
- **Stop hook** ใน `.claude/settings.local.json` — auto `git add -A && commit && push origin master` ทุกครั้งที่ Claude ตอบเสร็จ
- เพิ่ม git permissions ใน settings: `git commit *`, `git push *`, `git status *`

---

## [ก่อนหน้า] — Initial Features

### Commit `3eccc1a` — Redesign dashboard with sidebar navigation and multi-page layout
- เปลี่ยน dashboard จากหน้าเดียว → multi-page SPA ด้วย sidebar
- เพิ่ม bottom navigation สำหรับ mobile
- เพิ่มหน้า: ภาพรวม, ระดับน้ำ, ควบคุม, ประวัติ
- CSS ธีมสีเขียว, responsive (desktop + mobile)

### Commit `dfef9a0` — Add user management with role-based access control
- เพิ่มหน้าจัดการผู้ใช้ (admin only)
- Role: `admin` (ควบคุมได้) และ `viewer` (ดูอย่างเดียว)
- API: `GET/POST /api/users`, `DELETE /api/users/:username`
- `GET /api/me` — ส่งข้อมูล user ปัจจุบัน

### Commit `7f8c8d8` — Initial commit
- Portfolio page (`index.html`)
- Smart Farm server พร้อม ESP32 integration
- Auto Mode: pH control, Flood & Drain cycle, ปั๊มน้ำ
- Socket.io real-time, history 24h, login/logout

---

## วิธีอ่าน Changelog นี้

- **เพิ่ม** — feature/ไฟล์ใหม่
- **แก้ไข** — เปลี่ยนแปลง feature ที่มีอยู่
- **ลบ** — นำออก
- **แก้บัก** — bug fix
