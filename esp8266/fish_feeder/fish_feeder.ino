/*************************************************
 * Fish Feeder IoT v2.5 (With Local AP Mode)
 * ESP8266 NodeMCU
 *************************************************/

#include <ESP8266WiFi.h>
#include <WiFiClientSecureBearSSL.h>
#include <PubSubClient.h>
#include <ESP8266WebServer.h> // >>> เพิ่มเข้ามาเพื่อเปิด Web Server บนบอร์ด

#include <Wire.h>
#include <RTClib.h>
#include "HX711.h"
#include <ArduinoJson.h>

#include "secrets.h"

//////////////////////////////////////////////////
// MQTT TOPIC
//////////////////////////////////////////////////
#define TOPIC_COMMAND  "fishfeeder/command"
#define TOPIC_STATUS   "fishfeeder/status"
#define TOPIC_WEIGHT   "fishfeeder/weight"
#define TOPIC_HISTORY  "fishfeeder/history"
#define TOPIC_ALERT    "fishfeeder/alert"
#define TOPIC_SCHEDULE "fishfeeder/schedule"

//////////////////////////////////////////////////
// PIN
//////////////////////////////////////////////////
#define HX711_DT D5
#define HX711_SCK D6
#define RELAY_PIN D1
#define LED_PIN D4
#define SDA_PIN D2
#define SCL_PIN D3

//////////////////////////////////////////////////
// LIMITS & CONFIG LOCAL
//////////////////////////////////////////////////
#define MAX_FEED_GRAMS 500
const char* FIRMWARE_VERSION = "2.5.0";

// ตั้งค่าสำหรับการปล่อยสัญญาณ Wi-Fi จากบอร์ด
const char* AP_SSID = "FishFeeder-Local";
const char* AP_PASS = "12345678";

//////////////////////////////////////////////////
// GLOBALS OBJECTS
//////////////////////////////////////////////////
HX711 scale;
float calibrationFactor = -7050.0;
float weight = 0;

RTC_DS3231 rtc;
BearSSL::WiFiClientSecure secureClient;
PubSubClient mqtt(secureClient);
ESP8266WebServer localServer(80); // >>> สร้าง Server พอร์ต 80

//////////////////////////////////////////////////
// STATUS VARIABLS
//////////////////////////////////////////////////
bool deviceOnline = false;
bool feeding = false;
bool isLocalMode = false; // >>> ตัวแปรเช็คว่าขณะนี้อยู่โหมดปล่อย Wi-Fi เองหรือไม่

unsigned long lastPublish = 0;
unsigned long lastReconnect = 0;
unsigned long lastWeight = 0;
String deviceName = "FishFeeder-01";

//////////////////////////////////////////////////
// SCHEDULE STRUCT
//////////////////////////////////////////////////
struct FeedSchedule{
    int hour;
    int minute;
    bool enable;
};
FeedSchedule schedules[10];
int scheduleCount = 0;

//////////////////////////////////////////////////
// FUNCTION DECLARATIONS
//////////////////////////////////////////////////
void connectWiFi();
void setupLocalAP();
void handleLocalWeb();
void connectMQTT();
void mqttCallback(char* topic, byte* payload, unsigned int length);
void publishStatus();
void publishWeight();
void feedFish(int gram);
void checkSchedule();
void blinkLED(int count);
void parseSchedule(String json);
void publishHistory(int gram);
void publishAlert(String message);
void readWeight();

