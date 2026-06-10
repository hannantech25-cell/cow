/*
 * Project COW — Gateway Node Firmware (ESP32 Dev Board)
 *
 * === Arduino IDE Setup ===
 * 1. Install ESP32 board package:
 *    File → Preferences → Additional Boards Manager URLs:
 *    https://espressif.github.io/arduino-esp32/package_esp32_index.json
 *    Tools → Board → Boards Manager → "esp32" → Install
 * 2. Select board: Tools → Board → ESP32 → "ESP32 Dev Module"
 * 3. Install libraries (Tools → Manage Libraries):
 *    - ArduinoJson  by Benoit Blanchon  (v7.x)
 *    - PubSubClient by Nick O'Leary      (v2.x)
 *
 * Runs continuously (mains-powered via USB).  Uses the built-in Wi-Fi radio
 * simultaneously for:
 *   1. ESP-NOW  — receiving GPS payloads from edge nodes
 *   2. Wi-Fi STA — forwarding data to Mosquitto MQTT broker
 *
 * On first boot the gateway obtains its location via IP geolocation and
 * POSTs it to the server so the API can supply initial coordinates to newly
 * registering edge nodes.
 *
 * See docs/gateway_node_process_flow.md
 */

#include <WiFi.h>
#include <WiFiClient.h>
#include <HTTPClient.h>
#include <PubSubClient.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <Preferences.h>
#include <ArduinoJson.h>

// ============================================================================
// 1. Compile-Time Defaults (overridden by NVS once configured)
// ============================================================================

#define DEFAULT_WIFI_SSID     "payazal-2.4G"
#define DEFAULT_WIFI_PASS     "P@y@z@l83"
#define DEFAULT_MQTT_HOST     "localhost"
#define DEFAULT_MQTT_PORT     1883
#define DEFAULT_SERVER_URL    "http://localhost:3000"

// MQTT topics
#define TOPIC_DATA      "cow/tracker/data"
#define TOPIC_ACK       "cow/tracker/ack"
#define TOPIC_REGISTER  "cow/tracker/register"
#define TOPIC_UPDATE    "cow/tracker/update"

// Geolocation fallback (approximately Pagoh, Johor, Malaysia)
#define DEFAULT_LATITUDE   2.1490f
#define DEFAULT_LONGITUDE  102.7710f

// Maximum retries for server POST on first boot
#define LOCATION_POST_MAX_RETRY 3

// ESP-NOW packet queue size (for interrupt → main-loop handoff)
#define ESP_NOW_QUEUE_SIZE 16
#define ESP_NOW_MAX_PAYLOAD 250

// ============================================================================
// 2. NVS Key Names (max 15 chars)
// ============================================================================

static const char* NVS_NS       = "cow_gw";

static const char* KEY_FIRST_BOOT = "first_boot";   // bool — absent = first boot
static const char* KEY_GW_LAT     = "gw_lat";       // float
static const char* KEY_GW_LNG     = "gw_lng";       // float
static const char* KEY_WIFI_SSID  = "wifi_ssid";    // string
static const char* KEY_WIFI_PASS  = "wifi_pass";    // string
static const char* KEY_MQTT_HOST  = "mqtt_host";    // string
static const char* KEY_MQTT_PORT  = "mqtt_port";    // uint16
static const char* KEY_SERVER_URL = "srv_url";      // string

// ============================================================================
// 3. ESP-NOW Packet Queue (thread-safe handoff from ISR to main loop)
// ============================================================================

struct QueuedPacket {
  uint8_t senderMac[6];
  uint8_t data[ESP_NOW_MAX_PAYLOAD];
  int     length;
  int8_t  rssi;               // ESP-NOW signal strength (dBm)
};

static QueuedPacket      packetQueue[ESP_NOW_QUEUE_SIZE];
static volatile int      queueHead  = 0;
static volatile int      queueTail  = 0;
static volatile int      queueCount = 0;
static portMUX_TYPE      queueMux   = portMUX_INITIALIZER_UNLOCKED;

// ---- queue helpers (call from main loop only) ----

static bool dequeuePacket(QueuedPacket& out) {
  portENTER_CRITICAL(&queueMux);
  if (queueCount == 0) {
    portEXIT_CRITICAL(&queueMux);
    return false;
  }
  out = packetQueue[queueHead];
  queueHead = (queueHead + 1) % ESP_NOW_QUEUE_SIZE;
  queueCount--;
  portEXIT_CRITICAL(&queueMux);
  return true;
}

