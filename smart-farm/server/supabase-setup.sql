-- ============================================================
--  Smart Farm — ตารางเก็บข้อมูลรอบปลูกบน Supabase
--
--  รันไฟล์นี้ครั้งเดียวใน Supabase → SQL Editor → New query → วาง → Run
--
--  ทำไมต้องมี: Render free instance ต่อ persistent disk ไม่ได้ ไฟล์ที่เขียนตอนรัน
--  หายทุกครั้งที่ redeploy / restart / spin down (หลังไม่มี traffic 15 นาที)
--  รอบปลูกใช้เวลา ~20 วัน ถ้าไฟดับแล้ว ESP32 ไม่กลับมาภายใน 15 นาที
--  Render จะหลับแล้วข้อมูลที่เก็บมาทั้งรอบหายหมด
--
--  ขนาดข้อมูล: บันทึกทุก 5 นาที → 20 วัน = 5,760 records/ลัง ≈ 1.6 MB
--  free tier ให้ 500 MB จึงเก็บได้หลายปี
-- ============================================================

create table if not exists crop_cycles (
    id           text primary key,
    tray         smallint  not null check (tray in (1, 2)),
    crop_name    text      not null,
    start_time   bigint    not null,          -- epoch ms (ให้ตรงกับฝั่ง JS)
    end_time     bigint,                      -- null = ยังปลูกอยู่
    status       text      not null check (status in ('active', 'completed')),
    record_count integer   not null default 0,
    created_at   timestamptz not null default now()
);

-- ใช้ตอน boot เพื่อหารอบที่ยัง active ของแต่ละลัง
create index if not exists crop_cycles_active_idx
    on crop_cycles (tray, status, start_time desc);

create table if not exists crop_records (
    cycle_id text        not null references crop_cycles(id) on delete cascade,
    ts       timestamptz not null,
    t  real,        -- อุณหภูมิ °C
    h  real,        -- ความชื้น %
    l  real,        -- แสง lux
    p  real,        -- pH ลัง1   (null ได้ = เซ็นเซอร์ผิดพลาด ต่างจาก 0)
    p2 real,        -- pH ลัง2
    v  real,        -- แรงดัน V
    c  real,        -- กระแส A
    pw real,        -- กำลัง W
    w  real[],      -- ระดับน้ำ 6 ถัง %
    -- primary key นี้ทำให้ retry การเขียนซ้ำได้โดยไม่เกิดข้อมูลซ้ำ
    -- (record เดียวกันถูกเขียนลงทั้ง 2 ลังด้วย ts เดียวกัน แต่คนละ cycle_id)
    primary key (cycle_id, ts)
);

-- ค่าที่วัดด้วยมือ (pH meter / ไม้บรรทัด ฯลฯ) ตอนที่ ESP32 ออฟไลน์
-- แยกจาก crop_records โดยตั้งใจ — ค่าเซ็นเซอร์ไม่ถูกแตะ และรายงานแยกออกได้เสมอว่าค่าไหนวัดด้วยมือ
-- ไม่ผูกกับรอบปลูก: รอบไหนที่ช่วงเวลาครอบ ts นี้ก็เห็นค่านี้ (เหมือน record ของเซ็นเซอร์ที่เป็นภาพรวมทั้งฟาร์ม)
-- ถ้าเคยรันไฟล์นี้ไปแล้ว รันซ้ำได้เลย — ทุกคำสั่งเป็น "if not exists"
create table if not exists crop_manual_records (
    id         text        primary key,
    ts         timestamptz not null,
    t  real, h  real, l  real, p  real, p2 real,
    v  real, c  real, pw real,
    w  real[],                                -- 6 ช่อง, ช่องที่ไม่ได้วัด = null
    note       text,
    created_by text,
    created_at timestamptz not null default now()
);

-- ============================================================
--  ความปลอดภัย
--  เซิร์ฟเวอร์ใช้ service_role key ซึ่งข้าม RLS อยู่แล้ว
--  เปิด RLS โดยไม่สร้าง policy = ไม่มีใครเข้าถึงได้ผ่าน anon key
--  (กันกรณีเผลอเอา anon key ไปใช้ฝั่งเบราว์เซอร์)
-- ============================================================
alter table crop_cycles  enable row level security;
alter table crop_records enable row level security;
alter table crop_manual_records enable row level security;
