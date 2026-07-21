#include <ESP8266WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include "HX711.h"
#include "secrets.h"

// --- 📌 Pin Configurations ---
#define HX711_DT  D5
#define HX711_SCK D6
#define RELAY_PIN D1
#define LED_PIN   D4
#define SDA_PIN   D2
#define SCL_PIN   D3

// --- ⚙️ Calibration Values ---
// ค่า calibration factor ของโหลดเซลล์ (ต้องปรับให้ตรงกับแผ่นโหลดเซลล์จริงของคุณ)
#define CALIBRATION_FACTOR 2280.0 

// --- Objects ---
HX711 scale;
WiFiClientSecure espClient;
PubSubClient client(espClient);

// --- MQTT Topics ---
String subFeedTopic   = "fishfeeder/" + String(DEVICE_ID) + "/cmd/feed";
String subStopTopic   = "fishfeeder/" + String(DEVICE_ID) + "/cmd/stop";
String pubStatusTopic = "fishfeeder/" + String(DEVICE_ID) + "/status";
String pubWeightTopic = "fishfeeder/" + String(DEVICE_ID) + "/weight";

// Timers
unsigned long lastWeightReport = 0;
const long reportInterval = 5000; // ส่งค่าน้ำหนักทุกๆ 5 วินาที

// Function Declarations
void setupWiFi();
void reconnectMQTT();
void callback(char* topic, byte* payload, unsigned int length);
void triggerFeeding(int amountGrams);
void emergencyStop();
void publishStatus(String state, String msg);
void publishWeight();

void setup() {
  Serial.begin(115200);

  // Pin Modes setup
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW); // ปิด Relay ไว้ตั้งต้น
  digitalWrite(LED_PIN, HIGH);  // ไฟ LED ของ ESP8266 ดับตั้งต้น (Active LOW)

  // I2C Setup (สำหรับต่อจอ OLED หรือ RTC)
  Wire.begin(SDA_PIN, SCL_PIN);

  // HX711 Setup
  scale.begin(HX711_DT, HX711_SCK);
  scale.set_scale(CALIBRATION_FACTOR);
  scale.tare(); // เซ็ตน้ำหนักเริ่มต้นเป็น 0 (Set Tare)

  setupWiFi();

  // SSL/TLS Config
  espClient.setInsecure();
  client.setServer(MQTT_HOST, MQTT_PORT);
  client.setCallback(callback);
}

void loop() {
  if (!client.connected()) {
    reconnectMQTT();
  }
  client.loop();

  // อ่านและส่งค่าน้ำหนักเข้า MQTT/Firebase ตามช่วงเวลา
  unsigned long currentMillis = millis();
  if (currentMillis - lastWeightReport >= reportInterval) {
    lastWeightReport = currentMillis;
    publishWeight();
  }
}

// ----------------------------------------------------
// 📶 การเชื่อมต่อ Wi-Fi
// ----------------------------------------------------
void setupWiFi() {
  delay(10);
  Serial.print("Connecting to Wi-Fi: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    // สลับไฟ LED เพื่อแสดงการกำลังเชื่อมต่อ
    digitalWrite(LED_PIN, !digitalRead(LED_PIN)); 
  }

  Serial.println("\nWiFi connected!");
  digitalWrite(LED_PIN, LOW); // ติดสว่างเมื่อเชื่อมต่อสำเร็จ (Active LOW)
}

// ----------------------------------------------------
// 🔄 การเชื่อมต่อ MQTT Broker
// ----------------------------------------------------
void reconnectMQTT() {
  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    String clientId = "ESP8266Client-" + String(DEVICE_ID) + "-" + String(random(0xffff), HEX);

    if (client.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
      Serial.println("CONNECTED!");

      client.subscribe(subFeedTopic.c_str());
      client.subscribe(subStopTopic.c_str());

      publishStatus("ONLINE", "Device connected & scale ready");
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 5 seconds");
      delay(5000);
    }
  }
}

// ----------------------------------------------------
// 📩 รับคำสั่ง (Callback)
// ----------------------------------------------------
void callback(char* topic, byte* payload, unsigned int length) {
  String incomingTopic = String(topic);
  
  StaticJsonDocument<256> doc;
  DeserializationError error = deserializeJson(doc, payload, length);

  if (error) return;

  if (incomingTopic == subFeedTopic) {
    int amount = doc["amount"] | 10;
    triggerFeeding(amount);
  } else if (incomingTopic == subStopTopic) {
    emergencyStop();
  }
}

// ----------------------------------------------------
// ⚙️ กลไกการให้อาหารผ่าน Relay
// ----------------------------------------------------
void triggerFeeding(int amountGrams) {
  Serial.printf("Feeding action started! Target: %d grams\n", amountGrams);
  publishStatus("FEEDING", "Relay ON - Dispensing food...");

  // เปิด Relay เพื่อให้มอเตอร์/วาล์วทำงาน
  digitalWrite(RELAY_PIN, HIGH);
  digitalWrite(LED_PIN, LOW);

  // คำนวณเวลารัน Relay เบื้องต้น (ตัวอย่าง: 10 กรัม = เปิด 2 วินาที)
  int runDuration = (amountGrams / 10) * 2000;
  if (runDuration < 1000) runDuration = 1000;

  delay(runDuration);

  // ปิด Relay เมื่อครบกำหนดเวลา
  digitalWrite(RELAY_PIN, LOW);
  digitalWrite(LED_PIN, HIGH);

  publishStatus("IDLE", "Feeding complete");
  publishWeight(); // ส่งค่าน้ำหนักล่าสุดทันทีหลังให้อาหาร
}

// ----------------------------------------------------
// 🛑 หยุดฉุกเฉิน
// ----------------------------------------------------
void emergencyStop() {
  digitalWrite(RELAY_PIN, LOW); // ตัดไฟ Relay ทันที
  digitalWrite(LED_PIN, HIGH);
  publishStatus("STOPPED", "Emergency stop executed");
}

// ----------------------------------------------------
// ⚖️ อ่านน้ำหนักจาก HX711 และส่งค่าขึ้น MQTT
// ----------------------------------------------------
void publishWeight() {
  if (scale.is_ready()) {
    float weight = scale.get_units(5); // อ่านค่าเฉลี่ย 5 ครั้ง
    if (weight < 0) weight = 0.0;     // กันค่าติดลบชั่วคราว

    StaticJsonDocument<128> doc;
    doc["weight_grams"] = weight;
    doc["timestamp"] = millis() / 1000;

    char buffer[128];
    serializeJson(doc, buffer);

    client.publish(pubWeightTopic.c_str(), buffer);
    Serial.printf("Current Food Weight: %.2f g\n", weight);
  }
}

// ----------------------------------------------------
// 📤 ส่งสถานะกลับเข้า System
// ----------------------------------------------------
void publishStatus(String state, String msg) {
  StaticJsonDocument<128> doc;
  doc["state"] = state;
  doc["message"] = msg;

  char buffer[128];
  serializeJson(doc, buffer);

  client.publish(pubStatusTopic.c_str(), buffer);
}