// ============================================================
//  ทดสอบเซ็นเซอร์ระดับน้ำ SR04M-2 ทีละตัว (ไม่มี WiFi / ไม่ส่ง server)
//  Serial Monitor 115200 — พิมพ์คำสั่งแล้วกด Enter
//    0-5 = วัดเซ็นเซอร์ตัวนั้นต่อเนื่อง    a = ไล่ทีละตัว 0→5 แล้วหยุด    s = หยุด
//    w   = หาว่าตัวไหนต่อขาไหน: โชว์ทั้ง 6 ตัวบรรทัดเดียวต่อรอบ
//          ยกเซ็นเซอร์ขึ้นจากถังทีละตัว หันไปทางเพดาน/พื้นไกลๆ → คอลัมน์ที่ค่ากระโดดคือตัวนั้น
//
//  ขั้นตอน:
//  1. ถอด VCC ของ relay board ก่อน flash → upload → ต่อกลับ → กดปุ่ม EN
//  2. ต่อละตัว: ถือเซ็นเซอร์หันลงพื้นเรียบ วัดด้วยตลับเมตรที่ 250 / 300 / 400 mm
//     median ควรต่างจากตลับเมตรไม่เกิน ±10 mm — ใกล้กว่า ~200 mm อ่านไม่ได้ (ระยะบอด)
//  3. ในถังจริง: ถังว่าง ระยะควร ≈ ความลึกถัง + SENSOR_GAP_MM
//     ถังใหญ่ได้ ~205–215 mm = คลื่นสะท้อนหัวปั๊ม ไม่ใช่ก้นถัง
//  4. ทดสอบเสร็จ flash smart_farm.ino กลับ
//
//  ⚠️ TRIG ต่อร่วมกันทุกตัว — ยิงครั้งเดียวทั้ง 6 ตัวส่งคลื่นพร้อมกัน sketch นี้แค่อ่าน echo ตัวเดียว
//     ถ้าสงสัยคลื่นข้ามถัง (crosstalk) ให้ถอดสาย VCC ของเซ็นเซอร์ตัวอื่นออกระหว่างทดสอบ
// ============================================================

#define SR04_TX_PIN 25
const int SR04_RX_PINS[6] = { 26, 27, 32, 33, 35, 36 };
const char* TANK_NAMES[6] = {
    "ถังรองรับน้ำลัง2", "ถังสาร pH Down", "ถังน้ำเปล่า",
    "ลังปลูกผัก1", "ถังรองรับน้ำลัง1", "ลังปลูกผัก2"
};

// คัดลอกจาก smart_farm.ino — แก้ที่นั่นแล้วต้องแก้ที่นี่ให้ตรงกัน
const float TANK_DEPTH_MM[6] = { 300, 300, 300, 150, 300, 150 };
const float SENSOR_GAP_MM[6] = { 0, 0, 0, 0, 0, 0 };

// relay active LOW — ตั้ง HIGH ไว้ตลอด กันปั๊มเปิดเองระหว่างทดสอบ
const int RELAY_PINS[8] = { 2, 5, 18, 23, 14, 15, 16, 17 };

const int   SAMPLES       = 10;
const float BLIND_ZONE_MM = 220.0f;

int  selected = -1;   // -1 = หยุด
bool scanAll  = false;
bool watchAll = false;

