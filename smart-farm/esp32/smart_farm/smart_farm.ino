// ============================================================
//  Smart Farm ESP32 - ระบบปลูกผักอัตโนมัติ
// ============================================================
//
//  Libraries ที่ต้องติดตั้งใน Arduino IDE (Library Manager):
//  1. DHT sensor library             (by Adafruit)
//  2. Adafruit Unified Sensor        (by Adafruit)
//  3. BH1750                         (by Christopher Baker)
//  4. Adafruit INA219                (by Adafruit)
//  5. ArduinoJson                    (by Benoit Blanchon)
//
//  Board: ESP32 Dev Module
//  Upload Speed: 115200
// ============================================================

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <esp_task_wdt.h>
#include <DHT.h>
#include <BH1750.h>
#include <Adafruit_INA219.h>
#include <Wire.h>
#include <ArduinoJson.h>

// ============================================================
//  *** แก้ไขค่าตรงนี้ ***
// ============================================================

// WiFi
const char* WIFI_SSID = "PME OFFICE 2";
const char* WIFI_PASS = "qpcaeK4R";

// URL ของ Server (ตอนนี้ deploy อยู่บน Render)
// ถ้าย้ายผู้ให้บริการ อย่าลืมแก้บรรทัดข้างล่างแล้ว upload ใหม่
const char* SERVER_URL = "https://project-sau.onrender.com";

// รหัสลับที่ส่งไปกับทุกคำขอ (header X-Device-Key) — กันคนอื่นยิงค่าเซ็นเซอร์ปลอมเข้า server
// ต้องตรงกับ DEVICE_KEY ใน Environment ของ Render ทุกตัวอักษร
// (ตั้งบน Render "หลัง" flash firmware นี้แล้ว ไม่งั้นบอร์ดตัวเก่าโดนปฏิเสธ)
const char* DEVICE_KEY = "1275447aa5ff56c12fbd9d6fc0a5c177";

// ระดับน้ำส่งเป็น "mm จากก้นถัง" — TANK_DEPTH_MM ต้องตรงกับใน server/public/js/sim-profiles.js
// [0]=ถังน้ำวนลัง2 [1]=ถังPH [2]=ถังน้ำเติม [3]=ลังปลูกผัก1
// [4]=ถังน้ำวนลัง1 [5]=ลังปลูกผัก2  (idx 3/5 ใช้ลูกลอยแล้ว — ค่าในตารางนี้ไม่ได้ใช้กับลัง)
// ระดับน้ำ "เต็ม" วัดจากก้น (mm)
// วัดจริง 2026-10-24: ขวด เซ็นเซอร์→ก้น 350 เต็มต่ำกว่าเซ็นเซอร์ 120 → 230
//                     ลังปลูก เซ็นเซอร์→ก้น 250 น้ำสูงสุด (ถึงราก) ต่ำกว่าเซ็นเซอร์ 50 → 200
const float TANK_DEPTH_MM[6] = { 230, 230, 230, 200, 230, 200 };
// ระยะหน้าเซ็นเซอร์ → ผิวน้ำตอนเต็ม (mm) — TANK_DEPTH_MM + SENSOR_GAP_MM = หน้าเซ็นเซอร์ถึงก้น
// SR04M-2 วัดใกล้กว่า ~200 mm ไม่ได้ (ระยะบอด) → ขวดวัดได้เฉพาะน้ำต่ำกว่า ~110 mm, ลังปลูกแทบไม่ได้เลย
const float SENSOR_GAP_MM[6] = { 120, 120, 120, 50, 120, 50 };
// ระยะบอดที่วัดจริง (2026-10-24): ในถัง/ลังที่น้ำอยู่ใกล้เซ็นเซอร์ ค่ากองอยู่ 194–274 mm ไม่ขยับตามน้ำ
// วัดได้ใกล้กว่านี้ = ผิวน้ำอยู่ในระยะบอด → ส่ง -2 ("น้ำสูงเกินช่วงวัด") แทนตัวเลขปลอม
// ถังที่ หน้าเซ็นเซอร์→ก้นถัง ไม่ถึงค่านี้ (ลังปลูก 150 mm ตอนวางชิดฝา) วัดไม่ได้ทั้งถัง → -2 เสมอเมื่อเซ็นเซอร์ตอบ
const float BLIND_MM = 240.0f;

// Relay: Active LOW (HIGH = ปิด, LOW = เปิด)
// ถ้า Relay module เป็น Active HIGH ให้สลับ LOW/HIGH ในฟังก์ชัน setRelay()
#define RELAY_ACTIVE_LOW true

// ============================================================
//  การกำหนดขา (Pins) - ไม่ต้องแก้ไขถ้าต่อตามผัง
// ============================================================