static void enqueuePacket(const uint8_t* mac, const uint8_t* data, int len, int8_t rssi) {
  portENTER_CRITICAL_ISR(&queueMux);
  if (queueCount < ESP_NOW_QUEUE_SIZE) {
    QueuedPacket& p = packetQueue[queueTail];
    memcpy(p.senderMac, mac, 6);
    memcpy(p.data, data, len);
    p.length = len;
    p.rssi   = rssi;
    queueTail = (queueTail + 1) % ESP_NOW_QUEUE_SIZE;
    queueCount++;
  } else {
    // Queue full — drop oldest
    queueHead = (queueHead + 1) % ESP_NOW_QUEUE_SIZE;
    QueuedPacket& p = packetQueue[queueTail];
    memcpy(p.senderMac, mac, 6);
    memcpy(p.data, data, len);
    p.length = len;
    p.rssi   = rssi;
    queueTail = (queueTail + 1) % ESP_NOW_QUEUE_SIZE;
  }
  portEXIT_CRITICAL_ISR(&queueMux);
}

// ============================================================================
// 4. ESP-NOW Peer Registry
// ============================================================================

#define ESP_NOW_MAX_PEERS 16

static String espNowPeers[ESP_NOW_MAX_PEERS];
static int    espNowPeerCount = 0;

static bool isPeerKnown(const uint8_t* mac) {
  char buf[18];
  snprintf(buf, sizeof(buf), "%02X:%02X:%02X:%02X:%02X:%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  for (int i = 0; i < espNowPeerCount; i++) {
    if (espNowPeers[i].equalsIgnoreCase(buf)) return true;
  }
  return false;
}

static bool addPeer(const uint8_t* mac) {
  char buf[18];
  snprintf(buf, sizeof(buf), "%02X:%02X:%02X:%02X:%02X:%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);

  if (esp_now_is_peer_exist(mac)) {
    Serial.printf("[ESP-NOW] Peer %s already registered in ESP-NOW\n", buf);
    for (int i = 0; i < espNowPeerCount; i++) {
      if (espNowPeers[i].equalsIgnoreCase(buf)) return true;
    }
    if (espNowPeerCount < ESP_NOW_MAX_PEERS) {
      espNowPeers[espNowPeerCount++] = String(buf);
    }
    return true;
  }

  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, mac, 6);
  peerInfo.channel = (uint8_t)WiFi.channel();
  peerInfo.encrypt = false;

  esp_err_t err = esp_now_add_peer(&peerInfo);
  if (err == ESP_OK) {
    if (espNowPeerCount < ESP_NOW_MAX_PEERS) {
      espNowPeers[espNowPeerCount++] = String(buf);
    }
    Serial.printf("[ESP-NOW] Peer %s registered (channel %u)\n", buf, WiFi.channel());
    return true;
  } else {
    Serial.printf("[ESP-NOW] Failed to add peer %s — err %d\n", buf, err);
    return false;
  }
}

// ============================================================================
// 5. Global State
// ============================================================================

static Preferences   prefs;
static WiFiClient    wifiClient;
static PubSubClient  mqttClient(wifiClient);

static bool mqttConnected = false;
static unsigned long lastMqttReconnectAttempt = 0;

// ============================================================================
// 6. Forward Declarations (Arduino IDE auto-generates, kept for clarity)
// ============================================================================

static void loadDefaults();
static bool connectWiFi();
static bool doGeolocation(float& lat, float& lng);
static bool postLocationToServer(float lat, float lng);
static void firstBootSequence();
static bool connectMqtt();
static void mqttCallback(char* topic, byte* payload, unsigned int length);
static void initEspNow();
static void processEspNowPacket(const QueuedPacket& pkt);
static bool sendEspNowAck(const uint8_t* mac, uint32_t sleepTimeSec);

// ============================================================================
// 7. ESP-NOW Callback (ISR context — do minimal work)
// ============================================================================

static void onEspNowRecv(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
  if (len > ESP_NOW_MAX_PAYLOAD) len = ESP_NOW_MAX_PAYLOAD;
  int8_t rssi = info->rx_ctrl->rssi;
  enqueuePacket(info->src_addr, data, len, rssi);
}

// ============================================================================
// 8. MQTT Callback
// ============================================================================

