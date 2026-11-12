// ============================================================
//  Smart Farm ESP32 - ระบบปลูกผักไฮโดรโปนิกส์อัตโนมัติ
// ============================================================
//
//  Library ที่ต้องติดตั้ง (Library Manager ใน Arduino IDE)
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
//  ค่าที่ต้องตั้งก่อนใช้งาน
// ============================================================

// WiFi
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

// ที่อยู่ของ Server
const char* SERVER_URL = "https://project-sau.onrender.com";

// รหัสยืนยันตัวอุปกรณ์ ส่งไปใน header X-Device-Key ต้องตรงกับค่าบน Server
const char* DEVICE_KEY = "YOUR_DEVICE_KEY";

// ลำดับถัง: [0]=ถังรองรับน้ำลัง2 [1]=ถังสาร pH Down [2]=ถังน้ำเปล่า
//          [3]=ลังปลูกผัก1 [4]=ถังรองรับน้ำลัง1 [5]=ลังปลูกผัก2
// ความสูงน้ำตอนเต็ม วัดจากก้นถัง (mm)
const float TANK_DEPTH_MM[6] = { 230, 230, 230, 200, 230, 200 };
// ระยะจากหน้าเซ็นเซอร์ถึงผิวน้ำตอนเต็ม (mm)
const float SENSOR_GAP_MM[6] = { 120, 120, 120, 50, 120, 50 };
// ระยะบอดของเซ็นเซอร์ (mm) ถ้าวัดได้ใกล้กว่านี้ถือว่าค่าเชื่อถือไม่ได้
const float BLIND_MM = 240.0f;

// Relay แบบ Active LOW (LOW = เปิด, HIGH = ปิด)
#define RELAY_ACTIVE_LOW true

// ============================================================
//  การกำหนดขา (Pins)
// ============================================================

#define DHT_PIN     4
#define PH1_PIN     34    // pH ลัง1
#define PH2_PIN     39    // pH ลัง2 (ขา VN)
#define SR04_TX_PIN  25                              // ขา TRIG ใช้ร่วมกันทุกตัว
const int SR04_RX_PINS[6] = { 26, 27, 32, 36, 35, 33 };  // ขา ECHO ของแต่ละถัง
// ลังปลูก (index 3 และ 5) ใช้สวิตช์ลูกลอยแทน จึงไม่ได้ต่อเซ็นเซอร์อัลตราโซนิก
const bool SR04_PRESENT[6] = { true, true, true, false, true, false };

// สวิตช์ลูกลอยในลังปลูก [0]=ลัง1 GPIO19, [1]=ลัง2 GPIO13
// ต่อขาหนึ่งเข้า GPIO อีกขาลง GND และใช้ pull-up ภายในชิป
const int FLOAT_PINS[2] = { 19, 13 };
#define FLOAT_FULL_LEVEL HIGH   // ระดับขาเมื่อลูกลอยยกขึ้น (น้ำเต็ม)

// Relay 8 ตัว
// R1=GPIO2  ปั๊มเติมน้ำลัง1         R2=GPIO5  ปั๊มเติมน้ำลัง2
// R3=GPIO18 ปั๊มสาร pH ลัง1        R4=GPIO23 ปั๊มสาร pH ลัง2
// R5=GPIO15 ถังรองรับน้ำ1 ไป ลัง1   R6=GPIO14 ลัง1 ไป ถังรองรับน้ำ1
// R7=GPIO16 ถังรองรับน้ำ2 ไป ลัง2   R8=GPIO17 ลัง2 ไป ถังรองรับน้ำ2
#define RELAY_COUNT 8
const int RELAY_PINS[RELAY_COUNT] = { 2, 5, 18, 23, 15, 14, 16, 17 };

// ============================================================
//  ตัวแปรระบบ
// ============================================================

DHT           dht(DHT_PIN, DHT11);
BH1750        lightMeter;
Adafruit_INA219 ina219;

// สถานะว่าพบเซ็นเซอร์ I2C ตอนเริ่มระบบหรือไม่
bool bh1750Ok = false;
bool ina219Ok = false;
WiFiClientSecure sslClient;
// ใช้ HTTPClient ตัวเดียวตลอด เพื่อใช้การเชื่อมต่อเดิมซ้ำได้
HTTPClient    http;