#define DHT_PIN     4
#define PH1_PIN     34    // pH ลัง1 — ADC1
#define PH2_PIN     39    // pH ลัง2 — ADC1 (ย้ายจาก SR04 ถังน้ำวนลัง2)
#define SR04_TX_PIN  25                              // TX ร่วมกันทุกตัว (ส่ง trigger)
const int SR04_RX_PINS[6] = { 26, 27, 32, 36, 35, 33 };
// [0]=ถังน้ำวนลัง2 (26) [1]=ถังPH (27) [2]=ถังน้ำเติม (32)
// [3]=ลังปลูกผัก1 (36=VP) [4]=ถังน้ำวนลัง1 (35) [5]=ลังปลูกผัก2 (33)
// ลัง1/ลัง2 สลับขากัน (2026-10-24): ทดสอบด้วย sr04_test แล้วสายลัง1 ต่ออยู่ที่ VP — แก้ในโค้ดแทนย้ายสาย
// ลังปลูก (idx 3/5) เลิกใช้ SR04 แล้ว (2026-10-26) — ลังลึก 250 mm ผิวน้ำอยู่ในระยะบอดตลอด วัดไม่ได้เลย
// ขาที่ไม่มีเซ็นเซอร์ถูกข้าม ไม่งั้นรอ echo ที่ไม่มีวันมาจน retry ครบทุกรอบ (+~1.3 วิ ต่อการส่ง)
const bool SR04_PRESENT[6] = { true, true, true, false, true, false };

// สวิตช์ลูกลอยในลังปลูก ลังละ 1 ตัวที่ระดับน้ำเต็ม (ถึงราก) — แทน SR04 ของลัง
// ต่อขาหนึ่งเข้า GPIO อีกขาลง GND (ใช้ pull-up ในชิป) [0]=ลัง1 GPIO19, [1]=ลัง2 GPIO13
// FLOAT_FULL_LEVEL = ระดับขาตอนลูกลอยยก (น้ำเต็ม) — ติดลูกลอยกลับหัว/เป็นแบบ NC ให้สลับเป็น HIGH
const int FLOAT_PINS[2] = { 19, 13 };
#define FLOAT_FULL_LEVEL HIGH   // 2026-10-31 ลูกลอยจริง: อยู่ล่าง = ต่อ (ON), ลอยขึ้น = ตัด (OFF) = น้ำเต็ม

// Relay 8 ตัว
// R1=GPIO2  ปั๊มเติมลัง1        R2=GPIO5  ปั๊มเติมลัง2
// R3=GPIO18 ปั๊มเติมPHลัง1      R4=GPIO23 ปั๊มเติมPHลัง2
// R5=GPIO15 ถังน้ำวน1 → ลัง1    R6=GPIO14 ลัง1 → ถังน้ำวน1
// R7=GPIO16 ถังน้ำวน2 → ลัง2    R8=GPIO17 ลัง2 → ถังน้ำวน2
// R3 ย้ายจาก GPIO13 (2026-10-11): บอร์ดสั่ง LOW แล้วแต่ relay ไม่ติด + ขา D13 อยู่ติด SD2 (สาย flash)
// R5/R6 สลับขากัน (2026-10-24): ปั๊มต่อกลับทิศกับที่โค้ดคาด — แก้ในโค้ดแทนย้ายสาย
#define RELAY_COUNT 8
const int RELAY_PINS[RELAY_COUNT] = { 2, 5, 18, 23, 15, 14, 16, 17 };

// ============================================================
//  ตัวแปรระบบ
// ============================================================

DHT           dht(DHT_PIN, DHT11);
BH1750        lightMeter;
Adafruit_INA219 ina219;

// flag: เจอ sensor I2C ตอน setup ไหม — ถ้าไม่เจอจะข้ามการอ่าน (กัน Wire ค้าง loop)
bool bh1750Ok = false;
bool ina219Ok = false;
WiFiClientSecure sslClient;
// ใช้ตัวเดียวตลอดเพื่อให้ keep-alive ใช้การเชื่อมต่อ TLS เดิมซ้ำได้ — เดิมสร้างใหม่ทุกรอบ
// = handshake TLS ใหม่ทุก 2-3 วิ ซึ่งเป็นช่วงที่ช้า/พังบ่อยที่สุดตอนสัญญาณ WiFi อ่อน
HTTPClient    http;

bool    relayStates[RELAY_COUNT] = { false };
unsigned long lastSend   = 0;
const unsigned long SEND_INTERVAL = 2000; // ส่งทุก 2 วินาที

// Failsafe: relay เปลี่ยนสถานะตามคำตอบของ server เท่านั้น ถ้า WiFi หลุด / server ล่ม
// ตอนปั๊มเปิดอยู่ ปั๊มจะเปิดค้างไปจนกว่าเน็ตกลับ — ปั๊มน้ำยาลด pH ที่ควรเปิด 3 วิ
// อาจเปิดเป็นชั่วโมงจน pH ดิ่ง / ปั๊มเติมน้ำทำน้ำล้นลัง
// จึงปิดทุกตัวเองเมื่อไม่ได้คำตอบที่ใช้ได้จาก server เกิน FAILSAFE_MS
const unsigned long FAILSAFE_MS = 30000;
unsigned long lastServerOk = 0;