static void mqttCallback(char* topic, byte* payload, unsigned int length) {
  char buf[256];
  unsigned int copyLen = length < sizeof(buf) - 1 ? length : sizeof(buf) - 1;
  memcpy(buf, payload, copyLen);
  buf[copyLen] = '\0';

  Serial.printf("[MQTT] Received on %s: %s\n", topic, buf);

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, buf);
  if (err) {
    Serial.printf("[MQTT] JSON parse error on %s: %s\n", topic, err.c_str());
    return;
  }

  // ── cow/tracker/ack ──────────────────────────────────────────────────
  if (strcmp(topic, TOPIC_ACK) == 0) {
    const char* macStr = doc["mac_address"];
    uint32_t sleepSec  = doc["sleep_time_sec"] | 15;

    if (!macStr) {
      Serial.println("[MQTT] ack missing mac_address — ignoring");
      return;
    }

    uint8_t edgeMac[6];
    int values[6];
    if (sscanf(macStr, "%x:%x:%x:%x:%x:%x",
               &values[0], &values[1], &values[2],
               &values[3], &values[4], &values[5]) != 6) {
      Serial.printf("[MQTT] ack invalid MAC: %s\n", macStr);
      return;
    }
    for (int i = 0; i < 6; i++) edgeMac[i] = (uint8_t)values[i];

    if (!esp_now_is_peer_exist(edgeMac)) {
      Serial.printf("[MQTT] ack for unknown peer %s — registering now\n", macStr);
      addPeer(edgeMac);
    }

    sendEspNowAck(edgeMac, sleepSec);
  }

  // ── cow/tracker/register ─────────────────────────────────────────────
  else if (strcmp(topic, TOPIC_REGISTER) == 0) {
    Serial.printf("[MQTT] New tracker registered: %s (%s) at %s\n",
                  doc["tracker_id"].as<const char*>() ? doc["tracker_id"].as<const char*>() : "?",
                  doc["mac_address"].as<const char*>()  ? doc["mac_address"].as<const char*>()  : "?",
                  doc["location"].as<const char*>()     ? doc["location"].as<const char*>()     : "?");
  }

  // ── cow/tracker/update ───────────────────────────────────────────────
  else if (strcmp(topic, TOPIC_UPDATE) == 0) {
    Serial.printf("[MQTT] Tracker updated: %s (%s) → %s\n",
                  doc["tracker_id"].as<const char*>() ? doc["tracker_id"].as<const char*>() : "?",
                  doc["mac_address"].as<const char*>()  ? doc["mac_address"].as<const char*>()  : "?",
                  doc["location"].as<const char*>()     ? doc["location"].as<const char*>()     : "?");
  }
}

// ============================================================================
// 9. Utility Functions
// ============================================================================

static void loadDefaults() {
  if (!prefs.isKey(KEY_WIFI_SSID))  prefs.putString(KEY_WIFI_SSID, DEFAULT_WIFI_SSID);
  if (!prefs.isKey(KEY_WIFI_PASS))  prefs.putString(KEY_WIFI_PASS, DEFAULT_WIFI_PASS);
  if (!prefs.isKey(KEY_MQTT_HOST))  prefs.putString(KEY_MQTT_HOST, DEFAULT_MQTT_HOST);
  if (!prefs.isKey(KEY_MQTT_PORT))  prefs.putUShort(KEY_MQTT_PORT, DEFAULT_MQTT_PORT);
  if (!prefs.isKey(KEY_SERVER_URL)) prefs.putString(KEY_SERVER_URL, DEFAULT_SERVER_URL);
}

static bool connectWiFi() {
  String ssid = prefs.getString(KEY_WIFI_SSID, DEFAULT_WIFI_SSID);
  String pass = prefs.getString(KEY_WIFI_PASS, DEFAULT_WIFI_PASS);

  if (ssid.isEmpty()) {
    Serial.println("[WiFi] No SSID configured — cannot connect");
    return false;
  }

  if (WiFi.status() == WL_CONNECTED) return true;

  Serial.printf("[WiFi] Connecting to %s ...\n", ssid.c_str());
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), pass.c_str());

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WiFi] Connected — IP: %s, RSSI: %d, channel: %u\n",
                  WiFi.localIP().toString().c_str(), WiFi.RSSI(), WiFi.channel());
    return true;
  }

  Serial.println("[WiFi] Connection failed");
  return false;
}