bool    relayStates[RELAY_COUNT] = { false };
unsigned long lastSend   = 0;
const unsigned long SEND_INTERVAL = 2000; // ส่งข้อมูลทุก 2 วินาที

// Failsafe: ถ้าไม่ได้รับคำตอบจาก Server เกินเวลานี้ ให้ปิด Relay ทุกตัว
// ป้องกันปั๊มเปิดค้างเมื่อ WiFi หลุดหรือ Server ไม่ตอบ
const unsigned long FAILSAFE_MS = 30000;
unsigned long lastServerOk = 0;

// จำนวนครั้งที่ส่งข้อมูลไม่สำเร็จติดกัน ก่อนเชื่อมต่อ WiFi ใหม่ / รีบูตบอร์ด
const int HTTP_FAIL_RECONNECT = 10;
const int HTTP_FAIL_REBOOT    = 30;
int httpFailStreak = 0;

// Watchdog: ถ้าโปรแกรมค้างเกินเวลานี้ บอร์ดจะรีบูตตัวเอง
const uint32_t WDT_TIMEOUT_SEC = 30;

// เวลาที่ยอมใช้ค่าระดับน้ำล่าสุดแทนได้ เมื่อเซ็นเซอร์อ่านค่าไม่ได้
const unsigned long WL_HOLD_MS = 60000;

// ---- ค่าสำหรับเซ็นเซอร์ pH ----
const int   PH_SAMPLES         = 20;
// ค่าจากการสอบเทียบ [0]=ลัง1, [1]=ลัง2
const float PH_VMID_MV[2]         = { 1513.0f, 1205.0f }; // แรงดันที่ pH 7 (mV)
const float PH_SLOPE_MV_PER_PH[2] = {  155.0f,  153.0f }; // แรงดันที่เปลี่ยนต่อ 1 pH (mV)

// ช่วงค่า pH ที่ยอมรับ ถ้าอยู่นอกช่วงจะส่งเป็น null
const float PH_PLAUSIBLE_MIN   = 3.0f;
const float PH_PLAUSIBLE_MAX   = 11.0f;

// ค่าการกระจายของสัญญาณสูงสุดที่ยอมรับ (mV) ใช้ตรวจว่าสายหลุดหรือไม่
const int   PH_NOISE_MAX_MV    = 120;

// ============================================================
//  ฟังก์ชัน: สั่งเปิด/ปิด Relay
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
//  ฟังก์ชัน: วัดระยะด้วยเซ็นเซอร์อัลตราโซนิก (Trigger/Echo)
//  ส่ง trigger ครั้งเดียว แล้วรับ echo ของทุกตัวพร้อมกัน
//  ระยะ (cm) = เวลา echo (us) / 58
// ============================================================