// หน้าเว็บ HTML สำหรับการใช้งานเมื่อเชื่อมต่อกับบอร์ดโดยตรง (Local Mode)
const char HTML_PAGE[] PROGMEM = R"=====(
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Fish Feeder Local Control</title>
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; text-align: center; background: #eef2f5; color: #333; padding: 20px; margin:0; }
        .container { max-width: 500px; background: white; margin: 40px auto; padding: 30px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
        h2 { color: #2c3e50; margin-bottom: 5px; }
        .status-badge { display: inline-block; padding: 5px 15px; background: #f39c12; color: white; border-radius: 20px; font-size: 14px; font-weight: bold; margin-bottom: 20px; }
        .btn { display: block; width: 100%; padding: 15px 0; font-size: 18px; font-weight: bold; color: white; border: none; border-radius: 8px; margin: 15px 0; cursor: pointer; transition: 0.2s; }
        .btn-feed { background-color: #2ecc71; box-shadow: 0 4px #27ae60; }
        .btn-feed:active { transform: translateY(4px); box-shadow: 0 0px #27ae60; }
        .btn-stop { background-color: #e74c3c; box-shadow: 0 4px #c0392b; }
        .btn-stop:active { transform: translateY(4px); box-shadow: 0 0px #c0392b; }
        p { font-size: 14px; color: #7f8c8d; }
    </style>
</head>
<body>
    <div class="container">
        <h2>🐟 Fish Feeder Control</h2>
        <div class="status-badge">🟡 LOCAL MODE (NO INTERNET)</div>
        <p>คุณกำลังเชื่อมต่อตรงกับตัวเครื่อง ควบคุมได้แบบเสถียรไร้สาย</p>
        <hr style="border:0; border-top:1px solid #eee; margin: 20px 0;">
        <button class="btn btn-feed" onclick="location.href='/feed'">สับสวิตช์ให้อาหาร (100g)</button>
        <button class="btn btn-stop" onclick="location.href='/stop'">■ สั่งหยุดมอเตอร์ทันที</button>
    </div>
</body>
</html>
)=====";

//////////////////////////////////////////////////
// WiFi Connection Logic
//////////////////////////////////////////////////
void connectWiFi() {
    if (WiFi.status() == WL_CONNECTED) return;

    Serial.println();
    Serial.println("======================");
    Serial.println("Connecting WiFi...");
    Serial.println("======================");

    WiFi.mode(WIFI_AP_STA); // โหมดลูกผสม (ทั้งรับและปล่อยสัญญาณพร้อมกัน)
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    unsigned long startAttempt = millis();
    
    // พยายามเชื่อมต่อ WiFi บ้านภายใน 15 วินาที ถ้าไม่เจอจะหลุดลูปไปเปิดโหมด AP
    while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 15000) {
        blinkLED(1);
        delay(400);
        Serial.print(".");
    }

    Serial.println();

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("WiFi Connected Successfully!");
        Serial.print("IP : ");
        Serial.println(WiFi.localIP());
        isLocalMode = false;
    } else {
        // หากเชื่อมต่อ WiFi บ้านไม่ได้ ให้เข้าสู่กระบวนการปล่อย WiFi ตัวเอง
        setupLocalAP();
    }
}

// ฟังก์ชันเปิดโหมดปล่อยสัญญาณ Wi-Fi ออกมาจากบอร์ด
void setupLocalAP() {
    Serial.println("!! Cannot connect to Home WiFi !!");
    WiFi.mode(WIFI_AP);
    WiFi.softAP(AP_SSID, AP_PASS);

    Serial.println("======================");
    Serial.println("SYSTEM SWITCHED TO LOCAL AP");
    Serial.print("SSID: "); Serial.println(AP_SSID);
    Serial.print("Web URL IP: "); Serial.println(WiFi.softAPIP()); // 192.168.4.1
    Serial.println("======================");

    // วางระบบเส้นทางหน้าเว็บย่อย (Routing)
    localServer.on("/", HTTP_GET, []() {
        localServer.send_P(200, "text/html", HTML_PAGE);
    });

    localServer.on("/feed", HTTP_GET, []() {
        localServer.send(200, "text/html", "<script>alert('กำลังเริ่มจ่ายอาหาร 100 กรัม...'); window.location='/';</script>");
        feedFish(100); 
    });

    localServer.on("/stop", HTTP_GET, []() {
        localServer.send(200, "text/html", "<script>alert('ส่งสัญญาณหยุดการทำงานมอเตอร์แล้ว'); window.location='/';</script>");
        digitalWrite(RELAY_PIN, HIGH); // สั่ง Relay ตัดไฟทันทีตามลอจิก Active LOW ตัวแก้ไข
        feeding = false; // ปลดล็อกสถานะลูปการจ่ายอาหาร
    });

    localServer.begin();
    isLocalMode = true;
}

//////////////////////////////////////////////////
// MQTT Callback
//////////////////////////////////////////////////
void mqttCallback(char* topic, byte* payload, unsigned int length) {
    String message = "";
    for (unsigned int i = 0; i < length; i++) {
        message += (char)payload[i];
    }

    Serial.println();
    Serial.print("Topic : ");   Serial.println(topic);
    Serial.print("Message : "); Serial.println(message);

    if (String(topic) == TOPIC_COMMAND) { 
        StaticJsonDocument<200> doc;
        DeserializationError err = deserializeJson(doc, message);

        if (err) {
            Serial.println("JSON Error");
            return;
        }

        String action = doc["action"];

        if (action == "feed") {
            int gram = doc["grams"];
            if (gram <= 0 || gram > MAX_FEED_GRAMS) {
                Serial.println("Feed command rejected: grams out of range");
                return;
            }
            feedFish(gram);
        }

        if (action == "stop") {
            digitalWrite(RELAY_PIN, HIGH); // แก้ไขให้สัมพันธ์กับ Active LOW
            feeding = false;
            Serial.println("Action Stop Received in Callback!");
        }
    }

    if (String(topic) == TOPIC_SCHEDULE) {
        parseSchedule(message);
    }
}

//////////////////////////////////////////////////
// MQTT Connection
//////////////////////////////////////////////////
void connectMQTT() {
    if (mqtt.connected()) return; 

    Serial.println();
    Serial.println("======================");
    Serial.println("Connecting MQTT...");
    Serial.println("======================");

    secureClient.setInsecure();
    mqtt.setServer(MQTT_HOST, MQTT_PORT);
    mqtt.setCallback(mqttCallback);

    // ตรวจจับสัญญาณ Last Will เพื่อเปลี่ยนเป็น Offline ทันทีใน 10 วินาทีเมื่อถอดปลั๊ก
    mqtt.setKeepAlive(10); 

    while (!mqtt.connected()) {
        String clientID = "ESP8266-" + String(ESP.getChipId());

        bool connected = mqtt.connect(
            clientID.c_str(),
            MQTT_USER,
            MQTT_PASS,
            TOPIC_STATUS,           // willTopic
            1,                      // willQos
            true,                   // willRetain
            "{\"online\":false}"    // willMessage
        );

        if (connected) {
            Serial.println("MQTT Connected");
            mqtt.subscribe(TOPIC_COMMAND);
            mqtt.subscribe(TOPIC_SCHEDULE);
            publishStatus();
        }
        else {
            Serial.print("MQTT Failed : ");
            Serial.println(mqtt.state());
            delay(3000);
        }
    }
}

//////////////////////////////////////////////////
// Setup
//////////////////////////////////////////////////
void setup() {
    Serial.begin(115200);
    Serial.println();

    pinMode(RELAY_PIN, OUTPUT);
    digitalWrite(RELAY_PIN, HIGH); // เริ่มต้นระบบให้ Relay ตัดไฟไว้ก่อน (Active LOW)

    pinMode(LED_PIN, OUTPUT);
    digitalWrite(LED_PIN, LOW);

    Wire.begin(SDA_PIN, SCL_PIN);
    if (!rtc.begin()) {
        Serial.println("RTC NOT FOUND");
    }

    scale.begin(HX711_DT, HX711_SCK);
    scale.set_scale(calibrationFactor);
    scale.tare();

    // เรียกฟังก์ชันตรวจสอบ Wi-Fi 
    connectWiFi();

    // หากสามารถเชื่อมต่อ Wi-Fi บ้านได้สำเร็จ ให้เปิดการเชื่อมต่อ MQTT ต่อเนื่องไปเลย
    if (!isLocalMode) {
        connectMQTT();
    }

    Serial.println();
    Serial.println("======================");
    Serial.println("Fish Feeder Ready");
    Serial.println("======================");
}

//////////////////////////////////////////////////
// Loop
//////////////////////////////////////////////////
void loop() {
    
    // --- ทำงานในโหมดปกติ (มี Wi-Fi บ้านเชื่อมต่ออยู่) ---
    if (!isLocalMode) {
        if (WiFi.status() != WL_CONNECTED) {
            connectWiFi();
            return;
        }

        if (!mqtt.connected()) {
            connectMQTT();
        }

        mqtt.loop();

        // อัปเดตข้อมูลน้ำหนักผ่าน MQTT ทุกๆ 2 วินาที
        if (millis() - lastWeight > 2000) {
            lastWeight = millis();
            readWeight();
            publishWeight();
        }

        // อัปเดตสถานะความเคลื่อนไหวทั่วไปทุกๆ 5 วินาที
        if (millis() - lastPublish > 5000) {
            lastPublish = millis();
            publishStatus();
        }

        checkSchedule();
    } 
    // --- ทำงานในโหมดสัญญาณบอร์ด (Local AP Mode ไม่มีเน็ต) ---
    else {
        localServer.handleClient(); // คอยสแตนด์บายดักฟังสัญญาณปุ่มกดหน้าเว็บ 192.168.4.1
        
        // ในโหมดออฟไลน์ยังคงอ่านค่าน้ำหนักต่อเนื่องเพื่อดูใน Serial Monitor ได้
        if (millis() - lastWeight > 2000) {
            lastWeight = millis();
            readWeight();
        }
    }
}

//////////////////////////////////////////////////
// Feed Fish (Non-blocking & Active LOW Fixed)
//////////////////////////////////////////////////
void feedFish(int gram) {
    feeding = true;

    Serial.println();
    Serial.println("======================");
    Serial.println("FEEDING START...");
    Serial.println("======================");

    // เปิดไฟให้กระแสวิ่งไปมอเตอร์ (สำหรับโมดูลสไตล์ Active LOW)
    digitalWrite(RELAY_PIN, LOW); 

    unsigned long start = millis();
    unsigned long duration = (unsigned long)(gram * 80);

    while ((millis() - start < duration) && feeding) {
        // ถ้าอยู่โหมดออนไลน์ให้รันระบบตรวจจับปุ่ม Stop ผ่าน MQTT คอนเคอร์เรนต์ไปด้วย
        if (!isLocalMode) {
            mqtt.loop();
        } else {
            localServer.handleClient(); // ถ้าอยู่โหมดออฟไลน์ให้รับฟังการกด Stop จากหน้าเว็บสั้นๆ
        }
        yield();
    }

    // ตัดกระแสไฟฟ้าเพื่อดับมอเตอร์ทันที
    digitalWrite(RELAY_PIN, HIGH); 

    if (!feeding) {
        Serial.println(">> FEEDING INTERRUPTED BY MANUALLY STOP <<");
        if (!isLocalMode) publishAlert("Feeding stopped manually by user"); 
    } else {
        Serial.println(">> FEEDING COMPLETED SUCCESS <<");
        feeding = false;
    }

    if (!isLocalMode) {
        publishHistory(gram);
        publishStatus();
    }
}

//////////////////////////////////////////////////
// Helper Functions (Publish Data / Read Sensors)
//////////////////////////////////////////////////
void publishStatus() {
    StaticJsonDocument<256> doc;
    doc["device"] = deviceName;
    doc["online"] = true;
    doc["feeding"] = feeding;
    doc["weight"] = weight;
    doc["firmware"] = FIRMWARE_VERSION;
    doc["ip"] = WiFi.localIP().toString();
    doc["wifi"] = WiFi.RSSI();

    char buffer[256];
    serializeJson(doc, buffer);
    mqtt.publish(TOPIC_STATUS, buffer, true);
}

void publishWeight() {
    StaticJsonDocument<128> doc;
    doc["weight"] = weight;
    char buffer[128];
    serializeJson(doc, buffer);
    mqtt.publish(TOPIC_WEIGHT, buffer, true);
}

void readWeight() {
    if (scale.is_ready()) {
        weight = scale.get_units(5);
        if (weight < 0) weight = 0;
    }
}

void checkSchedule() {
    DateTime now = rtc.now();
    int h = now.hour();
    int m = now.minute();
    static int lastMinute = -1;

    if (m == lastMinute) return;
    lastMinute = m;

    for (int i = 0; i < scheduleCount; i++) {
        if (!schedules[i].enable) continue;
        if (schedules[i].hour == h && schedules[i].minute == m) {
            Serial.println("\nScheduled Feeding");
            feedFish(30);
        }
    }
}

void blinkLED(int count) {
    for (int i = 0; i < count; i++) {
        digitalWrite(LED_PIN, LOW);
        delay(150);
        digitalWrite(LED_PIN, HIGH);
        delay(150);
    }
}

void publishHistory(int gram) {
    StaticJsonDocument<256> doc;
    DateTime now = rtc.now();
    char datetime[25];
    sprintf(datetime, "%04d-%02d-%02d %02d:%02d:%02d", now.year(), now.month(), now.day(), now.hour(), now.minute(), now.second());

    doc["device"] = deviceName;
    doc["amount"] = gram;
    doc["mode"] = "manual";
    doc["time"] = datetime;

    char buffer[256];
    serializeJson(doc, buffer);
    mqtt.publish(TOPIC_HISTORY, buffer);
}

void publishAlert(String message) {
    StaticJsonDocument<200> doc;
    doc["device"] = deviceName;
    doc["level"] = "warning";
    doc["message"] = message;

    char buffer[200];
    serializeJson(doc, buffer);
    mqtt.publish(TOPIC_ALERT, buffer);
}

void parseSchedule(String json) {
    StaticJsonDocument<512> doc;
    DeserializationError err = deserializeJson(doc, json);
    if (err) {
        Serial.println("Schedule JSON Error");
        return;
    }

    JsonArray arr = doc["schedules"];
    scheduleCount = 0;

    for (JsonObject item : arr) {
        if (scheduleCount >= 10) break;
        String time = item["time"];
        if (time.length() < 5) {
            Serial.println("Invalid schedule time, skipped");
            continue;
        }
        schedules[scheduleCount].hour = time.substring(0, 2).toInt();
        schedules[scheduleCount].minute = time.substring(3, 5).toInt();
        schedules[scheduleCount].enable = item["enable"];
        scheduleCount++;
    }
    Serial.print("Schedule Updated, count = ");
    Serial.println(scheduleCount);
}