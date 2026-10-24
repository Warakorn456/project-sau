// ============================================================
//  ทดสอบ pH sensor ทีละตัว (ไม่มี WiFi / ไม่ส่ง server)
//  Serial Monitor 115200 — พิมพ์คำสั่งแล้วกด Enter
//    1 / 2 = อ่านตัวนั้นต่อเนื่องทุก 1 วิ    a = อ่านทั้ง 2 ตัวครั้งเดียว    s = หยุด
//    7 / 4 = ช่วย calibrate ตัวที่เลือกอยู่ (เลือกด้วย 1/2 ก่อน):
//            จุ่ม buffer pH7 รอค่านิ่ง → พิมพ์ 7 · ล้างโพรบ จุ่ม pH4 รอค่านิ่ง → พิมพ์ 4
//            ครบทั้งคู่แล้วจะพิมพ์ค่า PH_VMID_MV / PH_SLOPE_MV_PER_PH ให้ copy ไปใส่ smart_farm.ino
//
//  ขั้นตอน:
//  1. ถอด VCC ของ relay board ก่อน flash → upload → ต่อกลับ → กดปุ่ม EN
//  2. ทดสอบทีละตัว (1 หรือ 2): โพรบในอากาศค่าจะลอย/เต้น, จุ่มน้ำเปล่าควรนิ่ง ≈ pH 6–8
//  3. แยกว่าเสียที่โพรบหรือที่บอร์ดแอมป์: ถอดโพรบออกแล้วลัดขั้ว BNC (แกนกลางชนขอบนอก)
//     บอร์ดแอมป์ส่วนใหญ่ให้ ≈ 2500 mV (= pH 7) และนิ่ง → แอมป์+สาย+ขา ADC ปกติ เหลือตัวโพรบ
//     ยังเป็น ~0 / ~3100 mV หรือเต้นแรง → เช็คไฟเลี้ยงบอร์ดแอมป์ / สาย PO / GND ร่วม
//  4. จุ่ม buffer pH4 กับ pH7 → mV ควรต่างกันราว 150–180 mV/pH (≈ 3 pH)
//     แทบไม่ขยับ = โพรบเสีย/แห้ง (แช่ในน้ำยาเก็บโพรบหรือ pH4 สักพักแล้วลองใหม่)
//  5. ทดสอบเสร็จ flash smart_farm.ino กลับ
// ============================================================

const int   PH_PINS[2]  = { 34, 39 };   // 39 = ขา VN บนบอร์ด
const char* PH_NAMES[2] = { "pH ลัง1", "pH ลัง2" };

// คัดลอกจาก smart_farm.ino — แก้ที่นั่นแล้วต้องแก้ที่นี่ให้ตรงกัน
const int   PH_SAMPLES         = 20;
const float PH_VMID_MV         = 2500.0f;
const float PH_SLOPE_MV_PER_PH = 180.0f;
const float PH_PLAUSIBLE_MIN   = 3.0f;
const float PH_PLAUSIBLE_MAX   = 11.0f;
const int   PH_NOISE_MAX_MV    = 120;

// ADC 11dB อ่านได้ถึง ~3100 mV — ใกล้ 0 หรือเพดาน = ไม่มีสัญญาณจริง
const float RAIL_LOW_MV  = 50.0f;
const float RAIL_HIGH_MV = 3100.0f;

// relay active LOW — ตั้ง HIGH ไว้ตลอด กันปั๊มเปิดเองระหว่างทดสอบ
const int RELAY_PINS[8] = { 2, 5, 18, 23, 14, 15, 16, 17 };

int   selected = -1;     // -1 = หยุด, 0/1 = ตัวที่อ่านต่อเนื่อง
int   calTarget = 0;     // ตัวที่ใช้กับคำสั่ง 7/4 (ตัวที่เลือกล่าสุด)
float calMv7[2] = { -1, -1 };
float calMv4[2] = { -1, -1 };

struct PhStats { float avg; int minMv, maxMv; };

// วิธีเดียวกับ readPH() ใน smart_farm.ino แต่คืนค่าดิบทั้งหมด ไม่ตัดทิ้ง
PhStats readStats(int pin) {
    long sum = 0;
    int  mn = INT32_MAX, mx = -1;
    for (int i = 0; i < PH_SAMPLES; i++) {
        int mv = analogReadMilliVolts(pin);
        sum += mv;
        if (mv < mn) mn = mv;
        if (mv > mx) mx = mv;
        delay(5);
    }
    return { sum / (float)PH_SAMPLES, mn, mx };
}

void printReading(int i) {
    PhStats s = readStats(PH_PINS[i]);
    int   p2p = s.maxMv - s.minMv;
    float ph  = 7.0f + ((PH_VMID_MV - s.avg) / PH_SLOPE_MV_PER_PH);

    const char* verdict;
    if (s.avg < RAIL_LOW_MV)       verdict = "ติด 0 — เช็คไฟเลี้ยงบอร์ดแอมป์ / สาย PO / GND";
    else if (s.avg > RAIL_HIGH_MV) verdict = "ติดเพดาน — เช็คไฟเลี้ยงบอร์ดแอมป์ (ต้องไม่เกิน 3.3V) / สาย PO";
    else if (p2p > PH_NOISE_MAX_MV) verdict = "เต้นแรง = ขาลอย/สายหลุด (smart_farm.ino จะส่ง null)";
    else if (ph < PH_PLAUSIBLE_MIN || ph > PH_PLAUSIBLE_MAX)
                                   verdict = "นอกกรอบ 3-11 (smart_farm.ino จะส่ง null) — ยังไม่ calibrate?";
    else                           verdict = "OK";

    Serial.printf("[%d] %s GPIO%-2d  avg=%4.0f mV  min=%4d max=%4d (p2p %3d)  pH=%5.2f  %s\n",
        i + 1, PH_NAMES[i], PH_PINS[i], s.avg, s.minMv, s.maxMv, p2p, ph, verdict);
}