// ส่ง trigger 1 ครั้ง แล้วอ่าน echo ทั้ง 6 ขา
static void triggerAndReadAll(float distCm[6]) {
    bool  started[6] = { false }, done[6] = { false };
    uint32_t riseT[6];
    int remaining = 0;
    for (int i = 0; i < 6; i++) {
        if (SR04_PRESENT[i]) remaining++;
        else { done[i] = true; distCm[i] = -1.0f; }
    }

    // ส่งพัลส์ trigger 10 us
    digitalWrite(SR04_TX_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(SR04_TX_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(SR04_TX_PIN, LOW);

    // รอรับ echo ทุกขา สูงสุด 30 ms
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
    // ขาที่ไม่ได้รับ echo ให้เป็น -1
    for (int i = 0; i < 6; i++)
        if (!done[i]) distCm[i] = -1.0f;
}

// วัด 1 รอบ ถ้าเซ็นเซอร์ตัวใดยังไม่ได้ค่าให้ลองใหม่ สูงสุด 5 ครั้ง
static void measureOnce(float distCm[6]) {
    for (int i = 0; i < 6; i++) distCm[i] = -1.0f;

    for (int attempt = 0; attempt < 5; attempt++) {
        float tmp[6];
        triggerAndReadAll(tmp);
        bool allDone = true;
        for (int i = 0; i < 6; i++) {
            if (distCm[i] < 0.0f && tmp[i] > 0.0f) distCm[i] = tmp[i];
            if (SR04_PRESENT[i] && distCm[i] < 0.0f) allDone = false;
        }
        if (allDone) break;
        delay(60);
    }
}

// หาค่ามัธยฐานจาก 3 ค่า โดยไม่นับค่าที่ติดลบ
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

// วัด 3 รอบแล้วใช้ค่ามัธยฐาน เพื่อลดค่าผิดพลาดชั่วขณะ
void measureAllDistances(float distCm[6]) {
    float sample[3][6];
    for (int s = 0; s < 3; s++) {
        measureOnce(sample[s]);
        if (s < 2) delay(60);
    }
    for (int i = 0; i < 6; i++) {
        distCm[i] = medianValid(sample[0][i], sample[1][i], sample[2][i]);
    }
}

// แปลงระยะที่วัดได้เป็นความสูงน้ำจากก้นถัง (mm)
// คืนค่า -1 เมื่อเซ็นเซอร์อ่านไม่ได้ และ -2 เมื่อผิวน้ำอยู่ในระยะบอด
float distanceToMm(float distCm, int i) {
    if (distCm < 0.0f) return -1.0f;
    float mount  = TANK_DEPTH_MM[i] + SENSOR_GAP_MM[i]; // ระยะจากเซ็นเซอร์ถึงก้นถัง
    float distMm = distCm * 10.0f;
    if (mount <= BLIND_MM || distMm < BLIND_MM) return -2.0f;
    // ระยะเกินก้นถังมาก ถือว่าเป็นค่าผิด
    if (distMm > mount + 100.0f) return -1.0f;
    return constrain(mount - distMm, 0.0f, TANK_DEPTH_MM[i]);
}

// อ่านสถานะหน้าสัมผัสลูกลอย (1 = ต่อ, 0 = ตัด)
// อ่าน 5 ครั้งแล้วใช้เสียงข้างมาก เพื่อกันหน้าสัมผัสเด้ง
int readFloatClosed(int i) {
    int closed = 0;
    for (int k = 0; k < 5; k++) {
        if (digitalRead(FLOAT_PINS[i]) == LOW) closed++;
        delay(2);
    }
    return closed >= 3 ? 1 : 0;
}

// แปลงสถานะหน้าสัมผัสเป็นสถานะน้ำเต็ม (1 = เต็ม)
int floatToFull(int closed) {
    return (FLOAT_FULL_LEVEL == LOW) ? closed : !closed;
}

// ============================================================
//  ฟังก์ชัน: อ่านค่า pH
//  ต้องสอบเทียบด้วยสารละลายบัฟเฟอร์ก่อนใช้งาน
// ============================================================

float readPH(int pin, int probe) {
    // อ่านแรงดันเป็น mV ด้วย analogReadMilliVolts() ซึ่งชดเชยความคลาดเคลื่อนของ ADC ให้
    int v[PH_SAMPLES];
    for (int i = 0; i < PH_SAMPLES; i++) {
        v[i] = analogReadMilliVolts(pin);
        delay(5);
    }
    // เรียงข้อมูล แล้วใช้ค่ามัธยฐานแทนค่าเฉลี่ย เพื่อตัดค่าที่กระโดดผิดปกติ
    for (int a = 1; a < PH_SAMPLES; a++) {
        int t = v[a], b = a - 1;
        while (b >= 0 && v[b] > t) { v[b + 1] = v[b]; b--; }
        v[b + 1] = t;
    }
    float medMv = (v[PH_SAMPLES / 2 - 1] + v[PH_SAMPLES / 2]) / 2.0f;
    int   iqr   = v[PH_SAMPLES * 3 / 4] - v[PH_SAMPLES / 4];

    // ค่ากระจายมากเกินไป แสดงว่าสายหลุดหรือขาลอย
    if (iqr > PH_NOISE_MAX_MV) {
        Serial.printf("[pH-DBG] pin=%d  med=%.0f mV  iqr=%d mV  ERROR (ขาลอย/สายหลุด)\n",
            pin, medMv, iqr);
        return -1.0f;
    }

    float ph = 7.0f + ((PH_VMID_MV[probe] - medMv) / PH_SLOPE_MV_PER_PH[probe]);

    // ค่าอยู่นอกช่วงที่เป็นไปได้ ให้ถือว่าอ่านไม่ได้
    if (ph < PH_PLAUSIBLE_MIN || ph > PH_PLAUSIBLE_MAX) {
        Serial.printf("[pH-DBG] pin=%d  med=%.0f mV  iqr=%d mV  pH=%.2f  ERROR (นอกกรอบ %.1f-%.1f)\n",
            pin, medMv, iqr, ph, PH_PLAUSIBLE_MIN, PH_PLAUSIBLE_MAX);
        return -1.0f;
    }

    Serial.printf("[pH-DBG] pin=%d  med=%.0f mV  iqr=%d mV  pH=%.2f\n", pin, medMv, iqr, ph);
    return ph;
}

// ============================================================
//  ฟังก์ชัน: Failsafe และการเชื่อมต่อ WiFi
// ============================================================

// ปิด Relay ทุกตัวเมื่อไม่ได้รับคำตอบจาก Server นานเกิน FAILSAFE_MS
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

    // ล้างการเชื่อมต่อเดิมก่อนเริ่มเชื่อมต่อใหม่
    WiFi.disconnect(true);
    delay(200);

    Serial.print("[WiFi] Connecting to ");
    Serial.println(WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);

    int attempt = 0;
    while (WiFi.status() != WL_CONNECTED && attempt < 40) {
        // ระหว่างรอเชื่อมต่อ ต้องรีเซ็ต Watchdog และตรวจ Failsafe ด้วย
        esp_task_wdt_reset();
        checkFailsafe();
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
//  ฟังก์ชัน: ส่งข้อมูลเซ็นเซอร์และรับคำสั่ง Relay
// ============================================================

void sendDataAndReceiveRelays() {
    if (WiFi.status() != WL_CONNECTED) {
        connectWiFi();
        return;
    }

    // --- อ่านค่าเซ็นเซอร์ (อ่านไม่ได้ = NAN และส่งเป็น null) ---
    float temperature = dht.readTemperature();
    float humidity    = dht.readHumidity();

    // อ่านเซ็นเซอร์ I2C เฉพาะตัวที่พบตอนเริ่มระบบ
    float light      = bh1750Ok ? lightMeter.readLightLevel() : NAN;
    if (light < 0) light = NAN;
    float busVoltage = ina219Ok ? ina219.getBusVoltage_V()     : NAN;
    float currentA   = ina219Ok ? ina219.getCurrent_mA() / 1000.0f : NAN;
    float powerW     = ina219Ok ? ina219.getPower_mW()   / 1000.0f : NAN;
    float phValue1   = readPH(PH1_PIN, 0);
    float phValue2   = readPH(PH2_PIN, 1);

    // ระดับน้ำ ถ้ารอบนี้อ่านไม่ได้ ให้ใช้ค่าล่าสุดแทนภายในเวลา WL_HOLD_MS
    static float         lastWl[6]     = { -1, -1, -1, -1, -1, -1 };
    static unsigned long lastWlTime[6] = { 0, 0, 0, 0, 0, 0 };
    float dist[6], wl[6];
    unsigned long nowMs = millis();
    measureAllDistances(dist);
    for (int i = 0; i < 6; i++) {
        float lv = distanceToMm(dist[i], i);
        if (lv >= 0.0f || lv == -2.0f) { lastWl[i] = lv; lastWlTime[i] = nowMs; }

        bool fresh = (lastWlTime[i] != 0) && (nowMs - lastWlTime[i] <= WL_HOLD_MS);
        wl[i] = fresh ? lastWl[i] : -1.0f;

        if (!SR04_PRESENT[i]) continue;
        Serial.printf("[SR04] sensor[%d] dist=%.1f cm  now=%.0f mm  send=%.0f mm%s\n",
            i, dist[i], lv, wl[i], (lv == -1.0f && fresh) ? "  (ค่าค้าง)" : "");
    }

    // สถานะลูกลอยของลังปลูก
    int floatOn[2]   = { readFloatClosed(0), readFloatClosed(1) };
    int trayFloat[2] = { floatToFull(floatOn[0]), floatToFull(floatOn[1]) };
    Serial.printf("[FLOAT] ลัง1=%s (%s)  ลัง2=%s (%s)\n",
        trayFloat[0] ? "เต็ม" : "ยังไม่เต็ม", floatOn[0] ? "ON" : "OFF",
        trayFloat[1] ? "เต็ม" : "ยังไม่เต็ม", floatOn[1] ? "ON" : "OFF");

    // --- สร้างข้อมูล JSON ---
    StaticJsonDocument<768> doc;
    if (isnan(temperature)) doc["temperature"] = nullptr; else doc["temperature"] = round(temperature * 10) / 10.0;
    if (isnan(humidity))    doc["humidity"]    = nullptr; else doc["humidity"]    = round(humidity    * 10) / 10.0;
    if (isnan(light))       doc["light"]       = nullptr; else doc["light"]       = round(light);
    if (phValue1 < 0) doc["ph"]  = nullptr; else doc["ph"]  = round(phValue1 * 10) / 10.0;
    if (phValue2 < 0) doc["ph2"] = nullptr; else doc["ph2"] = round(phValue2 * 10) / 10.0;
    if (isnan(busVoltage))  doc["voltage"]     = nullptr; else doc["voltage"]     = round(busVoltage  * 100) / 100.0;
    if (isnan(currentA))    doc["current"]     = nullptr; else doc["current"]     = round(currentA    * 1000) / 1000.0;
    if (isnan(powerW))      doc["power"]       = nullptr; else doc["power"]       = round(powerW      * 100) / 100.0;

    // ระดับน้ำ (mm)
    JsonArray waterLevel = doc.createNestedArray("waterLevel");
    for (int i = 0; i < 6; i++) {
        waterLevel.add((int)round(wl[i]));
    }
    doc["wlUnit"] = "mm";

    // ระยะที่เซ็นเซอร์วัดได้จริง (mm)
    JsonArray wlRaw = doc.createNestedArray("wlRaw");
    for (int i = 0; i < 6; i++) {
        wlRaw.add(dist[i] < 0.0f ? -1 : (int)round(dist[i] * 10.0f));
    }

    // สถานะน้ำในลังปลูก (1 = เต็ม, 0 = ยังไม่เต็ม)
    JsonArray tf = doc.createNestedArray("trayFloat");
    tf.add(trayFloat[0]);
    tf.add(trayFloat[1]);

    // สถานะหน้าสัมผัสลูกลอย (1 = ต่อ, 0 = ตัด)
    JsonArray fo = doc.createNestedArray("floatOn");
    fo.add(floatOn[0]);
    fo.add(floatOn[1]);

    String body;
    serializeJson(doc, body);

    Serial.println("[HTTP] Sending: " + body);

    // --- ส่งข้อมูลด้วย HTTP POST ---
    sslClient.setInsecure(); // ไม่ตรวจสอบใบรับรอง SSL
    // กำหนดเวลารอแต่ละขั้นตอน รวมกันต้องน้อยกว่าเวลาของ Watchdog
    sslClient.setHandshakeTimeout(8);   // วินาที

    if (!http.begin(sslClient, String(SERVER_URL) + "/api/data")) {
        Serial.println("[HTTP] Cannot connect to server");
        return;
    }

    http.setReuse(true);
    http.setConnectTimeout(6000);
    http.setTimeout(8000);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Device-Key", DEVICE_KEY);

    esp_task_wdt_reset();
    int httpCode = http.POST(body);

    if (httpCode == HTTP_CODE_OK) {
        String response = http.getString();
        Serial.println("[HTTP] Response: " + response);

        // อ่านคำสั่ง Relay จากคำตอบของ Server
        StaticJsonDocument<256> respDoc;
        DeserializationError err = deserializeJson(respDoc, response);
        if (!err) {
            JsonArray relays = respDoc["relays"].as<JsonArray>();
            if (relays.size() == RELAY_COUNT) {
                lastServerOk = millis();
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
        Serial.println("[HTTP] 401: DEVICE_KEY ไม่ตรงกับบน server");
    } else {
        Serial.printf("[HTTP] Error: %d  RSSI=%d dBm  heap=%u  fail=%d\n",
            httpCode, WiFi.RSSI(), ESP.getFreeHeap(), httpFailStreak + 1);
    }

    http.end();
    // ส่งไม่สำเร็จ ให้ปิดการเชื่อมต่อเดิม แล้วเชื่อมต่อใหม่ในรอบถัดไป
    if (httpCode != HTTP_CODE_OK) sslClient.stop();

    if (httpCode == HTTP_CODE_OK) {
        httpFailStreak = 0;
        return;
    }
    // ส่งไม่สำเร็จติดกันหลายครั้ง: เชื่อมต่อ WiFi ใหม่ หรือรีบูตบอร์ด
    httpFailStreak++;
    if (httpFailStreak >= HTTP_FAIL_REBOOT) {
        Serial.printf("[Recover] ส่งไม่ผ่าน %d ครั้งติด -> รีบูต\n", httpFailStreak);
        for (int i = 0; i < RELAY_COUNT; i++) setRelay(i, false);
        delay(200);
        ESP.restart();
    } else if (httpFailStreak % HTTP_FAIL_RECONNECT == 0) {
        Serial.printf("[Recover] ส่งไม่ผ่าน %d ครั้งติด -> ต่อ WiFi ใหม่\n", httpFailStreak);
        WiFi.disconnect(true);
    }
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

    // ตั้งค่า Watchdog
    esp_task_wdt_config_t wdtConfig = {
        .timeout_ms = WDT_TIMEOUT_SEC * 1000,
        .idle_core_mask = 0,
        .trigger_panic = true
    };
    esp_task_wdt_reconfigure(&wdtConfig);
    esp_task_wdt_add(NULL);

    // ตั้งค่า Relay และปิดทุกตัว
    for (int i = 0; i < RELAY_COUNT; i++) {
        pinMode(RELAY_PINS[i], OUTPUT);
        setRelay(i, false);
    }
    Serial.println("[Relay] Initialized (all OFF)");

    // ตั้งค่าเซ็นเซอร์อัลตราโซนิก JSN-SR04T
    pinMode(SR04_TX_PIN, OUTPUT);
    digitalWrite(SR04_TX_PIN, LOW);
    for (int i = 0; i < 6; i++) pinMode(SR04_RX_PINS[i], INPUT);
    Serial.println("[JSN-SR04T] Trigger/Echo mode, TRIG=GPIO25, 4 sensors ready (ลังปลูกใช้ลูกลอย)");

    // ตั้งค่าสวิตช์ลูกลอย
    for (int i = 0; i < 2; i++) pinMode(FLOAT_PINS[i], INPUT_PULLUP);
    Serial.println("[FLOAT] ลัง1=GPIO19 ลัง2=GPIO13 (INPUT_PULLUP)");

    // ตั้งค่า ADC สำหรับเซ็นเซอร์ pH
    analogReadResolution(12);
    analogSetPinAttenuation(PH1_PIN, ADC_11db);   // วัดได้ประมาณ 0-3.1 V
    analogSetPinAttenuation(PH2_PIN, ADC_11db);
    Serial.println("[ADC] 12-bit, 11dB attenuation on pH pins");

    // เริ่มใช้งาน I2C (SDA=21, SCL=22)
    Wire.begin(21, 22);

    // DHT11
    dht.begin();
    Serial.println("[DHT11] Initialized");

    // BH1750
    if (lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE)) {
        bh1750Ok = true;
        Serial.println("[BH1750] OK");
    } else {
        Serial.println("[BH1750] NOT FOUND - skip reading (no hang)");
    }

    // INA219
    if (ina219.begin()) {
        ina219Ok = true;
        Serial.println("[INA219] OK");
    } else {
        Serial.println("[INA219] NOT FOUND - skip reading (no hang)");
    }

    // เชื่อมต่อ WiFi
    connectWiFi();

    Serial.println("[Setup] Complete! Starting main loop...\n");
}

// ============================================================
//  Loop
// ============================================================

void loop() {
    esp_task_wdt_reset();

    // ตรวจ Failsafe ทุกรอบ
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
