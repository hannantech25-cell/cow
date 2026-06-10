# Project Setup — GPS ESP-NOW Tracker to InfluxDB

*Last updated: 2026-06-09*

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
├── bridge/                  # MQTT → InfluxDB / SQLite data bridge
├── web/                     # Dashboard frontend (Next.js)
├── api/                     # REST API + SSE server
│   └── database.sqlite      # SQLite — non-time-relative data
├── docker-compose.yml
└── docs/
    ├── setup.md
    ├── edge_node_process_flow.md
    ├── edge_node_payloads.md
    ├── gateway_node_process_flow.md
    ├── data_bridge.md
    ├── dashboard.md
    ├── services.md
    └── security.md
```

---

## Architecture Overview

```
[Edge Node: XIAO ESP32-C3 + GPS]
        │  ESP-NOW
        ▼
[Gateway Node: ESP32 Dev Board]
        │  MQTT (Wi-Fi)  cow/tracker/data
        ▼
[Docker: Mosquitto]
        │
        ├──► [Bridge: Node.js] ──validate SQLite──► [InfluxDB]
        │         └── write success ──► publish cow/tracker/ack
        │                                  └──► [Gateway] ──ESP-NOW──► [Edge Node → sleep]
        │
        └──► [API: SSE] ──► [Web Dashboard]   (real-time dashboard push)

[Edge Node]    ──HTTP POST──►  [API /api/trackers]           ──► [SQLite]
[Edge Node]    ──HTTP PATCH──► [API /api/trackers/:mac]      ──► [SQLite]
                                                                  └──► publish cow/tracker/register / cow/tracker/update

[Gateway Node] ──HTTP POST──►  [API /api/gateway/location]  ──► [SQLite: gateway_location]
```

---

## Hardware List

### Edge Node (XIAO ESP32-C3)

| # | Component | Description |
|---|-----------|-------------|
| 1 | Seeed Studio XIAO ESP32-C3 | Microcontroller — compact, low-power, built-in Wi-Fi (used for ESP-NOW) |
| 2 | GPS Module (e.g. NEO-6M / NEO-M8N) | Provides NMEA GPS data (lat, lon) |
| 3 | GPS Ceramic/Active Antenna | Improves GPS signal acquisition |
| 4 | LiPo Battery (3.7V, e.g. 1000mAh) | Powers the edge node in the field |
| 5 | Breadboard / Custom PCB | Prototyping or final deployment base |
| 6 | Jumper Wires / Header Pins | Wiring connections |

> ESP-NOW uses the XIAO ESP32-C3's built-in Wi-Fi radio — no external wireless module required.

### Gateway Node (ESP32 Dev Board)

| # | Component | Description |
|---|-----------|-------------|
| 1 | ESP32 Dev Board (e.g. ESP32-WROOM-32 DevKit v1) | Gateway node — receives ESP-NOW data and forwards via MQTT over Wi-Fi |
| 2 | USB Micro/Type-C Cable | Powering and flashing the gateway node |
| 3 | Breadboard / Jumper Wires | Wiring connections |

> The gateway uses its built-in Wi-Fi radio for both ESP-NOW reception and MQTT over Wi-Fi. No external wireless module required.

---

## Software / Infrastructure

| Component | Role |
|-----------|------|
| Arduino IDE / PlatformIO | Firmware development for edge node and gateway node |
| Mosquitto MQTT Broker | Receives MQTT messages from the gateway node |
| Docker (docker-compose.yml) | Hosts all services (Mosquitto, InfluxDB, Bridge, API, Web) as containers |
| Bridge (Node.js) | Subscribes to MQTT topics, writes to InfluxDB and SQLite |
| API (Node.js / Express) | REST API + SSE — serves dashboard, handles tracker registration |
| InfluxDB | Time-series database for storing GPS telemetry (runs in Docker) |
| SQLite | Lightweight database for non-time-relative data (tracker registry, configuration) |
| Web Dashboard (Next.js) | Browser-based dashboard for visualising GPS tracks and tracker status |

---

## Wiring Overview

### Edge Node — XIAO ESP32-C3 → GPS Module (UART)

| XIAO ESP32-C3 Pin | GPS Module Pin |
|-------------------|----------------|
| 3V3               | VCC            |
| GND               | GND            |
| D7 (TX)           | RX             |
| D6 (RX)           | TX             |

> Adjust TX/RX pins based on your chosen software serial or hardware UART configuration.

### Edge Node — XIAO ESP32-C3 → Battery (ADC)

| XIAO ESP32-C3 Pin | Connected To |
|-------------------|--------------|
| A0 (ADC)          | Battery voltage divider (mid-point) |
| GND               | GND |

> Use a resistor voltage divider to scale the LiPo voltage (max 4.2 V) down to the ADC input range (max 3.3 V).

### Gateway Node

No external GPIO wiring required. The gateway uses the ESP32's built-in Wi-Fi radio for both ESP-NOW (receiving from edge nodes) and Wi-Fi STA (connecting to router for MQTT).

---

## Data Flow

1. GPS module sends NMEA sentences to the edge node (XIAO ESP32-C3) over UART.
2. Edge node parses GPS data, builds a JSON payload, and transmits it to the gateway via **ESP-NOW** (using the built-in Wi-Fi radio).
3. Gateway node (ESP32 Dev Board) receives the ESP-NOW packet and publishes it to the Mosquitto broker via **MQTT over Wi-Fi**.
4. Mosquitto delivers the `cow/tracker/data` message concurrently to two independent subscribers:

   - **Bridge:** validates the tracker in SQLite → writes the GPS record to InfluxDB → publishes `cow/tracker/ack` → the gateway receives it and sends an ESP-NOW acknowledgement to the edge node → the edge node stores the new `sleep_time_sec` and enters deep sleep.
   - **API:** emits a real-time SSE event → the web dashboard updates the live map and data table.

5. Tracker registration and updates are sent directly from the edge node (via its Wi-Fi AP) to the API over HTTP; the API saves to SQLite, responds to the edge node (the edge node stores the response and enters deep sleep), and publishes an MQTT notification.