// เฉลี่ย ~5 วิ สำหรับ calibrate — คืน -1 ถ้าเต้นแรงเกิน
float captureMv(int i) {
    Serial.printf("  วัด %s ~5 วิ อย่าขยับโพรบ...\n", PH_NAMES[i]);
    float sum = 0; int worstP2p = 0;
    const int N = 40;
    for (int k = 0; k < N; k++) {
        PhStats s = readStats(PH_PINS[i]);   // ~100 ms ต่อครั้ง
        sum += s.avg;
        if (s.maxMv - s.minMv > worstP2p) worstP2p = s.maxMv - s.minMv;
        delay(25);
    }
    float mv = sum / N;
    Serial.printf("  ได้ %.0f mV (p2p สูงสุด %d mV)\n", mv, worstP2p);
    if (worstP2p > PH_NOISE_MAX_MV) {
        Serial.println("  ค่าเต้นแรงเกิน — ไม่บันทึก เช็คสาย/รอโพรบนิ่งแล้วลองใหม่");
        return -1.0f;
    }
    return mv;
}

void printCalibration(int i) {
    if (calMv7[i] < 0 || calMv4[i] < 0) return;
    float slope = (calMv4[i] - calMv7[i]) / 3.0f;
    Serial.printf("\n=== ผล calibrate %s (GPIO%d) ===\n", PH_NAMES[i], PH_PINS[i]);
    Serial.printf("  pH7 = %.0f mV   pH4 = %.0f mV   ต่างกัน %.0f mV\n",
        calMv7[i], calMv4[i], calMv4[i] - calMv7[i]);
    if (slope < 50.0f)
        Serial.println("  ⚠️ slope ต่ำผิดปกติ (หรือกลับทิศ) — โพรบเสีย/แห้ง หรือจุ่มสลับขวด");
    Serial.println("  แทนค่าใน smart_farm.ino:");
    Serial.printf("    const float PH_VMID_MV         = %.1ff;\n", calMv7[i]);
    Serial.printf("    const float PH_SLOPE_MV_PER_PH = %.1ff;\n", slope);
    Serial.println("  (smart_farm.ino ใช้ค่าชุดเดียวทั้ง 2 ตัว — ถ้า 2 ตัวต่างกันมาก ต้องแยกค่าต่อขา)\n");
}

void printMenu() {
    Serial.println("พิมพ์ 1/2 = อ่านตัวนั้นต่อเนื่อง | a = อ่านทั้งคู่ | s = หยุด | 7/4 = calibrate ตัวที่เลือก");
    for (int i = 0; i < 2; i++)
        Serial.printf("  %d = %s (GPIO%d)\n", i + 1, PH_NAMES[i], PH_PINS[i]);
}

void setup() {
    for (int r = 0; r < 8; r++) {
        pinMode(RELAY_PINS[r], OUTPUT);
        digitalWrite(RELAY_PINS[r], HIGH);
    }
    Serial.begin(115200);
    analogReadResolution(12);
    for (int i = 0; i < 2; i++) analogSetPinAttenuation(PH_PINS[i], ADC_11db);

    delay(500);
    Serial.println("\n=== pH sensor test ===");
    printMenu();
}

void loop() {
    while (Serial.available()) {
        char c = Serial.read();
        if (c == '1' || c == '2') {
            selected = calTarget = c - '1';
            Serial.printf("\n--- อ่านต่อเนื่อง: %s (GPIO%d) ---\n", PH_NAMES[selected], PH_PINS[selected]);
        } else if (c == 'a' || c == 'A') {
            selected = -1;
            Serial.println("\n--- ทั้ง 2 ตัว ---");
            for (int i = 0; i < 2; i++) printReading(i);
        } else if (c == 's' || c == 'S') {
            selected = -1;
            Serial.println("--- หยุด ---");
        } else if (c == '7' || c == '4') {
            selected = -1;
            Serial.printf("\n--- calibrate %s: buffer pH%c ---\n", PH_NAMES[calTarget], c);
            float mv = captureMv(calTarget);
            if (mv >= 0) {
                if (c == '7') calMv7[calTarget] = mv; else calMv4[calTarget] = mv;
                if (calMv7[calTarget] < 0 || calMv4[calTarget] < 0)
                    Serial.printf("  ต่อไป: จุ่ม buffer pH%c แล้วพิมพ์ %c\n", c == '7' ? '4' : '7', c == '7' ? '4' : '7');
                printCalibration(calTarget);
            }
        }
    }

    if (selected >= 0) {
        printReading(selected);
        delay(1000);
    }
}
