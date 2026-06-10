/*
 * Project COW — Edge Node Firmware (XIAO ESP32-C3)
 *
 * === Arduino IDE Setup ===
 * 1. Install ESP32 board package:
 *    File → Preferences → Additional Boards Manager URLs:
 *    https://espressif.github.io/arduino-esp32/package_esp32_index.json
 *    Tools → Board → Boards Manager → "esp32" → Install
 * 2. Select board: Tools → Board → ESP32 → "XIAO_ESP32C3"
 * 3. Install libraries (Tools → Manage Libraries):
 *    - ArduinoJson  by Benoit Blanchon  (v7.x)
 *    - TinyGPSPlus  by Mikal Hart        (v1.x)
 *
 * Three operating modes:
 *   1. First Time Operation  — power-on with no registration in NVS
 *   2. Normal Operation      — timer wakeup from deep sleep
 *   3. Information Update    — button (GPIO2) press wakeup
 *
 * See docs/edge_node_process_flow.md and docs/edge_node_payloads.md
 */

#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <Preferences.h>
#include <TinyGPSPlus.h>
#include <ArduinoJson.h>

// ============================================================================
// 1. Pin Mapping (XIAO ESP32-C3)
// ============================================================================

#define GPS_RX_PIN   20   // D6 — GPS module TX
#define GPS_TX_PIN   21   // D7 — GPS module RX
#define GPS_POWER_PIN 3   // D1 — GPS module VCC control (high = on)
#define BATTERY_ADC  A0   // A0 / GPIO0 — battery voltage divider
#define BUTTON_PIN    2   // D0 — external wakeup (button to GND)

// ============================================================================
// 2. Compile-Time Defaults (overridden by NVS once configured)
// ============================================================================

#define DEFAULT_USERNAME      "admin"
#define DEFAULT_PASSWORD      "admin@1234"
#define DEFAULT_SLEEP_SEC     15
#define DEFAULT_GPS_TIMEOUT   60        // seconds to wait for GPS fix
#define DEFAULT_ACK_TIMEOUT   5000      // ms to wait for ESP-NOW ack
#define DEFAULT_WIFI_CHANNEL  1
#define DEFAULT_GW_MAC        "FF:FF:FF:FF:FF:FF"  // placeholder
#define DEFAULT_SERVER_URL    "http://192.168.1.100:3000"
#define DEFAULT_WIFI_SSID     ""
#define DEFAULT_WIFI_PASS     ""

// Battery voltage divider: Vout = Vbat * R2/(R1+R2)
// ratio = Vbat / Vout = (R1+R2)/R2
#define VOLTAGE_DIVIDER_RATIO 2.0f
#define ADC_REF_VOLTAGE       3.3f
#define ADC_MAX               4095.0f

// ESP-NOW max retry for delivery failures
#define ESP_NOW_MAX_RETRY 3

// ============================================================================
// 3. NVS Key Names (max 15 chars per Preferences limit)
// ============================================================================

static const char* NVS_NS = "cow";

// Registration state
static const char* KEY_REGISTERED  = "registered";    // bool
static const char* KEY_TRACKER_ID  = "tracker_id";    // string
static const char* KEY_LOCATION    = "location";      // string
static const char* KEY_USERNAME    = "username";      // string
static const char* KEY_PASSWORD    = "password";      // string

// Coordinates
static const char* KEY_INITIAL_LAT = "init_lat";      // float (from registration)
static const char* KEY_INITIAL_LNG = "init_lng";      // float
static const char* KEY_LAST_LAT    = "gps_last_lat";  // float (last successful fix)
static const char* KEY_LAST_LNG    = "gps_last_lng";  // float

// Sleep & network
static const char* KEY_SLEEP_SEC   = "sleep_sec";     // uint32_t
static const char* KEY_GW_MAC      = "gw_mac";        // string "AA:BB:CC:DD:EE:FF"
static const char* KEY_WIFI_CHAN   = "wifi_chan";     // uint8_t
static const char* KEY_SERVER_URL  = "server_url";    // string
static const char* KEY_WIFI_SSID   = "wifi_ssid";     // string
static const char* KEY_WIFI_PASS   = "wifi_pass";     // string

// ============================================================================
// 4. Global State
// ============================================================================

Preferences prefs;
TinyGPSPlus gps;
WebServer server(80);

// ESP-NOW state
static uint8_t gwMacBytes[6];
static bool     espNowDeliveryConfirmed = false;
static bool     espNowAckReceived = false;
static uint32_t receivedSleepSec = 0;

