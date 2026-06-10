# CLAUDE.md — Project COW

*Last updated: 2026-06-10*

## Project Summary

GPS livestock tracker. An edge node (XIAO ESP32-C3) reads GPS and battery voltage, transmits the data via ESP-NOW to a gateway node (ESP32 Dev Board), which forwards it to a Mosquitto MQTT broker over Wi-Fi. A dedicated Node.js bridge service subscribes to `cow/tracker/data`, validates trackers against SQLite, and writes GPS and battery data to InfluxDB. The API subscribes to the same topic independently for SSE delivery to the dashboard. Tracker registration and updates are handled directly via HTTP from the edge node to the API, which persists the data in SQLite. A web dashboard (Next.js) visualises live tracker locations, historical tracks, and manages farms, cows, trackers, and users.

---

## Folder Structure

```
cow/
├── esp32/
│   ├── edge_node/           # XIAO ESP32-C3 firmware
│   │   └── src/
│   │       └── main.cpp
│   └── gateway_node/        # ESP32 Dev Board firmware
│       └── src/
│           └── main.cpp
├── mosquitto/
│   └── config/
│       └── mosquitto.conf
├── influxdb/
│   └── config/
├── bridge/                  # MQTT → InfluxDB data bridge
│   └── src/
│       ├── index.ts
│       ├── influxdb.ts
│       └── db.ts
├── web/                     # Dashboard frontend (Next.js)
├── api/                     # REST API + SSE server
│   └── src/
│       ├── routes/
│       │   └── trackers.ts   # Tracker registration + management
│       └── services/
│           └── db.ts         # SQLite (auto-creates all tables)
├── docker-compose.yml
└── docs/
    ├── setup.md
    ├── edge_node_process_flow.md
    ├── edge_node_payloads.md
    ├── gateway_node_process_flow.md
    ├── data_bridge.md
    ├── dashboard.md
    ├── services.md
    ├── security.md
    └── Issues.md
```

---

## Architecture

```
[Edge Node: XIAO ESP32-C3 + GPS]
        │  ESP-NOW
        ▼
[Gateway Node: ESP32 Dev Board]
        │  MQTT (Wi-Fi)  cow/tracker/data
        ▼
[Docker: Mosquitto]
        │
        ├──► [Bridge: bridge/src/index.ts] ──validate SQLite──► [InfluxDB]
        │         └── write success ──► publish cow/tracker/ack
        │                                  └──► [Gateway] ──ESP-NOW──► [Edge Node → sleep]
        │
        └──► [API: api/src/mqtt/client.ts] ──► [SSE]   (real-time dashboard push)

[Edge Node]     ──HTTP POST──►  [API /api/trackers/register]   ──► [SQLite: trackers]
[Edge Node]     ──HTTP PATCH──► [API /api/trackers/:mac]       ──► [SQLite: trackers]
                                                                     └──► publish cow/tracker/register / cow/tracker/update

[Gateway Node]  ──HTTP POST──►  [API /api/gateway/location]   ──► [SQLite: gateway_location]
```

---

## Components

### Edge Node (`esp32/edge_node/`)

- **Hardware:** Seeed Studio XIAO ESP32-C3 + GPS module (NEO-6M/NEO-M8N)
- **Three operating modes:**
  - **First Time Operation** — triggered on power-on with no registration in flash. Starts Wi-Fi AP + HTTP web server. User logs in (default: `admin` / `admin@1234`), fills registration form (tracker ID, location; MAC auto-populated), optionally changes credentials. POSTs to `/api/trackers/register`. Waits for server response (notification with initial lat/long). Stores all to flash (NVS). Enters deep sleep.
  - **Normal Operation** — timer wakeup from deep sleep. Reads battery voltage (ADC), reads GPS (NMEA over UART), builds payload, transmits via ESP-NOW to gateway MAC, checks `OnDataSent` callback, waits for ESP-NOW ack from gateway (carries `sleep_time_sec` set by dashboard user), stores sleep time to flash, enters deep sleep for `sleep_time_sec` seconds.
  - **Information Update** — button press wakeup. Starts Wi-Fi AP + HTTP web server. User logs in, fills update form (tracker ID, location only; optional credential change). PATCHes `/api/trackers/:mac_address`. Waits for server response (notification with confirmed tracker info). Stores updated info to flash. Enters deep sleep.
- **Deep sleep wakeup sources:** RTC timer (normal) / GPIO button interrupt (update)
- **Credentials** stored in flash (NVS). Default: `admin` / `admin@1234`. User can change via web form.

### Gateway Node (`esp32/gateway_node/`)