static bool doGeolocation(float& lat, float& lng) {
  Serial.println("[GEO] Querying ip-api.com for approximate location...");

  HTTPClient http;
  http.begin("http://ip-api.com/json/?fields=lat,lon,status");
  http.setTimeout(10000);

  int code = http.GET();
  if (code != 200) {
    Serial.printf("[GEO] HTTP error: %d\n", code);
    http.end();
    return false;
  }

  String body = http.getString();
  http.end();

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, body);
  if (err) {
    Serial.printf("[GEO] JSON parse error: %s\n", err.c_str());
    return false;
  }

  const char* status = doc["status"];
  if (!status || strcmp(status, "success") != 0) {
    Serial.println("[GEO] Geolocation API returned non-success status");
    return false;
  }

  lat = doc["lat"] | DEFAULT_LATITUDE;
  lng = doc["lon"] | DEFAULT_LONGITUDE;

  Serial.printf("[GEO] Approximate location: %.6f, %.6f\n", lat, lng);
  return true;
}

static bool postLocationToServer(float lat, float lng) {
  String serverUrl = prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL);
  String url = serverUrl + "/api/gateway/location";

  JsonDocument doc;
  doc["latitude"]  = lat;
  doc["longitude"] = lng;

  String body;
  serializeJson(doc, body);

  Serial.printf("[HTTP] POST %s → %s\n", url.c_str(), body.c_str());

  HTTPClient http;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  String resp = http.getString();
  http.end();

  Serial.printf("[HTTP] Response %d: %s\n", code, resp.c_str());
  return code == 200 || code == 201;
}

static void firstBootSequence() {
  Serial.println("\n===== FIRST BOOT SEQUENCE =====");

  float lat = DEFAULT_LATITUDE;
  float lng = DEFAULT_LONGITUDE;

  if (doGeolocation(lat, lng)) {
    prefs.putFloat(KEY_GW_LAT, lat);
    prefs.putFloat(KEY_GW_LNG, lng);
    Serial.println("[BOOT] Location stored to NVS flash");
  } else {
    lat = prefs.getFloat(KEY_GW_LAT, DEFAULT_LATITUDE);
    lng = prefs.getFloat(KEY_GW_LNG, DEFAULT_LONGITUDE);
    Serial.printf("[BOOT] Geolocation failed — using fallback: %.6f, %.6f\n", lat, lng);
  }

  bool posted = false;
  for (int attempt = 1; attempt <= LOCATION_POST_MAX_RETRY; attempt++) {
    Serial.printf("[BOOT] POST location to server (attempt %d/%d)...\n",
                  attempt, LOCATION_POST_MAX_RETRY);
    if (postLocationToServer(lat, lng)) {
      posted = true;
      break;
    }
    if (attempt < LOCATION_POST_MAX_RETRY) delay(2000);
  }

  if (posted) {
    Serial.println("[BOOT] Location successfully sent to server");
  } else {
    Serial.println("[BOOT] Failed to POST location — continuing anyway");
  }

  prefs.putBool(KEY_FIRST_BOOT, true);
  Serial.println("[BOOT] First boot sequence complete");
}