// GPS data captured
static float    gpsLatitude  = 0.0;
static float    gpsLongitude = 0.0;
static uint16_t batteryMv    = 0;

// ============================================================================
// 5. Forward Declarations (Arduino IDE auto-generates, kept for clarity)
// ============================================================================

static void firstTimeOperation();
static void normalOperation();
static void informationUpdate();
static bool connectWiFiSta();
static void disconnectWiFi();
static bool parseMacString(const char* str, uint8_t* out);
static String getOwnMacString();
static float readBatteryVoltage();
static bool waitForGpsFix(uint32_t timeoutSec);
static bool postRegistration(const String& trackerId, const String& location);
static bool patchUpdate(const String& trackerId, const String& location);
static void enterDeepSleep(uint32_t sleepSec);

// ============================================================================
// 6. ESP-NOW Callbacks
// ============================================================================

static void onDataSent(const uint8_t* mac_addr, esp_now_send_status_t status) {
  espNowDeliveryConfirmed = true;
  if (status == ESP_NOW_SEND_SUCCESS) {
    Serial.println("[ESP-NOW] Delivery confirmed by MAC layer");
  } else {
    Serial.println("[ESP-NOW] Delivery failed at MAC layer");
  }
}

static void onDataRecv(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
  Serial.printf("[ESP-NOW] Received %d bytes from ", len);
  for (int i = 0; i < 6; i++) {
    Serial.printf("%02X", info->src_addr[i]);
    if (i < 5) Serial.print(":");
  }
  Serial.println();

  // Parse the ack JSON: {"status":"ok","sleep_time_sec":N}
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, data, len);
  if (err) {
    Serial.printf("[ESP-NOW] Ack parse error: %s\n", err.c_str());
    return;
  }

  const char* status = doc["status"];
  if (status && strcmp(status, "ok") == 0) {
    receivedSleepSec = doc["sleep_time_sec"] | DEFAULT_SLEEP_SEC;
    espNowAckReceived = true;
    Serial.printf("[ESP-NOW] Ack received — sleep_time_sec = %u\n", receivedSleepSec);
  }
}

// ============================================================================
// 7. Utility Functions
// ============================================================================

static void loadNvsDefaults() {
  if (!prefs.isKey(KEY_USERNAME))    prefs.putString(KEY_USERNAME, DEFAULT_USERNAME);
  if (!prefs.isKey(KEY_PASSWORD))    prefs.putString(KEY_PASSWORD, DEFAULT_PASSWORD);
  if (!prefs.isKey(KEY_SLEEP_SEC))   prefs.putUInt(KEY_SLEEP_SEC, DEFAULT_SLEEP_SEC);
  if (!prefs.isKey(KEY_GW_MAC))      prefs.putString(KEY_GW_MAC, DEFAULT_GW_MAC);
  if (!prefs.isKey(KEY_WIFI_CHAN))   prefs.putUChar(KEY_WIFI_CHAN, DEFAULT_WIFI_CHANNEL);
  if (!prefs.isKey(KEY_SERVER_URL))  prefs.putString(KEY_SERVER_URL, DEFAULT_SERVER_URL);
  if (!prefs.isKey(KEY_WIFI_SSID))   prefs.putString(KEY_WIFI_SSID, DEFAULT_WIFI_SSID);
  if (!prefs.isKey(KEY_WIFI_PASS))   prefs.putString(KEY_WIFI_PASS, DEFAULT_WIFI_PASS);
}

static bool parseMacString(const char* str, uint8_t* out) {
  int values[6];
  if (sscanf(str, "%x:%x:%x:%x:%x:%x",
             &values[0], &values[1], &values[2],
             &values[3], &values[4], &values[5]) != 6) {
    return false;
  }
  for (int i = 0; i < 6; i++) out[i] = (uint8_t)values[i];
  return true;
}


static String getOwnMacString() {
  return WiFi.macAddress();
}

static float readBatteryVoltage() {
  int raw = analogRead(BATTERY_ADC);
  float vout = (raw / ADC_MAX) * ADC_REF_VOLTAGE;
  float vbat = vout * VOLTAGE_DIVIDER_RATIO;
  return vbat;
}