- **Hardware:** ESP32 Dev Board (WROOM-32) — uses built-in Wi-Fi radio for ESP-NOW and MQTT
- **Always on** (mains-powered via USB)
- **First boot:** connects Wi-Fi → gets own location via Wi-Fi geolocation API → stores to flash → POSTs coordinates to `POST /api/gateway/location`
- **On MQTT connect:** subscribes to `cow/tracker/register` and `cow/tracker/update` to receive server notifications
- **Main loop:** calls `mqttClient.loop()` (processes MQTT callbacks) + handles ESP-NOW `OnDataReceived` callback → parses → validates → publishes to `cow/tracker/data`
- **MQTT callbacks:** on `cow/tracker/ack` — sends `{"status":"ok","sleep_time_sec":N}` to the edge node via ESP-NOW so it knows how long to sleep next cycle; logs receipt of `cow/tracker/register` and `cow/tracker/update`

### Docker Services

| Service | Image / Build | Port | Description |
|---------|--------------|------|-------------|
| Mosquitto | `eclipse-mosquitto:latest` | `1883` | MQTT broker |
| InfluxDB | `influxdb:2.7` | `8086` | Time-series database |
| Bridge | `./bridge` | — | MQTT → InfluxDB data bridge |
| API | `./api` | `3000` | REST API + SSE server |
| Web | `./web` | `80` | Next.js dashboard (proxies `/api/*` to API) |

### Bridge (`bridge/`)

- **Tech stack:** Node.js + TypeScript, `mqtt.js` v5, `@influxdata/influxdb3-client`, `better-sqlite3`
- Subscribes to `cow/tracker/data`, validates tracker in SQLite, writes to InfluxDB, publishes `cow/tracker/ack`
- Shares the `api_data` Docker volume (read-write) with the API
- If SQLite is not yet available on startup, allows tracker data through (graceful fallback)
- No HTTP server, no REST endpoints — purely event-driven

### API (`api/`)

- **Tech stack:** Express 4 + TypeScript, `better-sqlite3`, `mqtt.js` v5, `@influxdata/influxdb3-client`, JWT (`jsonwebtoken` + `bcryptjs`)
- REST API + SSE server
- On startup subscribes to `cow/tracker/data` → validates → emits SSE (InfluxDB writes handled by bridge)
- Manages SQLite for tracker registry, farms, cows, geofences, alerts
- Edge nodes register/update directly via HTTP: `POST /api/trackers/register`, `PATCH /api/trackers/:mac_address`
- Gateway POSTs its coordinates on first boot: `POST /api/gateway/location`
- Default port: `3000`

### Web (`web/`)

- **Tech stack:** Next.js 14 (App Router) + TypeScript, Leaflet.js, Materio Bootstrap
- Real-time map: live tracker markers, 10 s polling + SSE per tracker, farm boundary overlays
- Historical location: GPS polyline replay by date
- Real-time data table: live scrolling MQTT data feed
- Management pages: Farms, Cows, Trackers, Users (Admin only)
- External URL: `http://localhost:80`

---

## MQTT Topics

| Topic | Publisher | Subscriber(s) | Description |
|-------|-----------|---------------|-------------|
| `cow/tracker/data` | Gateway Node | Bridge (→ InfluxDB + ack) + API (→ SSE) | GPS + battery data |
| `cow/tracker/ack` | Bridge | Gateway Node (→ ESP-NOW ack to edge node) | Published after successful InfluxDB write; carries `sleep_time_sec` from Tracker Management |
| `cow/tracker/register` | API | Gateway (→ log) | Published after edge node registers |
| `cow/tracker/update` | API | Gateway (→ log) | Published after edge node info update |

---

## Key JSON Payloads

### ESP-NOW / MQTT — Normal Operation (`cow/tracker/data`)

```json
{
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "tracker_id": "ESP-01",
  "latitude": 1.856273,
  "longitude": 103.756489,
  "battery_mv": 3742
}
```

### Edge Node → API — Registration (`POST /api/trackers/register`)

```json
{
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "tracker_id": "ESP-01",
  "location": "Padang A",
  "username": "admin",
  "password": "admin@1234"
}
```

### API → Edge Node — Registration Success

```json
{
  "status": "success",
  "tracker_id": "ESP-01",
  "location": "Padang A",
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "initial_latitude": 1.856273,
  "initial_longitude": 103.756489,
  "registered_at": "2026-06-09T08:00:00Z"
}
```

### Edge Node → API — Information Update (`PATCH /api/trackers/:mac_address`)

```json
{
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "tracker_id": "ESP-01-B",
  "location": "Padang B",
  "username": "admin2",
  "password": "newpass@5678"
}
```

### API → Edge Node — Update Success