// ยิง trigger แล้วจับ echo เฉพาะขาของเซ็นเซอร์ i → ระยะ mm, -1 = ไม่ตอบ
float readOnceMm(int i) {
    digitalWrite(SR04_TX_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(SR04_TX_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(SR04_TX_PIN, LOW);
    unsigned long us = pulseIn(SR04_RX_PINS[i], HIGH, 30000UL);
    if (us == 0) return -1.0f;
    return us / 5.8f;   // µs / 58 = cm → ×10 = mm
}

// ยิง trigger 1 ครั้ง แล้วจับ echo ทั้ง 6 ขาพร้อมกัน (วิธีเดียวกับ triggerAndReadAll ใน smart_farm.ino)
void readAllOnceMm(float mm[6]) {
    bool started[6] = { false }, done[6] = { false };
    uint32_t riseT[6];
    digitalWrite(SR04_TX_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(SR04_TX_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(SR04_TX_PIN, LOW);
    uint32_t t0 = micros();
    int remaining = 6;
    while (remaining > 0 && (uint32_t)(micros() - t0) < 30000UL) {
        for (int i = 0; i < 6; i++) {
            if (done[i]) continue;
            int v = digitalRead(SR04_RX_PINS[i]);
            if (!started[i]) {
                if (v == HIGH) { started[i] = true; riseT[i] = micros(); }
            } else if (v == LOW) {
                mm[i] = (micros() - riseT[i]) / 5.8f;
                done[i] = true;
                remaining--;
            }
        }
    }
    for (int i = 0; i < 6; i++)
        if (!done[i]) mm[i] = -1.0f;
}

// 1 บรรทัดต่อรอบ — ค่าล่าสุดที่อ่านได้ของแต่ละตัว ("----" = ยังไม่เคยตอบ, "*" = รอบนี้ไม่ตอบ ใช้ค่าเดิม)
void watchLine() {
    static float last[6] = { -1, -1, -1, -1, -1, -1 };
    bool fresh[6] = { false };
    for (int r = 0; r < 5; r++) {   // 5 trigger ต่อบรรทัด เพราะแต่ละตัวตอบไม่ทุกครั้ง
        float mm[6];
        readAllOnceMm(mm);
        for (int i = 0; i < 6; i++)
            if (mm[i] >= 0.0f) { last[i] = mm[i]; fresh[i] = true; }
        delay(100);
    }
    for (int i = 0; i < 6; i++) {
        if (last[i] < 0.0f) Serial.printf("  %d:----  ", i);
        else Serial.printf("  %d:%4.0f%c ", i, last[i], fresh[i] ? ' ' : '*');
    }
    Serial.println();
}

void measureSensor(int i) {
    float v[SAMPLES];
    int n = 0, miss = 0;
    for (int s = 0; s < SAMPLES; s++) {
        float mm = readOnceMm(i);
        if (mm < 0.0f) miss++; else v[n++] = mm;
        delay(60);   // รอบ measurement ของโมดูล
    }

    Serial.printf("[%d] %-18s GPIO%-2d  ", i, TANK_NAMES[i], SR04_RX_PINS[i]);
    if (n == 0) {
        Serial.printf("ไม่ตอบเลย (%d/%d) — เช็คสาย ECHO/VCC/GND\n", miss, SAMPLES);
        return;
    }

    // insertion sort หา min/median/max
    for (int a = 1; a < n; a++) {
        float t = v[a]; int b = a - 1;
        while (b >= 0 && v[b] > t) { v[b + 1] = v[b]; b--; }
        v[b + 1] = t;
    }
    float med = (n % 2) ? v[n / 2] : (v[n / 2 - 1] + v[n / 2]) / 2.0f;

    // สูตรเดียวกับ distanceToMm() ใน smart_farm.ino
    float mount = TANK_DEPTH_MM[i] + SENSOR_GAP_MM[i];
    float level = constrain(mount - med, 0.0f, TANK_DEPTH_MM[i]);

    Serial.printf("ระยะ min=%.0f  median=%.0f  max=%.0f mm  (เต้น %.0f)  ไม่ตอบ %d/%d  → ระดับน้ำ %.0f/%.0f mm%s%s\n",
        v[0], med, v[n - 1], v[n - 1] - v[0], miss, SAMPLES, level, TANK_DEPTH_MM[i],
        med < BLIND_ZONE_MM ? "  (ระยะบอด?)" : "",
        med > mount + 100.0f ? "  (เกินก้นถัง — smart_farm.ino จะทิ้งค่านี้)" : "");
}

void setup() {
    for (int r = 0; r < 8; r++) {
        pinMode(RELAY_PINS[r], OUTPUT);
        digitalWrite(RELAY_PINS[r], HIGH);
    }
    Serial.begin(115200);
    pinMode(SR04_TX_PIN, OUTPUT);
    digitalWrite(SR04_TX_PIN, LOW);
    for (int i = 0; i < 6; i++) pinMode(SR04_RX_PINS[i], INPUT);

    delay(500);
    Serial.println("\n=== SR04M-2 test ===");
    Serial.println("พิมพ์ 0-5 = วัดตัวนั้นต่อเนื่อง | a = ไล่ทุกตัว | s = หยุด");
    for (int i = 0; i < 6; i++)
        Serial.printf("  %d = %s (GPIO%d)\n", i, TANK_NAMES[i], SR04_RX_PINS[i]);
}

void loop() {
    while (Serial.available()) {
        char c = Serial.read();
        if (c >= '0' && c <= '5') {
            selected = c - '0'; scanAll = false; watchAll = false;
            Serial.printf("\n--- วัดต่อเนื่อง: [%d] %s ---\n", selected, TANK_NAMES[selected]);
        } else if (c == 'a' || c == 'A') {
            selected = -1; scanAll = true; watchAll = false;
        } else if (c == 'w' || c == 'W') {
            selected = -1; scanAll = false; watchAll = true;
            Serial.println("\n--- ทั้ง 6 ตัว (mm) — ยกเซ็นเซอร์ทีละตัวแล้วดูว่าคอลัมน์ไหนเปลี่ยน ---");
            for (int i = 0; i < 6; i++)
                Serial.printf("  %d = GPIO%d (โค้ดตั้งเป็น %s)\n", i, SR04_RX_PINS[i], TANK_NAMES[i]);
        } else if (c == 's' || c == 'S') {
            selected = -1; scanAll = false; watchAll = false;
            Serial.println("--- หยุด ---");
        }
    }

    if (watchAll) {
        watchLine();
    } else if (scanAll) {
        Serial.println("\n--- ไล่ทีละตัว ---");
        for (int i = 0; i < 6; i++) measureSensor(i);
        scanAll = false;
    } else if (selected >= 0) {
        measureSensor(selected);
        delay(500);
    }
}