static bool connectWiFiSta() {
  String ssid = prefs.getString(KEY_WIFI_SSID, DEFAULT_WIFI_SSID);
  String pass = prefs.getString(KEY_WIFI_PASS, DEFAULT_WIFI_PASS);

  if (ssid.isEmpty()) {
    Serial.println("[WiFi] No SSID configured — cannot connect");
    return false;
  }

  Serial.printf("[WiFi] Connecting to %s ...\n", ssid.c_str());
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), pass.c_str());

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    uint8_t actualChan = WiFi.channel();
    prefs.putUChar(KEY_WIFI_CHAN, actualChan);
    Serial.printf("[WiFi] Connected — IP: %s, channel: %u\n",
                  WiFi.localIP().toString().c_str(), actualChan);
    return true;
  } else {
    Serial.println("[WiFi] Connection failed");
    return false;
  }
}

static void disconnectWiFi() {
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  delay(200);
}

static void initEspNow() {
  WiFi.mode(WIFI_STA);
  if (esp_now_init() != ESP_OK) {
    Serial.println("[ESP-NOW] Init failed — rebooting");
    ESP.restart();
  }

  esp_now_register_send_cb(onDataSent);
  esp_now_register_recv_cb(onDataRecv);

  uint8_t chan = prefs.getUChar(KEY_WIFI_CHAN, DEFAULT_WIFI_CHANNEL);
  esp_wifi_set_channel(chan, WIFI_SECOND_CHAN_NONE);
  Serial.printf("[ESP-NOW] Initialised on channel %u\n", chan);
}

static bool registerEspNowPeer() {
  String macStr = prefs.getString(KEY_GW_MAC, DEFAULT_GW_MAC);
  if (!parseMacString(macStr.c_str(), gwMacBytes)) {
    Serial.println("[ESP-NOW] Invalid gateway MAC in NVS");
    return false;
  }

  esp_now_peer_info_t peerInfo;
  if (esp_now_is_peer_exist(gwMacBytes)) {
    Serial.printf("[ESP-NOW] Peer %s already registered\n", macStr.c_str());
    return true;
  }

  memset(&peerInfo, 0, sizeof(peerInfo));
  memcpy(peerInfo.peer_addr, gwMacBytes, 6);
  peerInfo.channel = prefs.getUChar(KEY_WIFI_CHAN, DEFAULT_WIFI_CHANNEL);
  peerInfo.encrypt = false;

  esp_err_t result = esp_now_add_peer(&peerInfo);
  if (result != ESP_OK) {
    Serial.printf("[ESP-NOW] Failed to add peer %s — err: %d\n", macStr.c_str(), result);
    return false;
  }

  Serial.printf("[ESP-NOW] Peer %s registered\n", macStr.c_str());
  return true;
}

static bool waitForGpsFix(uint32_t timeoutSec) {
  Serial.printf("[GPS] Waiting for fix (max %u s) ...\n", timeoutSec);
  unsigned long start = millis();
  while (millis() - start < timeoutSec * 1000UL) {
    while (Serial1.available()) {
      char c = Serial1.read();
      gps.encode(c);
    }
    if (gps.location.isValid() && gps.location.age() < 2000) {
      gpsLatitude  = gps.location.lat();
      gpsLongitude = gps.location.lng();
      Serial.printf("[GPS] Fix acquired: %.6f, %.6f\n", gpsLatitude, gpsLongitude);
      return true;
    }
    delay(100);
  }
  Serial.println("[GPS] Fix timeout");
  return false;
}

static bool sendEspNowPayload(const String& trackerId, float lat, float lng, uint16_t battMv) {
  JsonDocument doc;
  doc["mac_address"] = getOwnMacString();
  doc["tracker_id"]  = trackerId;
  doc["latitude"]    = lat;
  doc["longitude"]   = lng;
  doc["battery_mv"]  = battMv;

  String jsonStr;
  serializeJson(doc, jsonStr);
  Serial.printf("[ESP-NOW] Sending: %s\n", jsonStr.c_str());

  espNowDeliveryConfirmed = false;

  for (int retry = 0; retry < ESP_NOW_MAX_RETRY; retry++) {
    esp_err_t result = esp_now_send(gwMacBytes, (const uint8_t*)jsonStr.c_str(), jsonStr.length());
    if (result != ESP_OK) {
      Serial.printf("[ESP-NOW] Send error %d (attempt %d)\n", result, retry + 1);
      delay(100);
      continue;
    }
    unsigned long sendStart = millis();
    while (!espNowDeliveryConfirmed && millis() - sendStart < 1000) {
      delay(10);
    }
    if (espNowDeliveryConfirmed) {
      return true;
    }
    Serial.printf("[ESP-NOW] No delivery callback (attempt %d), retrying...\n", retry + 1);
  }
  Serial.println("[ESP-NOW] All retries exhausted");
  return false;
}