```json
{
  "status": "success",
  "tracker_id": "ESP-01-B",
  "location": "Padang B",
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "updated_at": "2026-06-09T10:30:00Z"
}
```

### Bridge → Gateway Node — Ack (`cow/tracker/ack`)

```json
{
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "tracker_id": "ESP-01",
  "sleep_time_sec": 15
}
```

### Gateway Node → Edge Node — ESP-NOW Ack

```json
{
  "status": "ok",
  "sleep_time_sec": 15
}
```

### Gateway → API — Location (`POST /api/gateway/location`)

```json
{
  "latitude": 1.856273,
  "longitude": 103.756489
}
```

---

## SQLite Tables

Managed by `api/src/services/db.ts` — all tables are auto-created on API startup.

| Table | Description |
|-------|-------------|
| `users` | Dashboard login accounts (JWT auth) |
| `farms` | Farm records with centre coordinates |
| `farm_points` | GPS boundary polygon points per farm |
| `cows` | Livestock records, linked to farms and trackers |
| `trackers` | Tracker hardware — self-registered by edge node or added via dashboard; holds `sleep_time_sec`, `status`, `assigned_cow_id` |
| `geofences` | Named geographic zones (Polygon / Circle) |
| `geofence_assignments` | Links geofences to cows or globally |
| `alerts` | Geofence breach and low-battery alert log |
| `system_settings` | Key-value config store |
| `gateway_location` | Single-row table — gateway node GPS coordinates |

### `trackers` table columns

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PRIMARY KEY | Auto-increment |
| `mac_address` | TEXT UNIQUE | Tracker hardware identifier |
| `tracker_id` | TEXT | Human-readable tracker name |
| `board_id` | TEXT | Board identifier (defaults to `tracker_id`) |
| `location` | TEXT | Physical location description |
| `initial_latitude` | REAL | Initial latitude from gateway |
| `initial_longitude` | REAL | Initial longitude from gateway |
| `sleep_time_sec` | INTEGER DEFAULT 15 | Deep sleep duration delivered to edge node via `cow/tracker/ack` |
| `battery_threshold` | INTEGER DEFAULT 20 | Battery level (%) for low-battery alert |
| `status` | TEXT DEFAULT 'Inactive' | `Active` / `Inactive` / `Maintenance` |
| `assigned_cow_id` | INTEGER UNIQUE (FK → cows) | Cow this tracker is attached to |
| `registered_at` | TEXT | ISO 8601 registration timestamp |
| `updated_at` | TEXT | ISO 8601 last update timestamp |

---

## InfluxDB Schema

- **Bucket:** `cow`
- **Measurement:** `tracker`
- **Tags:** `tracker_id`, `mac_address`
- **Fields:** `latitude` (float), `longitude` (float), `battery_mv` (integer)

---

## Default Credentials

| Service | Username | Password | Notes |
|---------|----------|----------|-------|
| InfluxDB | `admin` | `admin@1234` | Token: `cow-super-secret-token`, Org: `cow_org` |
| Dashboard (seeded) | `admin` | `Admin@1234` | Role: Admin |
| Dashboard (seeded) | `johndoe` | `User@1234` | Role: User |
| Edge node web form | `admin` | `admin@1234` | Stored in NVS flash, changeable via web form |

---

## Key Pin Assignments

### Edge Node — XIAO ESP32-C3

| Pin | Connected To |
|-----|-------------|
| D7 (TX) | GPS RX |
| D6 (RX) | GPS TX |
| A0 (ADC) | Battery voltage divider |

> ESP-NOW uses the built-in Wi-Fi radio — no SPI module wiring required.

### Gateway Node — ESP32 Dev Board

No external GPIO wiring required. The gateway uses the built-in Wi-Fi radio for both ESP-NOW (receive from edge nodes) and Wi-Fi STA (MQTT to broker).

---

## Documentation

| File | Description |
|------|-------------|
| `docs/setup.md` | Hardware list, wiring tables, folder structure, data flow |
| `docs/edge_node_process_flow.md` | Edge node flow diagrams for all three operating modes |
| `docs/edge_node_payloads.md` | Full JSON payload reference for edge node |
| `docs/gateway_node_process_flow.md` | Gateway node flow diagram, MQTT topics, gateway location registration |
| `docs/data_bridge.md` | Docker services, Node.js MQTT bridge, tracker registration flow |
| `docs/dashboard.md` | Dashboard requirements, UI layout, pages, API endpoints, tech stack |
| `docs/services.md` | All service URLs, credentials, ports, volumes, quick start commands |
| `docs/security.md` | Current security posture and production hardening checklist |
| `docs/Issues.md` | Documentation audit — 27 issues reviewed and resolved |
