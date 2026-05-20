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
const char* SERVER_URL = "https://project-sau.onrender.com";

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
// PH2_PIN: GPIO 13 ถูกย้ายให้ Relay R3 แล้ว — ต่อ ADS1115 เพื่อวัด pH2
#define SR04_TX_PIN  25                              // TX ร่วมกันทุกตัว (ส่ง trigger)
const int SR04_RX_PINS[7] = { 26, 27, 32, 33, 35, 36, 39 };
// [0]=ถังสารA [1]=ถังสารB [2]=ถังน้ำเติม [3]=ลังปลูกผัก1
// [4]=ถังน้ำวนลัง1 [5]=ลังปลูกผัก2 [6]=ถังน้ำวนลัง2

// R1=GPIO2  R2=GPIO5  R3=GPIO13  R4=GPIO23  R5=GPIO14
// R6=GPIO15 R7=GPIO16 R8=GPIO17  R9=GPIO18  R10=GPIO19
const int RELAY_PINS[10] = { 2, 5, 13, 23, 14, 15, 16, 17, 18, 19 };

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
//  ฟังก์ชัน: วัดระยะห่าง SR04M-2 แบบ Bit-bang (Inverted UART 9600)
//  SR04M-2 ส่ง idle=LOW (inverted) → ต้องอ่าน GPIO โดยตรง
// ============================================================

// รอ rising edge (LOW→HIGH = start bit ของ inverted UART)
static bool waitRisingEdge(int pin, uint32_t timeoutUs) {
    uint32_t t = micros();
    while (digitalRead(pin) == LOW)
        if ((uint32_t)(micros() - t) > timeoutUs) return false;
    return true;
}

// อ่าน 1 byte จาก inverted UART 9600 baud
// inverted: LOW=1, HIGH=0
static bool readInvByte(int pin, uint8_t &out) {
    if (!waitRisingEdge(pin, 25000)) return false; // รอ start bit (HIGH)
    uint32_t t0 = micros();
    uint8_t b = 0;
    portDISABLE_INTERRUPTS();
    // sample 8 data bits ที่จุดกึ่งกลางของแต่ละ bit (104µs/bit, เริ่มที่ 1.5 bit)
    for (int i = 0; i < 8; i++) {
        while ((uint32_t)(micros() - t0) < (uint32_t)(156 + 104 * i));
        if (digitalRead(pin) == LOW) b |= (1 << i); // LOW=1
    }
    portENABLE_INTERRUPTS();
    while ((uint32_t)(micros() - t0) < 1040); // รอจบ stop bit
    out = b;
    return true;
}

float measureDistanceUART(int rxPin) {
    pinMode(rxPin, INPUT);
    uint8_t fr[4];
    unsigned long t = millis();
    while (millis() - t < 800) {
        if (!readInvByte(rxPin, fr[0])) continue;
        if (fr[0] != 0xFF) continue;
        if (!readInvByte(rxPin, fr[1])) continue;
        if (!readInvByte(rxPin, fr[2])) continue;
        if (!readInvByte(rxPin, fr[3])) continue;

        if (rxPin == SR04_RX_PINS[0]) {
            Serial.printf("[SR04-DBG] pin=%d: %02X %02X %02X %02X\n",
                rxPin, fr[0], fr[1], fr[2], fr[3]);
        }

        if (((0xFF + fr[1] + fr[2]) & 0xFF) == fr[3])
            return (fr[1] * 256.0f + fr[2]) / 10.0f;
    }
    return -1.0f;
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
    float phValue2   = 7.0f; // GPIO 13 ถูกใช้เป็น Relay R3 แล้ว — ต้องใช้ ADS1115

    // ระดับน้ำ 7 ถัง
    float wl[7];
    for (int i = 0; i < 7; i++) {
        float dist = measureDistanceUART(SR04_RX_PINS[i]);
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

    // Init SR04M-2 (Bit-bang inverted UART) — ตั้ง INPUT ทุกขา
    for (int i = 0; i < 7; i++) pinMode(SR04_RX_PINS[i], INPUT);
    Serial.println("[SR04M-2] Bit-bang mode, 7 sensors ready");

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