static bool waitForEspNowAck(uint32_t timeoutMs) {
  espNowAckReceived = false;
  unsigned long start = millis();
  while (!espNowAckReceived && millis() - start < timeoutMs) {
    delay(50);
  }
  return espNowAckReceived;
}

static bool postRegistration(const String& trackerId, const String& location) {
  String serverUrl = prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL);
  String url = serverUrl + "/api/trackers";
  String ownMac = getOwnMacString();
  String username = prefs.getString(KEY_USERNAME, DEFAULT_USERNAME);
  String password = prefs.getString(KEY_PASSWORD, DEFAULT_PASSWORD);

  JsonDocument reqDoc;
  reqDoc["mac_address"] = ownMac;
  reqDoc["tracker_id"]  = trackerId;
  reqDoc["location"]    = location;
  reqDoc["username"]    = username;
  reqDoc["password"]    = password;

  String reqBody;
  serializeJson(reqDoc, reqBody);

  Serial.printf("[HTTP] POST %s → %s\n", url.c_str(), reqBody.c_str());

  HTTPClient http;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(reqBody);

  if (code <= 0) {
    Serial.printf("[HTTP] POST failed: %s\n", http.errorToString(code).c_str());
    http.end();
    return false;
  }

  String respBody = http.getString();
  http.end();

  Serial.printf("[HTTP] Response %d: %s\n", code, respBody.c_str());

  if (code != 200 && code != 201) return false;

  JsonDocument respDoc;
  DeserializationError err = deserializeJson(respDoc, respBody);
  if (err) {
    Serial.printf("[HTTP] JSON parse error: %s\n", err.c_str());
    return false;
  }

  const char* status = respDoc["status"];
  if (!status || strcmp(status, "success") != 0) return false;

  prefs.putString(KEY_TRACKER_ID, respDoc["tracker_id"] | trackerId);
  prefs.putString(KEY_LOCATION,   respDoc["location"]   | location);
  prefs.putFloat(KEY_INITIAL_LAT, respDoc["initial_latitude"]  | 0.0f);
  prefs.putFloat(KEY_INITIAL_LNG, respDoc["initial_longitude"] | 0.0f);
  prefs.putBool(KEY_REGISTERED, true);

  Serial.println("[HTTP] Registration successful — stored to NVS");
  return true;
}

static bool patchUpdate(const String& trackerId, const String& location) {
  String serverUrl = prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL);
  String ownMac     = getOwnMacString();
  String username   = prefs.getString(KEY_USERNAME, DEFAULT_USERNAME);
  String password   = prefs.getString(KEY_PASSWORD, DEFAULT_PASSWORD);
  String url = serverUrl + "/api/trackers/" + ownMac;

  JsonDocument reqDoc;
  reqDoc["mac_address"] = ownMac;
  reqDoc["tracker_id"]  = trackerId;
  reqDoc["location"]    = location;
  reqDoc["username"]    = username;
  reqDoc["password"]    = password;

  String reqBody;
  serializeJson(reqDoc, reqBody);

  Serial.printf("[HTTP] PATCH %s → %s\n", url.c_str(), reqBody.c_str());

  HTTPClient http;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  int code = http.sendRequest("PATCH", reqBody);

  if (code <= 0) {
    Serial.printf("[HTTP] PATCH failed: %s\n", http.errorToString(code).c_str());
    http.end();
    return false;
  }

  String respBody = http.getString();
  http.end();

  Serial.printf("[HTTP] Response %d: %s\n", code, respBody.c_str());

  if (code != 200) return false;

  JsonDocument respDoc;
  DeserializationError err = deserializeJson(respDoc, respBody);
  if (err) {
    Serial.printf("[HTTP] JSON parse error: %s\n", err.c_str());
    return false;
  }

  const char* status = respDoc["status"];
  if (!status || strcmp(status, "success") != 0) return false;

  prefs.putString(KEY_TRACKER_ID, respDoc["tracker_id"] | trackerId);
  prefs.putString(KEY_LOCATION,   respDoc["location"]   | location);

  Serial.println("[HTTP] Update successful — stored to NVS");
  return true;
}

static void enterDeepSleep(uint32_t sleepSec) {
  uint64_t sleepUs = (uint64_t)sleepSec * 1000000ULL;
  Serial.printf("[SLEEP] Entering deep sleep for %u seconds\n", sleepSec);

  esp_sleep_enable_timer_wakeup(sleepUs);
  esp_sleep_enable_ext0_wakeup((gpio_num_t)BUTTON_PIN, 0);

  Serial.flush();
  delay(100);
  esp_deep_sleep_start();
}