// Watchdog: ถ้า loop() ค้างเกิน 30 วิ (เช่น HTTP/I2C hang) ให้รีบูตตัวเองอัตโนมัติ
// กันปัญหาเครื่องค้างเงียบแล้วไม่มีใครไปกด reset ให้
const uint32_t WDT_TIMEOUT_SEC = 30;

// อายุสูงสุดของค่าระดับน้ำที่ค้างไว้ได้ ถ้าเซ็นเซอร์ไม่ตอบนานเกินนี้ให้ส่ง -1
// แทนที่จะส่งค่าเก่าซ้ำไปเรื่อย ๆ — ไม่งั้น server แยกไม่ออกว่าค่าไหนสด ค่าไหนค้าง
// แล้ว Auto Mode จะเปิดวาล์วค้างเพราะรอค่าที่ไม่มีวันขยับ
const unsigned long WL_HOLD_MS = 60000;   // 60 วิ = ~30 รอบส่ง

// ---- พารามิเตอร์ pH (แก้ตรงนี้ที่เดียวเวลา calibrate) ----
const int   PH_SAMPLES         = 20;
// แยกต่อโพรบ [0]=ลัง1 GPIO34, [1]=ลัง2 GPIO39 — calibrate 2026-10-24 ด้วย buffer 4.0 + 6.86 (ไฟเลี้ยง 4.84 V)
//   ลัง1: 4.0→1654 mV, 6.86→1210 mV (9.18→964 = ฝั่งด่างตอบสนองอ่อน อ่านต่ำไป ~0.6 ไม่กระทบช่วงผัก 5.5–6.5)
//   ลัง2: 4.0→1665 mV, 6.86→1226 mV
//   ลัง1 เลื่อนจุดศูนย์ทีหลัง (ผู้ใช้สั่ง 2026-10-24): น้ำในลังจริงอ่านได้ ~1453 mV แต่กระดาษลิตมัสวัดได้ 6.5
//   → VMID = 1453 − 0.5×155 = 1376 (slope เดิม) — ผลข้างเคียง: buffer 6.86 จะอ่านได้ ~8.1 แทน
//   ยังไม่รู้ว่าฝั่งไหนผิด (กระดาษหยาบ ±0.5–1 / ไฟรั่วจากปั๊มลงน้ำ) ค่าเดิมจาก buffer = 1188
//   เลื่อนครั้งที่ 2 (ผู้ใช้สั่ง): หลังปั๊มทำงานรอบหนึ่ง ค่าน้ำเดิมเลื่อนเป็น ~1590 mV → VMID = 1590 − 77.5 = 1513
//   (ค่าไม่คงที่ตามประวัติการทำงานของปั๊ม — ต้นเหตุจริงยังไม่ได้แก้)
// ⚠️ ค่าเลื่อนตามไฟเลี้ยงบอร์ดแอมป์ (USB 4.42 V อ่านสูงกว่า ~120 mV ≈ 0.8 pH) — calibrate ด้วยไฟชุดที่ใช้จริง
// ⚠️ ปั๊มทำงาน (R5/R6) = pH ชนเพดาน 2400–3139 mV → null ทุกรอบ ค่าใช้ได้เฉพาะตอนปั๊มปิด
const float PH_VMID_MV[2]         = { 1513.0f, 1205.0f }; // แรงดันตอน pH 7
const float PH_SLOPE_MV_PER_PH[2] = {  155.0f,  153.0f }; // mV ต่อ 1 pH

// กรอบค่าที่ยอมรับ นอกกรอบ = โพรบหลุด/ยังไม่จุ่มน้ำ/ยังไม่ calibrate → ส่ง null
const float PH_PLAUSIBLE_MIN   = 3.0f;
const float PH_PLAUSIBLE_MAX   = 11.0f;

// GPIO34/39 เป็น input-only ไม่มี pull-up/pull-down ในตัว สายหลุดแล้วขาจะ "ลอย"
// นั่งอยู่กลางสเกลและเต้นแรง ไม่ได้ตกลงใกล้ 0 — จับด้วยช่วงกลาง 50% (IQR) ของค่าที่อ่าน
// ค่าที่ขับด้วยแอมป์จริงได้ IQR 5–36 mV (วัด 2026-10-24) ถ้าโพรบจริงโดนตัดทิ้งให้เพิ่มค่านี้
const int   PH_NOISE_MAX_MV    = 120;

// ============================================================
//  ฟังก์ชัน: ตั้งค่า Relay
// ============================================================

void setRelay(int index, bool on) {
    relayStates[index] = on;
    if (RELAY_ACTIVE_LOW) {
        digitalWrite(RELAY_PINS[index], on ? LOW : HIGH);
    } else {
        digitalWrite(RELAY_PINS[index], on ? HIGH : LOW);
    }
}

// ============================================================
//  ฟังก์ชัน: วัดระยะห่าง SR04M-2 แบบ Trigger/Echo (อ่าน 7 ตัวพร้อมกัน)
//  RX=GPIO25 แชร์ trigger เดียว → ยิงครั้งเดียว echo ทุกตัวกลับพร้อมกัน
//  อ่านขนานกันเพื่อกัน crosstalk + เร็ว: 1 trigger ต่อ 1 รอบ (ไม่ใช่ 7)
//  ระยะ(cm) = เวลา echo(µs) / 58
// ============================================================

