# Gateway Node — Process Flow

*Last updated: 2026-06-09*

## Overview

The gateway node (ESP32 Dev Board) runs continuously. It uses its built-in Wi-Fi radio for two purposes simultaneously: receiving data from edge nodes via **ESP-NOW**, and forwarding that data to the Mosquitto MQTT broker via **Wi-Fi STA**. On first boot it obtains its own location via Wi-Fi geolocation and stores it in flash. It then subscribes to server notification topics and enters the main loop — handling ESP-NOW packets from edge nodes and MQTT callbacks from the server concurrently.

---

## Flow Diagram

```
                        ┌─────────────────────┐
                        │  Boot / Initialize  │
                        │  - Wi-Fi STA        │
                        │  - ESP-NOW          │
                        │  - MQTT Client      │
                        └──────────┬──────────┘
                                   │
                                   ▼
                        ┌─────────────────────┐        ┌─────────────────┐
                        │  Connect to Wi-Fi   │  Fail  │  Retry until    │
                        │                     ├───────►│  Connected      │
                        └──────────┬──────────┘        └────────┬────────┘
                                   │ Connected                  │
                                   │◄───────────────────────────┘
                                   ▼
                        ┌─────────────────────┐
                        │  First Boot?        │  No
                        │  (NVS: gateway/     ├───────────────────────────┐
                        │  first_boot_done)   │
                        └──────────┬──────────┘                           │
                                   │ Yes                                  │
                                   ▼                                      │
                        ┌─────────────────────┐        ┌─────────────────┐
                        │  Get Location via   │  Fail  │  Retry / Skip   │
                        │  Wi-Fi Geolocation  ├───────►│  & Continue     │
                        └──────────┬──────────┘        └────────┬────────┘
                                   │ Success                     │
                                   ▼                             │
                        ┌─────────────────────┐                 │
                        │  Store Location     │                 │
                        │  to Flash           │                 │
                        └──────────┬──────────┘                 │
                                   │                             │
                                   ▼                             │
                        ┌─────────────────────┐        ┌─────────────────┐
                        │  POST Location to   │  Fail  │  Retry (max 3x) │
                        │  Server             ├───────►│  then continue  │
                        │  POST /api/gateway/ │        └────────┬────────┘
                        │  location           │                 │
                        └──────────┬──────────┘                 │
                                   │◄────────────────────────────┘
                                   │◄────────────────────────────────────┘
                                   ▼
                        ┌─────────────────────┐        ┌─────────────────┐
                        │  Connect to MQTT    │  Fail  │  Retry until    │
                        │  Broker             ├───────►│  Connected      │
                        └──────────┬──────────┘        └────────┬────────┘
                                   │ Connected                   │
                                   │◄────────────────────────────┘
                                   ▼
                        ┌─────────────────────────────────────┐
                        │  Register ESP-NOW Receive Callback  │
                        │  + Subscribe to MQTT Topics         │
                        │    - cow/tracker/ack                │
                        │    - cow/tracker/register            │
                        │    - cow/tracker/update              │
                        └──────────┬──────────────────────────┘
                                   │
                                   ▼
                        ┌──────────────────────────────────────────────────────────────┐
                        │                        MAIN LOOP                             │
                        │                                                              │
                        │   mqttClient.loop()  ◄──── processes incoming MQTT messages │
                        │         │                                                    │
                        │         ├── cow/tracker/ack received                        │
                        │         │       └── Parse mac_address + sleep_time_sec      │
                        │         │       └── Send ESP-NOW ack to edge node           │
                        │         │           (peer already registered)               │
                        │         │                                                    │
                        │         ├── cow/tracker/register received                    │
                        │         │       └── Log: new tracker registered              │
                        │         │                                                    │
                        │         └── cow/tracker/update received                      │
                        │                 └── Log: tracker info updated                │
                        │                                                              │
                        │   ESP-NOW OnDataReceived ◄──── fires in interrupt context   │
                        │         │                                                    │
                        │         └── Copy data to buffer → process in main loop ─┐  │
                        └─────────────────────────────────────────────────────────┼──┘
                                                                                  │
                                                                                  ▼
                        ┌─────────────────────┐
                        │  Parse Payload      │
                        │  - mac_address      │
                        │  - tracker_id        │
                        │  - latitude         │
                        │  - longitude        │
                        │  - battery_mv       │
                        └──────────┬──────────┘
                                   │
                                   ▼
                        ┌──────────────────────────┐
                        │  Register MAC as         │
                        │  ESP-NOW Peer            │
                        │  (if not already known)  │
                        └──────────┬───────────────┘
                                   │
                                   ▼
                        ┌─────────────────────┐        ┌─────────────────┐
                        │  Payload Valid?     │  No    │  Discard &      │
                        │                     ├───────►│  Log Error      │
                        └──────────┬──────────┘        └─────────────────┘
                                   │ Yes
                                   ▼
                        ┌─────────────────────┐        ┌─────────────────┐
                        │  MQTT Connected?    │  No    │  Reconnect to   │
                        │                     ├───────►│  MQTT Broker    │
                        └──────────┬──────────┘        └────────┬────────┘
                                   │ Yes                         │
                                   │◄────────────────────────────┘
                                   ▼
                        ┌─────────────────────┐
                        │  Publish to MQTT    │
                        │  cow/tracker/data   │
                        └──────────┬──────────┘
                                   │
                                   └──────────────────────► (back to MAIN LOOP)
```