// ============================================================================
// 8. Web Server HTML Pages
// ============================================================================

static const char HTML_HEAD[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>COW Tracker</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 400px;
         margin: 20px auto; padding: 0 16px; background: #f5f5f5; color: #333; }
  h2 { color: #1a73e8; }
  .card { background: #fff; border-radius: 8px; padding: 20px;
          box-shadow: 0 1px 3px rgba(0,0,0,.12); margin-bottom: 16px; }
  label { display: block; font-weight: 600; margin-top: 12px; font-size: 14px; }
  input, select { width: 100%; padding: 10px; margin-top: 4px; border: 1px solid #ddd;
                  border-radius: 6px; font-size: 16px; box-sizing: border-box; }
  input[readonly] { background: #e9ecef; color: #666; }
  button { width: 100%; padding: 12px; background: #1a73e8; color: #fff;
           border: none; border-radius: 6px; font-size: 16px; font-weight: 600;
           margin-top: 16px; cursor: pointer; }
  button:hover { background: #1557b0; }
  .error { background: #fce8e6; color: #c5221f; padding: 10px; border-radius: 6px;
           margin-top: 12px; font-size: 14px; }
  .section-title { font-size: 12px; color: #999; text-transform: uppercase;
                   letter-spacing: 1px; margin-top: 16px; border-top: 1px solid #eee;
                   padding-top: 12px; }
</style>
</head>
<body>
)rawliteral";

static const char HTML_FOOT[] PROGMEM = R"rawliteral(
</body>
</html>
)rawliteral";

// --- Login Page ---
static void handleLogin() {
  String html = FPSTR(HTML_HEAD);
  html += R"rawliteral(
<div class="card">
  <h2>COW Tracker Login</h2>
  <form method="POST" action="/login">
    <label>Username</label>
    <input type="text" name="username" required>
    <label>Password</label>
    <input type="password" name="password" required>
    <button type="submit">Login</button>
  </form>
)rawliteral";

  if (server.hasArg("error")) {
    html += "<div class=\"error\">Invalid credentials</div>";
  }

  html += "</div>";
  html += FPSTR(HTML_FOOT);
  server.send(200, "text/html", html);
}

static void handleLoginPost() {
  String user = server.arg("username");
  String pass = server.arg("password");
  String storedUser = prefs.getString(KEY_USERNAME, DEFAULT_USERNAME);
  String storedPass = prefs.getString(KEY_PASSWORD, DEFAULT_PASSWORD);

  if (user == storedUser && pass == storedPass) {
    server.sendHeader("Location", "/form", true);
    server.send(302, "text/plain", "");
  } else {
    server.sendHeader("Location", "/?error=1", true);
    server.send(302, "text/plain", "");
  }
}

// --- Registration Form ---
static void handleForm() {
  String ownMac = getOwnMacString();
  String currentTracker = prefs.getString(KEY_TRACKER_ID, "");
  String currentLocation = prefs.getString(KEY_LOCATION, "");
  String currentSsid     = prefs.getString(KEY_WIFI_SSID, "");
  String currentPass     = prefs.getString(KEY_WIFI_PASS, "");
  String currentServer   = prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL);

  String html = FPSTR(HTML_HEAD);
  html += R"rawliteral(
<div class="card">
  <h2>Tracker Registration</h2>
  <form method="POST" action="/submit">
    <label>MAC Address (auto-detected)</label>
    <input type="text" name="mac_address" value=")rawliteral";
  html += ownMac;
  html += R"rawliteral(" readonly>

    <label>Tracker ID</label>
    <input type="text" name="tracker_id" value=")rawliteral";
  html += currentTracker;
  html += R"rawliteral(" required>

    <label>Location</label>
    <input type="text" name="location" value=")rawliteral";
  html += currentLocation;
  html += R"rawliteral(" required>

    <div class="section-title">Network Configuration</div>

    <label>Wi-Fi SSID</label>
    <input type="text" name="wifi_ssid" value=")rawliteral";
  html += currentSsid;
  html += R"rawliteral(">

    <label>Wi-Fi Password</label>
    <input type="password" name="wifi_pass" value=")rawliteral";
  html += currentPass;
  html += R"rawliteral(">

    <label>Server URL</label>
    <input type="text" name="server_url" value=")rawliteral";
  html += currentServer;
  html += R"rawliteral(" placeholder="http://192.168.1.100:3000">

    <div class="section-title">Change Credentials (optional)</div>

    <label>New Username</label>
    <input type="text" name="new_username" placeholder="Leave blank to keep current">

    <label>New Password</label>
    <input type="password" name="new_password" placeholder="Leave blank to keep current">

    <button type="submit">Register Tracker</button>
  </form>
)rawliteral";

  if (server.hasArg("error")) {
    html += "<div class=\"error\">Registration failed — check server URL and network, then retry</div>";
  }

  html += "</div>";
  html += FPSTR(HTML_FOOT);
  server.send(200, "text/html", html);
}

