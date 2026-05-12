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
#include <DHT.h>
#include <BH1750.h>
#include <Adafruit_INA219.h>
#include <Wire.h>
#include <ArduinoJson.h>

// ============================================================
//  *** แก้ไขค่าตรงนี้ ***
// ============================================================

// WiFi
const char* WIFI_SSID = "NTC_Front_FL1";
const char* WIFI_PASS = "condo2567";

// URL ของ Server (ได้จาก Railway หลัง Deploy)
// ตัวอย่าง: "https://smart-farm-production.up.railway.app"
const char* SERVER_URL = "https://3534-2001-44c8-6311-6dc1-687f-74c-d46e-a1e9.ngrok-free.app";

// ความสูงถังแต่ละถัง (หน่วย: ซม.) - วัดจากตำแหน่งเซ็นเซอร์ถึงก้นถัง
// [0]=ถังสารA [1]=ถังสารB [2]=ถังน้ำเติม [3]=ลังปลูกผัก1
// [4]=ถังน้ำวนลัง1 [5]=ลังปลูกผัก2 [6]=ถังน้ำวนลัง2
const float TANK_HEIGHT[7] = { 50.0, 50.0, 50.0, 50.0, 50.0, 50.0, 50.0 };

// Relay: Active LOW (HIGH = ปิด, LOW = เปิด)
// ถ้า Relay module เป็น Active HIGH ให้สลับ LOW/HIGH ในฟังก์ชัน setRelay()
#define RELAY_ACTIVE_LOW true

// ============================================================
//  การกำหนดขา (Pins) - ไม่ต้องแก้ไขถ้าต่อตามผัง
// ============================================================

#define DHT_PIN     4
#define PH1_PIN     34    // pH ลัง1 — ADC1 (ทำงานได้ดีกับ WiFi)
#define PH2_PIN     13    // pH ลัง2 — ADC2 (ถ้าค่าไม่นิ่งให้ใช้ ADS1115 แทน)
#define JSN_TRIG    25    // Trigger ร่วมกันทั้ง 7 ตัว
#define JSN_ECHO1   26    // ถังสารA
#define JSN_ECHO2   27    // ถังสารB
#define JSN_ECHO3   32    // ถังน้ำเติม
#define JSN_ECHO4   33    // ลังปลูกผัก1
#define JSN_ECHO5   35    // ถังน้ำวนลัง1
#define JSN_ECHO6   36    // ลังปลูกผัก2
#define JSN_ECHO7   39    // ถังน้ำวนลัง2

const int RELAY_PINS[10] = { 2, 5, 12, 23, 14, 15, 16, 17, 18, 19 };

// ============================================================
//  ตัวแปรระบบ
// ============================================================

DHT           dht(DHT_PIN, DHT11);
BH1750        lightMeter;
Adafruit_INA219 ina219;
WiFiClientSecure sslClient;

bool    relayStates[10] = { false };
unsigned long lastSend   = 0;
const unsigned long SEND_INTERVAL = 5000; // ส่งทุก 5 วินาที

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
//  ฟังก์ชัน: วัดระยะห่าง JSN-SR04T (ซม.)
// ============================================================

float measureDistance(int echoPin) {
    delay(60); // รอให้คลื่นอัลตราโซนิกก่อนหน้าหายไป

    digitalWrite(JSN_TRIG, LOW);
    delayMicroseconds(2);
    digitalWrite(JSN_TRIG, HIGH);
    delayMicroseconds(10);
    digitalWrite(JSN_TRIG, LOW);

    // pulseIn timeout 50ms (ระยะสูงสุด ~850 ซม.)
    long duration = pulseIn(echoPin, HIGH, 50000UL);
    if (duration == 0) return -1.0f; // ไม่ได้รับสัญญาณ

    return (duration * 0.0343f) / 2.0f;
}

// แปลงระยะห่าง → เปอร์เซ็นต์ระดับน้ำ (0=ว่าง, 100=เต็ม)
float distanceToPercent(float distCm, float tankHeight) {
    if (distCm < 0.0f) return -1.0f; // sensor error
    float waterHeight = tankHeight - distCm;
    waterHeight = constrain(waterHeight, 0.0f, tankHeight);
    return (waterHeight / tankHeight) * 100.0f;
}

// ============================================================
//  ฟังก์ชัน: อ่านค่า pH
//  ** ต้องสอบเทียบ (Calibrate) ด้วย Buffer Solution pH4 และ pH7 **
// ============================================================

float readPH(int pin) {
    // เฉลี่ย 20 ครั้งเพื่อลด Noise
    long sum = 0;
    for (int i = 0; i < 20; i++) {
        sum += analogRead(pin);
        delay(5);
    }
    float avgRaw = sum / 20.0f;
    float voltage = avgRaw * (3.3f / 4095.0f);

    // สูตร: pH = 7 + (Vmid - Vout) / Slope
    // Vmid = 2.5V (ค่า pH 7)
    // Slope = 0.18 V/pH (ปรับค่านี้หลังจาก Calibrate)
    float ph = 7.0f + ((2.5f - voltage) / 0.18f);

    return constrain(ph, 0.0f, 14.0f);
}

// ============================================================
//  ฟังก์ชัน: เชื่อมต่อ WiFi
// ============================================================