---

## States

| State | Description |
|-------|-------------|
| Boot / Initialize | Start Wi-Fi STA, initialize ESP-NOW, initialize MQTT client. |
| Connect to Wi-Fi | Attempt Wi-Fi connection, retry until successful. |
| First Boot Check | Read NVS key `gateway/first_boot_done` — if absent or `0`, treat as first boot. Set to `1` after gateway coordinates are stored to flash. |
| Get Location via Wi-Fi | Use Wi-Fi geolocation API to obtain gateway latitude and longitude. |
| Store Location to Flash | Persist gateway coordinates to flash so this step is skipped on reboot. |
| POST Location to Server | Send gateway coordinates to server (`POST /api/gateway/location`). Server stores them for use when edge nodes register. |
| Connect to MQTT Broker | Establish connection to Mosquitto broker, retry until successful. |
| Register Callbacks | Register ESP-NOW `OnDataReceived` callback. Subscribe MQTT to `cow/tracker/ack`, `cow/tracker/register`, and `cow/tracker/update`. |
| Main Loop | Continuously calls `mqttClient.loop()` (processes MQTT callbacks). ESP-NOW packets are handled via the registered callback. |
| MQTT Callback — ack | Triggered when bridge publishes `cow/tracker/ack`. Parses `mac_address` and `sleep_time_sec`. The edge node MAC is already registered as a peer (done during packet processing). Sends `{"status":"ok","sleep_time_sec":N}` to the edge node via `esp_now_send()`. |
| MQTT Callback — register | Triggered when server publishes `cow/tracker/register`. Logs the newly registered tracker. |
| MQTT Callback — update | Triggered when server publishes `cow/tracker/update`. Logs the tracker info change. |
| ESP-NOW OnDataReceived | Fires in interrupt context when an edge node sends a packet. Must only copy the raw data into a queue or buffer — no processing, no `esp_now_add_peer()` calls in interrupt context. |
| Parse Payload | Dequeue buffered data in the main loop. Deserialize bytes into JSON fields (mac_address, tracker_id, latitude, longitude, battery_mv). |
| Register MAC as ESP-NOW Peer | Call `esp_now_add_peer()` for the sender's MAC address if it is not already in the peer list. Safe to call from the main loop. This ensures the peer is registered before the `cow/tracker/ack` callback fires. |
| Payload Valid? | Check all required fields are present and values are within range. |
| Publish to MQTT | Publish the parsed JSON payload to `cow/tracker/data`. |

---

## ESP-NOW Configuration

| Item | Details |
|------|---------|
| Role | Receiver (slave) — listens for packets from any registered edge node |
| Wi-Fi mode | `WIFI_STA` — connected to router; ESP-NOW runs on the same channel |
| Channel | Must match the router's Wi-Fi channel (set automatically after `WiFi.begin()`) |
| Receive callback | `OnDataReceived(mac_addr, data, len)` — fires on each incoming ESP-NOW packet |
| Sender registration | Edge node MACs are registered dynamically via `esp_now_add_peer()` in the main loop when the first packet from each tracker is processed — not in the interrupt callback |

> ESP-NOW and Wi-Fi STA can run simultaneously on ESP32. The ESP-NOW channel is tied to the Wi-Fi channel after `WiFi.begin()`. No additional hardware is needed.

---

## MQTT Topics