// --- Update Form ---
static void handleUpdateForm() {
  String ownMac = getOwnMacString();
  String currentTracker = prefs.getString(KEY_TRACKER_ID, "");
  String currentLocation = prefs.getString(KEY_LOCATION, "");
  String currentSsid     = prefs.getString(KEY_WIFI_SSID, "");
  String currentPass     = prefs.getString(KEY_WIFI_PASS, "");
  String currentServer   = prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL);

  String html = FPSTR(HTML_HEAD);
  html += R"rawliteral(
<div class="card">
  <h2>Tracker Update</h2>
  <form method="POST" action="/submit-update">
    <label>MAC Address</label>
    <input type="text" value=")rawliteral";
  html += ownMac;
  html += R"rawliteral(" readonly>

    <label>Tracker ID</label>
    <input type="text" name="tracker_id" value=")rawliteral";
  html += currentTracker;
  html += R"rawliteral(" required>

    <label>Location</label>
    <input type="text" name="location" value=")rawliteral";
  html += currentLocation;
  html += R"rawliteral(" required>

    <div class="section-title">Network Configuration</div>

    <label>Wi-Fi SSID</label>
    <input type="text" name="wifi_ssid" value=")rawliteral";
  html += currentSsid;
  html += R"rawliteral(">

    <label>Wi-Fi Password</label>
    <input type="password" name="wifi_pass" value=")rawliteral";
  html += currentPass;
  html += R"rawliteral(">

    <label>Server URL</label>
    <input type="text" name="server_url" value=")rawliteral";
  html += currentServer;
  html += R"rawliteral(">

    <div class="section-title">Change Credentials (optional)</div>

    <label>New Username</label>
    <input type="text" name="new_username" placeholder="Leave blank to keep current">

    <label>New Password</label>
    <input type="password" name="new_password" placeholder="Leave blank to keep current">

    <button type="submit">Update Tracker</button>
  </form>
)rawliteral";

  if (server.hasArg("error")) {
    html += "<div class=\"error\">Update failed — check server URL and network, then retry</div>";
  }

  html += "</div>";
  html += FPSTR(HTML_FOOT);
  server.send(200, "text/html", html);
}

// --- Form Submission (Registration) ---
static void handleSubmit() {
  String trackerId  = server.arg("tracker_id");
  String location   = server.arg("location");
  String newUser    = server.arg("new_username");
  String newPass    = server.arg("new_password");
  String wifiSsid   = server.arg("wifi_ssid");
  String wifiPass   = server.arg("wifi_pass");
  String serverUrl  = server.arg("server_url");

  if (!wifiSsid.isEmpty())   prefs.putString(KEY_WIFI_SSID, wifiSsid);
  if (!wifiPass.isEmpty())   prefs.putString(KEY_WIFI_PASS, wifiPass);
  if (!serverUrl.isEmpty())  prefs.putString(KEY_SERVER_URL, serverUrl);

  server.stop();
  WiFi.mode(WIFI_OFF);
  delay(200);

  if (connectWiFiSta()) {
    bool ok = postRegistration(trackerId, location);
    disconnectWiFi();

    if (ok) {
      if (!newUser.isEmpty()) prefs.putString(KEY_USERNAME, newUser);
      if (!newPass.isEmpty()) prefs.putString(KEY_PASSWORD, newPass);

      String html = FPSTR(HTML_HEAD);
      html += "<div class=\"card\"><h2>Registration Successful</h2>";
      html += "<p>Tracker <strong>" + trackerId + "</strong> registered.</p>";
      html += "<p>Location: <strong>" + location + "</strong></p>";
      html += "<p>MAC: <strong>" + getOwnMacString() + "</strong></p>";
      html += "<p>Device will enter deep sleep shortly.</p></div>";
      html += FPSTR(HTML_FOOT);
      server.send(200, "text/html", html);

      delay(3000);
      uint32_t sleepSec = prefs.getUInt(KEY_SLEEP_SEC, DEFAULT_SLEEP_SEC);
      enterDeepSleep(sleepSec);
      return;
    }
  }

  WiFi.mode(WIFI_AP);
  WiFi.softAP("COW-Tracker-Setup");
  server.begin();
  server.sendHeader("Location", "/form?error=1", true);
  server.send(302, "text/plain", "");
}