// ยิง trigger 1 ครั้ง แล้วจับ echo ทั้ง 7 ขาพร้อมกัน → เติม distCm[7]
static void triggerAndReadAll(float distCm[6]) {
    bool  started[6] = { false }, done[6] = { false };
    uint32_t riseT[6];
    int remaining = 0;
    for (int i = 0; i < 6; i++) {
        if (SR04_PRESENT[i]) remaining++;
        else { done[i] = true; distCm[i] = -1.0f; }
    }

    // ส่ง trigger pulse 10µs (เซ็นเซอร์ทุกตัวรับพร้อมกัน)
    digitalWrite(SR04_TX_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(SR04_TX_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(SR04_TX_PIN, LOW);

    // วน sample ทั้ง 6 ขาพร้อมกัน จนครบหรือ timeout 30ms (~5m)
    uint32_t t0 = micros();
    while (remaining > 0 && (uint32_t)(micros() - t0) < 30000UL) {
        for (int i = 0; i < 6; i++) {
            if (done[i]) continue;
            int v = digitalRead(SR04_RX_PINS[i]);
            if (!started[i]) {
                if (v == HIGH) { started[i] = true; riseT[i] = micros(); }
            } else if (v == LOW) {
                distCm[i] = (micros() - riseT[i]) / 58.0f;
                done[i] = true;
                remaining--;
            }
        }
    }
    // ขาที่ไม่ตอบ = -1
    for (int i = 0; i < 6; i++)
        if (!done[i]) distCm[i] = -1.0f;
}

// อ่าน 1 รอบครบ 6 ตัว + retry รวม: ขาไหนยังไม่ได้ค่าให้ลองใหม่ (สูงสุด 5 รอบ)
static void measureOnce(float distCm[6]) {
    for (int i = 0; i < 6; i++) distCm[i] = -1.0f;

    for (int attempt = 0; attempt < 5; attempt++) {
        float tmp[6];
        triggerAndReadAll(tmp);
        bool allDone = true;
        for (int i = 0; i < 6; i++) {
            if (distCm[i] < 0.0f && tmp[i] > 0.0f) distCm[i] = tmp[i]; // เก็บค่าที่เพิ่งได้
            if (SR04_PRESENT[i] && distCm[i] < 0.0f) allDone = false;
        }
        if (allDone) break;
        delay(60); // เว้นตามรอบ measurement ของโมดูล
    }
}

// ค่ากลาง (median) ของค่าที่ valid (>=0) ใน 3 ตัว — ค่า -1 (sensor ไม่ตอบ) ไม่นับ
static float medianValid(float a, float b, float c) {
    float v[3]; int n = 0;
    if (a >= 0.0f) v[n++] = a;
    if (b >= 0.0f) v[n++] = b;
    if (c >= 0.0f) v[n++] = c;
    if (n == 0) return -1.0f;
    if (n == 1) return v[0];
    if (n == 2) return (v[0] + v[1]) / 2.0f;
    if (v[0] > v[1]) { float t = v[0]; v[0] = v[1]; v[1] = t; }
    if (v[1] > v[2]) { float t = v[1]; v[1] = v[2]; v[2] = t; }
    if (v[0] > v[1]) { float t = v[0]; v[0] = v[1]; v[1] = t; }
    return v[1];
}

// วัด 3 รอบแล้วเอาค่ากลาง (median) ต่อเซ็นเซอร์ — กรอง spike ชั่วขณะจาก
// crosstalk ระหว่างถัง (เสียงสะท้อนข้ามจากถังข้างๆ ทำให้ระยะสั้นผิดปกติแว้บเดียว)
void measureAllDistances(float distCm[6]) {
    float sample[3][6];
    for (int s = 0; s < 3; s++) {
        measureOnce(sample[s]);
        if (s < 2) delay(60); // เว้นก่อนยิง trigger รอบถัดไป กัน echo รอบก่อนค้าง
    }
    for (int i = 0; i < 6; i++) {
        distCm[i] = medianValid(sample[0][i], sample[1][i], sample[2][i]);
    }
}

// แปลงระยะห่าง → ความลึกน้ำจากก้นถัง (mm) 0=ว่าง, TANK_DEPTH_MM=เต็มปากถัง
// -1 = เซ็นเซอร์ไม่ตอบ/ค่าผิด, -2 = ผิวน้ำอยู่ในระยะบอด (สูงเกินช่วงที่วัดได้)
float distanceToMm(float distCm, int i) {
    if (distCm < 0.0f) return -1.0f; // sensor error
    float mount  = TANK_DEPTH_MM[i] + SENSOR_GAP_MM[i]; // หน้าเซ็นเซอร์ถึงก้นถัง
    float distMm = distCm * 10.0f;
    if (mount <= BLIND_MM || distMm < BLIND_MM) return -2.0f;
    // กรอง crosstalk: ระยะเกินก้นถัง +100 mm = ค่าผิด (เสียงตัวอื่น) → ทิ้ง
    if (distMm > mount + 100.0f) return -1.0f;
    return constrain(mount - distMm, 0.0f, TANK_DEPTH_MM[i]);
}

// หน้าสัมผัสลูกลอยลัง i ต่ออยู่ไหม (1 = ON/ต่อ = ขาถูกดึงลง GND, 0 = OFF/ตัด)
// อ่าน 5 ครั้งเอาเสียงข้างมาก — หน้าสัมผัสเด้งตอนน้ำกระเพื่อมใกล้ระดับเต็ม
int readFloatClosed(int i) {
    int closed = 0;
    for (int k = 0; k < 5; k++) {
        if (digitalRead(FLOAT_PINS[i]) == LOW) closed++;
        delay(2);
    }
    return closed >= 3 ? 1 : 0;
}

// สถานะหน้าสัมผัส → น้ำเต็มไหม (1 = เต็ม) ตาม FLOAT_FULL_LEVEL
int floatToFull(int closed) {
    return (FLOAT_FULL_LEVEL == LOW) ? closed : !closed;
}

// ============================================================
//  ฟังก์ชัน: อ่านค่า pH
//  ** ต้องสอบเทียบ (Calibrate) ด้วย Buffer Solution pH4 และ pH7 **
// ============================================================

float readPH(int pin, int probe) {
    // analogReadMilliVolts() ใช้ค่า Vref ที่ปรับเทียบไว้ใน eFuse ของชิป
    // แม่นกว่าการคูณ raw * 3.3/4095 เองมาก (ADC ของ ESP32 ไม่เป็นเชิงเส้น)
    int v[PH_SAMPLES];
    for (int i = 0; i < PH_SAMPLES; i++) {
        v[i] = analogReadMilliVolts(pin);
        delay(5);
    }
    // เรียงแล้วใช้ค่ากลาง ไม่ใช่ค่าเฉลี่ย — วัดจริง 2026-10-24 (ph_test.ino): ทั้ง 2 ตัวฐานนิ่ง ±10 mV
    // แต่มี spike ขึ้น 300–800 mV เป็นพักๆ ค่าเฉลี่ย+p2p เดิมเลยทิ้งเกือบทุกรอบ (null)
    // spike ไปกองปลายแถว ค่ากลางกับ IQR จึงไม่โดน
    for (int a = 1; a < PH_SAMPLES; a++) {
        int t = v[a], b = a - 1;
        while (b >= 0 && v[b] > t) { v[b + 1] = v[b]; b--; }
        v[b + 1] = t;
    }
    float medMv = (v[PH_SAMPLES / 2 - 1] + v[PH_SAMPLES / 2]) / 2.0f;
    int   iqr   = v[PH_SAMPLES * 3 / 4] - v[PH_SAMPLES / 4];

    // ขาลอย = ค่าวิ่งทั้งสเกล (วัดได้ 250–3139 mV) ช่วงกลาง 50% ก็กว้างตาม
    if (iqr > PH_NOISE_MAX_MV) {
        Serial.printf("[pH-DBG] pin=%d  med=%.0f mV  iqr=%d mV  ERROR (ขาลอย/สายหลุด)\n",
            pin, medMv, iqr);
        return -1.0f;
    }

    float ph = 7.0f + ((PH_VMID_MV[probe] - medMv) / PH_SLOPE_MV_PER_PH[probe]);

    // นอกกรอบที่เป็นไปได้ — ส่ง -1 (จะกลายเป็น null) ดีกว่าปัดเข้ากรอบ 0-14
    // แล้วส่งตัวเลขหน้าตาน่าเชื่อถือออกไปให้ Auto Mode เอาไปสั่งจ่ายสาร
    if (ph < PH_PLAUSIBLE_MIN || ph > PH_PLAUSIBLE_MAX) {
        Serial.printf("[pH-DBG] pin=%d  med=%.0f mV  iqr=%d mV  pH=%.2f  ERROR (นอกกรอบ %.1f-%.1f)\n",
            pin, medMv, iqr, ph, PH_PLAUSIBLE_MIN, PH_PLAUSIBLE_MAX);
        return -1.0f;
    }

    Serial.printf("[pH-DBG] pin=%d  med=%.0f mV  iqr=%d mV  pH=%.2f\n", pin, medMv, iqr, ph);
    return ph;
}

// ============================================================
//  ฟังก์ชัน: เชื่อมต่อ WiFi
// ============================================================

// ปิด relay ทุกตัวถ้าขาดการติดต่อกับ server นานเกิน FAILSAFE_MS (ดูเหตุผลที่ประกาศค่า)
// เรียกได้บ่อยเท่าไหร่ก็ได้ — ทำงานเฉพาะตอนยังมี relay เปิดอยู่
void checkFailsafe() {
    if (millis() - lastServerOk <= FAILSAFE_MS) return;
    bool anyOn = false;
    for (int i = 0; i < RELAY_COUNT; i++) {
        if (relayStates[i]) { setRelay(i, false); anyOn = true; }
    }
    if (anyOn) {
        Serial.printf("[Failsafe] ไม่ได้คำตอบจาก server เกิน %lu วิ -> ปิด relay ทุกตัว\n", FAILSAFE_MS / 1000);
    }
}

void connectWiFi() {
    if (WiFi.status() == WL_CONNECTED) return;

    // เคลียร์ session เก่าก่อนต่อใหม่ทุกครั้ง กัน WiFi stack ค้างสถานะ "กำลังเชื่อมต่อ"
    // จากรอบก่อน (ไม่งั้น WiFi.begin() รอบถัดไปจะโดนปฏิเสธ: "cannot set config")
    WiFi.disconnect(true);
    delay(200);

    Serial.print("[WiFi] Connecting to ");
    Serial.println(WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);

    int attempt = 0;
    while (WiFi.status() != WL_CONNECTED && attempt < 40) {
        // ลูปนี้บล็อกได้ถึง ~20 วิ และ setup() เรียกมันหลัง esp_task_wdt_add()
        // โดยไม่มี reset คั่น — ถ้าไม่เตะตรงนี้ WiFi ต่อไม่ติด = panic reboot วนไม่จบ
        esp_task_wdt_reset();
        checkFailsafe();   // ลูปนี้บล็อกได้ ~20 วิ — ห้ามปล่อยให้ปั๊มเปิดค้างระหว่างรอ
        delay(500);
        Serial.print(".");
        attempt++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("\n[WiFi] Connected! SSID: %s  IP: %s  RSSI: %d dBm\n",
            WiFi.SSID().c_str(), WiFi.localIP().toString().c_str(), WiFi.RSSI());
    } else {
        Serial.printf("\n[WiFi] Failed! status=%d Will retry...\n", WiFi.status());
    }
}

// ============================================================
//  ฟังก์ชัน: ส่งข้อมูลเซ็นเซอร์และรับคำสั่งรีเลย์
// ============================================================

void sendDataAndReceiveRelays() {
    if (WiFi.status() != WL_CONNECTED) {
        connectWiFi();
        return;
    }

    // --- อ่านค่าเซ็นเซอร์ ---
    // อ่านไม่ได้ = NAN แล้วส่งเป็น null (ไม่ใช่ 0) — เดิมส่ง 0 แล้ว server บันทึกลงรายงาน
    // ว่า 0°C / 0 lux ทำให้ค่าเฉลี่ยรายวันต่ำลงเงียบๆ (แบบเดียวกับที่ pH ส่ง null อยู่แล้ว)
    float temperature = dht.readTemperature();
    float humidity    = dht.readHumidity();

    // อ่าน I2C เฉพาะตัวที่เจอตอน setup (ถ้าไม่เจอ ข้ามไป กัน Wire ค้าง)
    // BH1750 คืนค่าติดลบเมื่ออ่านพลาด
    float light      = bh1750Ok ? lightMeter.readLightLevel() : NAN;
    if (light < 0) light = NAN;
    float busVoltage = ina219Ok ? ina219.getBusVoltage_V()     : NAN;
    float currentA   = ina219Ok ? ina219.getCurrent_mA() / 1000.0f : NAN;
    float powerW     = ina219Ok ? ina219.getPower_mW()   / 1000.0f : NAN;
    float phValue1   = readPH(PH1_PIN, 0);
    float phValue2   = readPH(PH2_PIN, 1);

    // ระดับน้ำ 6 ถัง — ยิง trigger ครั้งเดียว อ่านทุกตัวพร้อมกัน
    // ค้างค่าล่าสุด: ระดับน้ำเปลี่ยนช้า ถ้ารอบนี้พลาด (crosstalk) ใช้ค่าก่อนหน้า
    static float         lastWl[6]     = { -1, -1, -1, -1, -1, -1 };
    static unsigned long lastWlTime[6] = { 0, 0, 0, 0, 0, 0 };
    float dist[6], wl[6];
    unsigned long nowMs = millis();
    measureAllDistances(dist);
    for (int i = 0; i < 6; i++) {
        float lv = distanceToMm(dist[i], i);
        if (lv >= 0.0f || lv == -2.0f) { lastWl[i] = lv; lastWlTime[i] = nowMs; }

        // ค่าค้างมีอายุจำกัด พ้นกำหนดแล้วส่ง -1 ให้ server รู้ว่าเซ็นเซอร์เงียบ
        bool fresh = (lastWlTime[i] != 0) && (nowMs - lastWlTime[i] <= WL_HOLD_MS);
        wl[i] = fresh ? lastWl[i] : -1.0f;

        if (!SR04_PRESENT[i]) continue;
        Serial.printf("[SR04] sensor[%d] dist=%.1f cm  now=%.0f mm  send=%.0f mm%s\n",
            i, dist[i], lv, wl[i], (lv == -1.0f && fresh) ? "  (ค่าค้าง)" : "");
    }

    int floatOn[2]   = { readFloatClosed(0), readFloatClosed(1) };
    int trayFloat[2] = { floatToFull(floatOn[0]), floatToFull(floatOn[1]) };
    Serial.printf("[FLOAT] ลัง1=%s (%s)  ลัง2=%s (%s)\n",
        trayFloat[0] ? "เต็ม" : "ยังไม่เต็ม", floatOn[0] ? "ON" : "OFF",
        trayFloat[1] ? "เต็ม" : "ยังไม่เต็ม", floatOn[1] ? "ON" : "OFF");

    // --- สร้าง JSON ---
    StaticJsonDocument<768> doc;
    if (isnan(temperature)) doc["temperature"] = nullptr; else doc["temperature"] = round(temperature * 10) / 10.0;
    if (isnan(humidity))    doc["humidity"]    = nullptr; else doc["humidity"]    = round(humidity    * 10) / 10.0;
    if (isnan(light))       doc["light"]       = nullptr; else doc["light"]       = round(light);
    if (phValue1 < 0) doc["ph"]  = nullptr; else doc["ph"]  = round(phValue1 * 10) / 10.0;
    if (phValue2 < 0) doc["ph2"] = nullptr; else doc["ph2"] = round(phValue2 * 10) / 10.0;
    if (isnan(busVoltage))  doc["voltage"]     = nullptr; else doc["voltage"]     = round(busVoltage  * 100) / 100.0;
    if (isnan(currentA))    doc["current"]     = nullptr; else doc["current"]     = round(currentA    * 1000) / 1000.0;
    if (isnan(powerW))      doc["power"]       = nullptr; else doc["power"]       = round(powerW      * 100) / 100.0;

    JsonArray waterLevel = doc.createNestedArray("waterLevel");
    for (int i = 0; i < 6; i++) {
        waterLevel.add((int)round(wl[i]));   // mm, -1 = เซ็นเซอร์ไม่ตอบ, -2 = เกินช่วงวัด (ระยะบอด)
    }
    doc["wlUnit"] = "mm";   // ไม่มีฟิลด์นี้ = firmware เก่าส่ง % → server แปลงให้

    // ระยะดิบหน้าเซ็นเซอร์ → ผิวน้ำ (mm) ของรอบนี้ ไม่ค้างค่า — ไว้เช็คระยะบอดจากหน้าเว็บโดยไม่ต้องเสียบ serial
    JsonArray wlRaw = doc.createNestedArray("wlRaw");
    for (int i = 0; i < 6; i++) {
        wlRaw.add(dist[i] < 0.0f ? -1 : (int)round(dist[i] * 10.0f));
    }

    // ลูกลอยลังปลูก 1 = น้ำเต็ม, 0 = ยังไม่เต็ม — server แปลงเป็น waterLevel[3]/[5] เอง
    JsonArray tf = doc.createNestedArray("trayFloat");
    tf.add(trayFloat[0]);
    tf.add(trayFloat[1]);

    // หน้าสัมผัสลูกลอยดิบ 1 = ON (ต่อ), 0 = OFF (ตัด) — หน้าเว็บโชว์ไว้เช็คสาย/ทิศลูกลอยตอนติดตั้ง
    JsonArray fo = doc.createNestedArray("floatOn");
    fo.add(floatOn[0]);
    fo.add(floatOn[1]);

    String body;
    serializeJson(doc, body);

    Serial.println("[HTTP] Sending: " + body);

    // --- HTTP POST ---
    sslClient.setInsecure(); // ข้าม SSL certificate verification
    // ⚠️ ค่าตั้งต้นของ core รอ TLS handshake ได้ 120 วิ — เกิน WDT 30 วิ วัดจริง 2026-10-11:
    // handshake ค้างตอนสัญญาณอ่อน (RSSI -74) แล้ว WDT รีบูตบอร์ด 2 ครั้งใน 3 นาที = Offline ~45 วิ
    // รวมทุกช่วงแล้วต้องต่ำกว่า WDT_TIMEOUT_SEC: connect 6 + handshake 8 + รอคำตอบ 8 = 22 วิ
    // ส่งไม่ทันก็ข้ามไปรอบถัดไป (Render cold start ก็ตื่นจากคำขอที่หมดเวลาไปแล้วอยู่ดี)
    sslClient.setHandshakeTimeout(8);   // หน่วยเป็นวินาที

    if (!http.begin(sslClient, String(SERVER_URL) + "/api/data")) {
        Serial.println("[HTTP] Cannot connect to server");
        return;
    }

    http.setReuse(true);
    http.setConnectTimeout(6000);
    http.setTimeout(8000);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Device-Key", DEVICE_KEY);

    esp_task_wdt_reset();   // อ่านเซ็นเซอร์ไปแล้ว ~1 วิ — นับ WDT ใหม่ก่อนเข้าช่วงที่บล็อกได้ถึง 22 วิ
    int httpCode = http.POST(body);

    if (httpCode == HTTP_CODE_OK) {
        String response = http.getString();
        Serial.println("[HTTP] Response: " + response);

        // อ่านคำสั่งรีเลย์จาก response
        StaticJsonDocument<256> respDoc;
        DeserializationError err = deserializeJson(respDoc, response);
        if (!err) {
            JsonArray relays = respDoc["relays"].as<JsonArray>();
            if (relays.size() == RELAY_COUNT) {
                lastServerOk = millis();   // ได้คำสั่งที่ใช้ได้ = ยังติดต่อกันอยู่ (ดู checkFailsafe)
                for (int i = 0; i < RELAY_COUNT; i++) {
                    bool newState = relays[i].as<bool>();
                    if (newState != relayStates[i]) {
                        setRelay(i, newState);
                        Serial.printf("[Relay] R%d -> %s\n", i + 1, newState ? "ON" : "OFF");
                    }
                }
            }
        }
    } else if (httpCode == 401) {
        Serial.println("[HTTP] 401 — DEVICE_KEY ไม่ตรงกับบน server");
    } else {
        Serial.printf("[HTTP] Error: %d\n", httpCode);
    }

    http.end();   // setReuse = ปิดแค่คำขอ ส่วนการเชื่อมต่อ TLS ค้างไว้ใช้รอบหน้า
    // พลาด = การเชื่อมต่อเดิมอาจพังครึ่งๆ กลางๆ ตัดทิ้งให้รอบหน้าต่อใหม่สะอาดๆ
    if (httpCode != HTTP_CODE_OK) sslClient.stop();
}

// ============================================================
//  Setup
// ============================================================

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n============================");
    Serial.println("  Smart Farm ESP32 Starting");
    Serial.println("============================");

    // เปิด Task Watchdog: ถ้า loop() ไม่เรียก esp_task_wdt_reset() ทันภายใน
    // WDT_TIMEOUT_SEC วินาที (เช่นค้างที่ HTTP หรือ I2C) จะ panic แล้วรีบูตเอง
    esp_task_wdt_config_t wdtConfig = {
        .timeout_ms = WDT_TIMEOUT_SEC * 1000,
        .idle_core_mask = 0,
        .trigger_panic = true
    };
    esp_task_wdt_reconfigure(&wdtConfig);
    esp_task_wdt_add(NULL);

    // Init Relay (ปิดทั้งหมดก่อน)
    for (int i = 0; i < RELAY_COUNT; i++) {
        pinMode(RELAY_PINS[i], OUTPUT);
        setRelay(i, false);
    }
    Serial.println("[Relay] Initialized (all OFF)");

    // Init JSN-SR04T — Trigger/Echo mode: TRIG=GPIO25 (OUTPUT), ECHO=26-39 (INPUT)
    pinMode(SR04_TX_PIN, OUTPUT);
    digitalWrite(SR04_TX_PIN, LOW);
    for (int i = 0; i < 6; i++) pinMode(SR04_RX_PINS[i], INPUT);
    Serial.println("[JSN-SR04T] Trigger/Echo mode, TRIG=GPIO25, 4 sensors ready (ลังปลูกใช้ลูกลอย)");

    for (int i = 0; i < 2; i++) pinMode(FLOAT_PINS[i], INPUT_PULLUP);
    Serial.println("[FLOAT] ลัง1=GPIO19 ลัง2=GPIO13 (INPUT_PULLUP)");

    // Init ADC (pH) — ระบุให้ชัด ไม่พึ่ง default ของ core
    analogReadResolution(12);
    analogSetPinAttenuation(PH1_PIN, ADC_11db);   // ครอบช่วง ~0-3.1V
    analogSetPinAttenuation(PH2_PIN, ADC_11db);
    Serial.println("[ADC] 12-bit, 11dB attenuation on pH pins");

    // Init I2C
    Wire.begin(21, 22);

    // Init DHT11
    dht.begin();
    Serial.println("[DHT11] Initialized");

    // Init BH1750
    if (lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE)) {
        bh1750Ok = true;
        Serial.println("[BH1750] OK");
    } else {
        Serial.println("[BH1750] NOT FOUND - skip reading (no hang)");
    }

    // Init INA219
    if (ina219.begin()) {
        ina219Ok = true;
        Serial.println("[INA219] OK");
    } else {
        Serial.println("[INA219] NOT FOUND - skip reading (no hang)");
    }

    // Connect WiFi
    connectWiFi();

    Serial.println("[Setup] Complete! Starting main loop...\n");
}

// ============================================================
//  Loop
// ============================================================

void loop() {
    esp_task_wdt_reset();

    // ต้องอยู่ก่อนทุกทางออกของ loop — รวมถึงกรณี WiFi หลุดที่ return ออกไปก่อนส่งข้อมูล
    checkFailsafe();

    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("[WiFi] Disconnected, reconnecting...");
        connectWiFi();
        delay(1000);
        return;
    }

    unsigned long now = millis();
    if (now - lastSend >= SEND_INTERVAL) {
        lastSend = now;
        sendDataAndReceiveRelays();
    }
}