| Topic | Publisher | Subscriber(s) | Description |
|-------|-----------|---------------|-------------|
| `cow/tracker/data` | Gateway Node | Bridge, API | Normal operation — GPS and battery payload forwarded from edge node |
| `cow/tracker/ack` | Bridge | Gateway Node | Published after successful InfluxDB write — carries `sleep_time_sec`; gateway forwards to edge node via ESP-NOW |
| `cow/tracker/register` | API | Bridge, Gateway Node | Published after a new edge node registers — gateway logs the event |
| `cow/tracker/update` | API | Bridge, Gateway Node | Published after an edge node updates its tracker information — gateway logs the event |

---

## MQTT Callback Payloads

### `cow/tracker/ack` — received by gateway

Published by the bridge after a successful InfluxDB write. Carries `sleep_time_sec` set by the dashboard user. The gateway parses `mac_address` and `sleep_time_sec`, then sends the ack directly to the edge node — the MAC is already registered as an ESP-NOW peer from the earlier packet-processing step.

```json
{
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "tracker_id": "ESP-01",
  "sleep_time_sec": 15
}
```

**ESP-NOW ack packet sent by gateway to edge node:**

```json
{"status": "ok", "sleep_time_sec": 15}
```

---

### `cow/tracker/register` — received by gateway

Published by the server after a successful edge node registration.

```json
{
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "tracker_id": "ESP-01",
  "location": "Padang A",
  "initial_latitude": 1.856273,
  "initial_longitude": 103.756489,
  "registered_at": "2026-06-09T08:00:00Z"
}
```

### `cow/tracker/update` — received by gateway

Published by the server after a successful edge node information update.

```json
{
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "tracker_id": "ESP-01-B",
  "location": "Padang B",
  "updated_at": "2026-06-09T10:30:00Z"
}
```

### `cow/tracker/data` — published by gateway

```json
{
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "tracker_id": "ESP-01",
  "latitude": 1.856273,
  "longitude": 103.756489,
  "battery_mv": 3742
}
```

---

## Gateway Location Registration

On first boot, after storing its coordinates to flash, the gateway POSTs its location to the server. The server stores it and uses it as the initial position for any edge node that registers.

### Request — Gateway → Server

```
POST /gateway/location
```

```json
{
  "latitude": 1.856273,
  "longitude": 103.756489
}
```

### Response — Server → Gateway

```json
{
  "status": "success"
}
```

### How the Server Uses It

```
Edge Node  ──POST /api/trackers──►  Server
                                      │
                                      ├── reads stored gateway coordinates
                                      │
                                      └──► responds with initial_latitude + initial_longitude
```

---

## Notes

- The gateway node is mains-powered via USB and runs continuously with no sleep.
- ESP-NOW and Wi-Fi STA operate simultaneously using the same built-in Wi-Fi radio. No external wireless module is needed.
- `OnDataReceived` fires in interrupt context — it must only copy raw data into a queue or buffer. No parsing, no `esp_now_add_peer()`, no MQTT calls are safe here.
- ESP-NOW peer registration (`esp_now_add_peer()`) is called from the main loop when processing a buffered packet, after parsing the sender MAC. This guarantees the peer is registered before the `cow/tracker/ack` MQTT callback fires — eliminating any race condition between peer registration and `esp_now_send()`.
- `mqttClient.loop()` must be called every iteration of the main loop to process incoming MQTT messages.
- Wi-Fi and MQTT reconnection are handled automatically in the main loop.
- Invalid or malformed ESP-NOW packets are discarded and logged for debugging.
- When `cow/tracker/ack` is received, the peer is already registered. The gateway calls `esp_now_send()` with `{"status":"ok","sleep_time_sec":N}`. The `sleep_time_sec` value is read from the `trackers` SQLite table by the bridge and reflects the value set by the dashboard user on the Tracker Management page.
- The edge node waits briefly for this ack, then enters deep sleep regardless of whether the ack arrives (timeout fallback).
- `cow/tracker/register` and `cow/tracker/update` callbacks are informational — the gateway logs the event. No ESP-NOW transmission is triggered.
- **Multi-tracker concurrency:** In a typical field deployment each edge node wakes on its own independent sleep timer, so packets rarely arrive simultaneously. If two edge nodes do transmit at the same time, `OnDataReceived` buffers each packet into the queue in interrupt context; the main loop drains the queue sequentially — one packet per iteration. MQTT ack callbacks are similarly queued by `mqttClient.loop()` and processed one at a time. No packet is dropped by design, but back-to-back arrivals increase end-to-end latency for the second tracker by one loop iteration (typically a few milliseconds). For deployments with many trackers transmitting at identical intervals, stagger the sleep times on the Tracker Management page to avoid collisions.