void connectWiFi() {
    if (WiFi.status() == WL_CONNECTED) return;

    Serial.print("[WiFi] Connecting to ");
    Serial.println(WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASS);

    int attempt = 0;
    while (WiFi.status() != WL_CONNECTED && attempt < 40) {
        delay(500);
        Serial.print(".");
        attempt++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n[WiFi] Connected! IP: " + WiFi.localIP().toString());
    } else {
        Serial.println("\n[WiFi] Failed! Will retry...");
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
    float temperature = dht.readTemperature();
    float humidity    = dht.readHumidity();
    if (isnan(temperature)) temperature = 0.0f;
    if (isnan(humidity))    humidity    = 0.0f;

    float light      = lightMeter.readLightLevel();
    float busVoltage = ina219.getBusVoltage_V();
    float currentA   = ina219.getCurrent_mA() / 1000.0f;
    float powerW     = ina219.getPower_mW()   / 1000.0f;
    float phValue1   = readPH(PH1_PIN);
    float phValue2   = readPH(PH2_PIN);

    // ระดับน้ำ 7 ถัง
    float wl[7];
    int echoPins[7] = { JSN_ECHO1, JSN_ECHO2, JSN_ECHO3, JSN_ECHO4,
                        JSN_ECHO5, JSN_ECHO6, JSN_ECHO7 };
    for (int i = 0; i < 7; i++) {
        float dist = measureDistance(echoPins[i]);
        wl[i] = distanceToPercent(dist, TANK_HEIGHT[i]);
    }

    // --- สร้าง JSON ---
    StaticJsonDocument<768> doc;
    doc["temperature"] = round(temperature * 10) / 10.0;
    doc["humidity"]    = round(humidity    * 10) / 10.0;
    doc["light"]       = round(light);
    doc["ph"]          = round(phValue1    * 10) / 10.0;
    doc["ph2"]         = round(phValue2    * 10) / 10.0;
    doc["voltage"]     = round(busVoltage  * 100) / 100.0;
    doc["current"]     = round(currentA    * 1000) / 1000.0;
    doc["power"]       = round(powerW      * 100) / 100.0;

    JsonArray waterLevel = doc.createNestedArray("waterLevel");
    for (int i = 0; i < 7; i++) {
        waterLevel.add(round(wl[i] * 10) / 10.0);
    }

    String body;
    serializeJson(doc, body);

    Serial.println("[HTTP] Sending: " + body);

    // --- HTTP POST ---
    sslClient.setInsecure(); // ข้าม SSL certificate verification

    HTTPClient http;
    if (!http.begin(sslClient, String(SERVER_URL) + "/api/data")) {
        Serial.println("[HTTP] Cannot connect to server");
        return;
    }

    http.addHeader("Content-Type", "application/json");
    http.setTimeout(10000); // 10 วินาที

    int httpCode = http.POST(body);

    if (httpCode == HTTP_CODE_OK) {
        String response = http.getString();
        Serial.println("[HTTP] Response: " + response);

        // อ่านคำสั่งรีเลย์จาก response
        StaticJsonDocument<256> respDoc;
        DeserializationError err = deserializeJson(respDoc, response);
        if (!err) {
            JsonArray relays = respDoc["relays"].as<JsonArray>();
            if (relays.size() == 10) {
                for (int i = 0; i < 10; i++) {
                    bool newState = relays[i].as<bool>();
                    if (newState != relayStates[i]) {
                        setRelay(i, newState);
                        Serial.printf("[Relay] R%d -> %s\n", i + 1, newState ? "ON" : "OFF");
                    }
                }
            }
        }
    } else {
        Serial.printf("[HTTP] Error: %d\n", httpCode);
    }

    http.end();
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

    // Init Relay (ปิดทั้งหมดก่อน)
    for (int i = 0; i < 10; i++) {
        pinMode(RELAY_PINS[i], OUTPUT);
        setRelay(i, false);
    }
    Serial.println("[Relay] Initialized (all OFF)");

    // Init JSN-SR04T
    pinMode(JSN_TRIG, OUTPUT);
    digitalWrite(JSN_TRIG, LOW);
    pinMode(JSN_ECHO1, INPUT);
    pinMode(JSN_ECHO2, INPUT);
    pinMode(JSN_ECHO3, INPUT);
    pinMode(JSN_ECHO4, INPUT);
    pinMode(JSN_ECHO5, INPUT);
    pinMode(JSN_ECHO6, INPUT);
    pinMode(JSN_ECHO7, INPUT);
    Serial.println("[JSN-SR04T] Initialized (7 sensors)");

    // Init I2C
    Wire.begin(21, 22);

    // Init DHT11
    dht.begin();
    Serial.println("[DHT11] Initialized");

    // Init BH1750
    if (lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE)) {
        Serial.println("[BH1750] OK");
    } else {
        Serial.println("[BH1750] NOT FOUND - Check wiring!");
    }

    // Init INA219
    if (ina219.begin()) {
        Serial.println("[INA219] OK");
    } else {
        Serial.println("[INA219] NOT FOUND - Check wiring!");
    }

    // Connect WiFi
    connectWiFi();

    Serial.println("[Setup] Complete! Starting main loop...\n");
}

// ============================================================
//  Loop
// ============================================================

void loop() {
    // ตรวจสอบ WiFi และ reconnect ถ้าหลุด
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