static bool connectMqtt() {
  if (mqttClient.connected()) return true;

  String host = prefs.getString(KEY_MQTT_HOST, DEFAULT_MQTT_HOST);
  uint16_t port = prefs.getUShort(KEY_MQTT_PORT, DEFAULT_MQTT_PORT);

  Serial.printf("[MQTT] Connecting to %s:%u ...\n", host.c_str(), port);
  mqttClient.setServer(host.c_str(), port);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setKeepAlive(60);

  uint8_t mac[6];
  String macStr = WiFi.macAddress();
  sscanf(macStr.c_str(), "%x:%x:%x:%x:%x:%x",
         &mac[0], &mac[1], &mac[2], &mac[3], &mac[4], &mac[5]);
  char clientId[32];
  snprintf(clientId, sizeof(clientId), "gw-%02X%02X%02X%02X%02X%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);

  if (mqttClient.connect(clientId)) {
    Serial.printf("[MQTT] Connected as %s\n", clientId);

    mqttClient.subscribe(TOPIC_ACK);
    mqttClient.subscribe(TOPIC_REGISTER);
    mqttClient.subscribe(TOPIC_UPDATE);

    Serial.println("[MQTT] Subscribed to:");
    Serial.printf("  %s  (InfluxDB write ack → ESP-NOW forward)\n", TOPIC_ACK);
    Serial.printf("  %s  (new tracker log)\n", TOPIC_REGISTER);
    Serial.printf("  %s  (tracker update log)\n", TOPIC_UPDATE);

    mqttConnected = true;
    return true;
  } else {
    Serial.printf("[MQTT] Connection failed — state: %d\n", mqttClient.state());
    mqttConnected = false;
    return false;
  }
}

static void initEspNow() {
  if (esp_now_init() != ESP_OK) {
    Serial.println("[ESP-NOW] Init failed — rebooting");
    ESP.restart();
  }

  esp_now_register_recv_cb(onEspNowRecv);

  Serial.printf("[ESP-NOW] Initialised (channel %u, role: receiver)\n", WiFi.channel());
}

static bool sendEspNowAck(const uint8_t* mac, uint32_t sleepTimeSec) {
  JsonDocument ackDoc;
  ackDoc["status"]         = "ok";
  ackDoc["sleep_time_sec"] = sleepTimeSec;

  String ackJson;
  serializeJson(ackDoc, ackJson);

  Serial.printf("[ESP-NOW] Sending ack to edge node: %s\n", ackJson.c_str());

  esp_err_t result = esp_now_send(mac, (const uint8_t*)ackJson.c_str(), ackJson.length());
  if (result != ESP_OK) {
    Serial.printf("[ESP-NOW] Failed to send ack — err: %d\n", result);
    return false;
  }
  return true;
}

static void processEspNowPacket(const QueuedPacket& pkt) {
  char macStr[18];
  snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
           pkt.senderMac[0], pkt.senderMac[1], pkt.senderMac[2],
           pkt.senderMac[3], pkt.senderMac[4], pkt.senderMac[5]);

  char jsonBuf[ESP_NOW_MAX_PAYLOAD + 1];
  memcpy(jsonBuf, pkt.data, pkt.length);
  jsonBuf[pkt.length] = '\0';

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, jsonBuf);
  if (err) {
    Serial.printf("[ESP-NOW] Invalid JSON from %s: %s\n", macStr, err.c_str());
    return;
  }

  if (!isPeerKnown(pkt.senderMac)) {
    addPeer(pkt.senderMac);
  }

  if (!doc["mac_address"].is<const char*>() ||
      !doc["tracker_id"].is<const char*>()  ||
      !doc["latitude"].is<float>()          ||
      !doc["longitude"].is<float>()         ||
      !doc["battery_mv"].is<int>()) {
    Serial.printf("[ESP-NOW] Payload from %s missing required fields — discarding\n", macStr);
    return;
  }

  Serial.printf("[ESP-NOW] Valid payload from %s: lat=%.6f lng=%.6f batt=%dmV rssi=%d\n",
                doc["tracker_id"].as<const char*>(),
                doc["latitude"].as<float>(),
                doc["longitude"].as<float>(),
                doc["battery_mv"].as<int>(),
                pkt.rssi);

  doc["rssi"] = pkt.rssi;

  if (!mqttClient.connected()) {
    Serial.println("[MQTT] Not connected — attempting reconnect...");
    connectMqtt();
    if (!mqttClient.connected()) {
      Serial.println("[MQTT] Reconnect failed — discarding packet");
      return;
    }
  }

  String outJson;
  serializeJson(doc, outJson);
  if (mqttClient.publish(TOPIC_DATA, outJson.c_str())) {
    Serial.printf("[MQTT] Published to %s: %s\n", TOPIC_DATA, outJson.c_str());
  } else {
    Serial.printf("[MQTT] Publish to %s failed\n", TOPIC_DATA);
  }
}

// ============================================================================
// 10. Setup & Loop
// ============================================================================

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n\n===== COW Gateway Node (ESP32 Dev Board) =====");

  prefs.begin(NVS_NS, false);
  loadDefaults();

  while (!connectWiFi()) {
    Serial.println("[WiFi] Retrying in 5 seconds...");
    delay(5000);
  }

  bool firstBootDone = prefs.getBool(KEY_FIRST_BOOT, false);
  if (!firstBootDone) {
    firstBootSequence();
  } else {
    Serial.println("[BOOT] Not first boot — skipping geolocation");
  }

  initEspNow();

  while (!connectMqtt()) {
    Serial.println("[MQTT] Retrying in 5 seconds...");
    delay(5000);
  }

  Serial.println("\n===== GATEWAY READY — entering main loop =====\n");
}

void loop() {
  if (!mqttClient.connected()) {
    unsigned long now = millis();
    if (now - lastMqttReconnectAttempt > 10000) {
      lastMqttReconnectAttempt = now;
      Serial.println("[MQTT] Connection lost — reconnecting...");
      connectMqtt();
    }
  }

  mqttClient.loop();

  QueuedPacket pkt;
  if (dequeuePacket(pkt)) {
    processEspNowPacket(pkt);
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Disconnected — reconnecting...");
    WiFi.reconnect();
    delay(5000);
  }

  delay(10);
}