// --- Form Submission (Update) ---
static void handleSubmitUpdate() {
  String trackerId  = server.arg("tracker_id");
  String location   = server.arg("location");
  String newUser    = server.arg("new_username");
  String newPass    = server.arg("new_password");
  String wifiSsid   = server.arg("wifi_ssid");
  String wifiPass   = server.arg("wifi_pass");
  String serverUrl  = server.arg("server_url");

  if (!wifiSsid.isEmpty())   prefs.putString(KEY_WIFI_SSID, wifiSsid);
  if (!wifiPass.isEmpty())   prefs.putString(KEY_WIFI_PASS, wifiPass);
  if (!serverUrl.isEmpty())  prefs.putString(KEY_SERVER_URL, serverUrl);

  server.stop();
  WiFi.mode(WIFI_OFF);
  delay(200);

  if (connectWiFiSta()) {
    bool ok = patchUpdate(trackerId, location);
    disconnectWiFi();

    if (ok) {
      if (!newUser.isEmpty()) prefs.putString(KEY_USERNAME, newUser);
      if (!newPass.isEmpty()) prefs.putString(KEY_PASSWORD, newPass);

      String html = FPSTR(HTML_HEAD);
      html += "<div class=\"card\"><h2>Update Successful</h2>";
      html += "<p>Tracker <strong>" + trackerId + "</strong> updated.</p>";
      html += "<p>Location: <strong>" + location + "</strong></p>";
      html += "<p>Device will enter deep sleep shortly.</p></div>";
      html += FPSTR(HTML_FOOT);
      server.send(200, "text/html", html);

      delay(3000);
      uint32_t sleepSec = prefs.getUInt(KEY_SLEEP_SEC, DEFAULT_SLEEP_SEC);
      enterDeepSleep(sleepSec);
      return;
    }
  }

  WiFi.mode(WIFI_AP);
  WiFi.softAP("COW-Tracker-Setup");
  server.begin();
  server.sendHeader("Location", "/update?error=1", true);
  server.send(302, "text/plain", "");
}

// ============================================================================
// 9. Operating Modes
// ============================================================================

static void firstTimeOperation() {
  Serial.println("\n===== FIRST TIME OPERATION =====");

  WiFi.mode(WIFI_AP);
  WiFi.softAP("COW-Tracker-Setup");
  Serial.printf("[AP] SSID: COW-Tracker-Setup, IP: %s\n", WiFi.softAPIP().toString().c_str());

  server.on("/",            handleLogin);
  server.on("/login",       HTTP_POST, handleLoginPost);
  server.on("/form",        handleForm);
  server.on("/submit",      HTTP_POST, handleSubmit);
  server.on("/update",      handleUpdateForm);
  server.on("/submit-update", HTTP_POST, handleSubmitUpdate);

  server.onNotFound([]() {
    server.sendHeader("Location", "/", true);
    server.send(302, "text/plain", "");
  });

  server.begin();
  Serial.println("[WEB] HTTP server started on port 80");

  while (true) {
    server.handleClient();
    delay(10);
  }
}

static void normalOperation() {
  Serial.println("\n===== NORMAL OPERATION =====");

  String trackerId = prefs.getString(KEY_TRACKER_ID, "");
  if (trackerId.isEmpty()) {
    Serial.println("[ERROR] No tracker_id in NVS — falling back to first-time operation");
    firstTimeOperation();
    return;
  }

  Serial1.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  pinMode(GPS_POWER_PIN, OUTPUT);

  initEspNow();
  if (!registerEspNowPeer()) {
    Serial.println("[ERROR] Cannot register ESP-NOW peer — sleeping anyway");
    uint32_t sleepSec = prefs.getUInt(KEY_SLEEP_SEC, DEFAULT_SLEEP_SEC);
    enterDeepSleep(sleepSec);
    return;
  }

  analogSetAttenuation(ADC_11db);
  float vbat = readBatteryVoltage();
  batteryMv = (uint16_t)(vbat * 1000.0f);
  Serial.printf("[BATT] Voltage: %.3f V (%u mV)\n", vbat, batteryMv);

  digitalWrite(GPS_POWER_PIN, HIGH);
  delay(200);

  uint32_t gpsTimeout = DEFAULT_GPS_TIMEOUT;
  bool hasFix = waitForGpsFix(gpsTimeout);

  if (hasFix) {
    prefs.putFloat(KEY_LAST_LAT, gpsLatitude);
    prefs.putFloat(KEY_LAST_LNG, gpsLongitude);
    Serial.printf("[GPS] Stored to NVS: %.6f, %.6f\n", gpsLatitude, gpsLongitude);
  } else {
    float lastLat = prefs.getFloat(KEY_LAST_LAT, NAN);
    float lastLng = prefs.getFloat(KEY_LAST_LNG, NAN);

    if (!isnan(lastLat) && !isnan(lastLng)) {
      gpsLatitude  = lastLat;
      gpsLongitude = lastLng;
      Serial.printf("[GPS] Using last known coords from NVS: %.6f, %.6f\n", gpsLatitude, gpsLongitude);
    } else {
      float initLat = prefs.getFloat(KEY_INITIAL_LAT, 0.0f);
      float initLng = prefs.getFloat(KEY_INITIAL_LNG, 0.0f);
      gpsLatitude  = initLat;
      gpsLongitude = initLng;
      Serial.printf("[GPS] Using initial registration coords: %.6f, %.6f\n", gpsLatitude, gpsLongitude);
    }
  }

  digitalWrite(GPS_POWER_PIN, LOW);
  Serial1.end();

  sendEspNowPayload(trackerId, gpsLatitude, gpsLongitude, batteryMv);

  uint32_t sleepSec = prefs.getUInt(KEY_SLEEP_SEC, DEFAULT_SLEEP_SEC);

  if (waitForEspNowAck(DEFAULT_ACK_TIMEOUT)) {
    prefs.putUInt(KEY_SLEEP_SEC, receivedSleepSec);
    sleepSec = receivedSleepSec;
    Serial.printf("[ACK] Stored sleep_time_sec=%u to NVS\n", receivedSleepSec);
  } else {
    Serial.printf("[ACK] Timeout — using NVS fallback: %u s\n", sleepSec);
  }

  enterDeepSleep(sleepSec);
}

static void informationUpdate() {
  Serial.println("\n===== INFORMATION UPDATE =====");

  WiFi.mode(WIFI_AP);
  WiFi.softAP("COW-Tracker-Setup");
  Serial.printf("[AP] SSID: COW-Tracker-Setup, IP: %s\n", WiFi.softAPIP().toString().c_str());

  server.on("/",            handleLogin);
  server.on("/login",       HTTP_POST, handleLoginPost);
  server.on("/form",        handleUpdateForm);
  server.on("/submit",      HTTP_POST, handleSubmitUpdate);
  server.on("/update",      handleUpdateForm);
  server.on("/submit-update", HTTP_POST, handleSubmitUpdate);

  server.onNotFound([]() {
    server.sendHeader("Location", "/", true);
    server.send(302, "text/plain", "");
  });

  server.begin();
  Serial.println("[WEB] HTTP server started on port 80");

  while (true) {
    server.handleClient();
    delay(10);
  }
}

// ============================================================================
// 10. Entry Point
// ============================================================================

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n\n===== COW Edge Node (XIAO ESP32-C3) =====");

  esp_sleep_wakeup_cause_t wakeCause = esp_sleep_get_wakeup_cause();

  Serial.printf("[BOOT] Wake cause: %d", wakeCause);
  switch (wakeCause) {
    case ESP_SLEEP_WAKEUP_UNDEFINED: Serial.println(" (power-on / reset)"); break;
    case ESP_SLEEP_WAKEUP_TIMER:     Serial.println(" (timer)");            break;
    case ESP_SLEEP_WAKEUP_EXT0:      Serial.println(" (button GPIO)");     break;
    default:                         Serial.printf(" (other: %d)\n", wakeCause); break;
  }

  prefs.begin(NVS_NS, false);
  loadNvsDefaults();

  bool isRegistered = prefs.getBool(KEY_REGISTERED, false);
  Serial.printf("[NVS] Registered: %s\n", isRegistered ? "true" : "false");

  if (wakeCause == ESP_SLEEP_WAKEUP_TIMER) {
    normalOperation();
  } else if (wakeCause == ESP_SLEEP_WAKEUP_EXT0) {
    informationUpdate();
  } else {
    if (isRegistered) {
      normalOperation();
    } else {
      firstTimeOperation();
    }
  }
}

void loop() {
  delay(1000);
}
