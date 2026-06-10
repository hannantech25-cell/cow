# Data Bridge

*Last updated: 2026-06-09*

## Overview

The data bridge is a dedicated Node.js service (`bridge/`) that sits between the Mosquitto MQTT broker and the storage layer. It subscribes to `cow/tracker/data`, validates incoming payloads against the SQLite tracker registry, writes GPS and battery records to InfluxDB, then publishes `cow/tracker/ack` — which the gateway uses to send an ESP-NOW acknowledgement back to the edge node so it can enter deep sleep.

Tracker registration and updates bypass the bridge entirely — the edge node communicates directly with the API over HTTP, and the API persists to SQLite then publishes an outgoing MQTT notification.

The API (`api/src/mqtt/client.ts`) also subscribes to `cow/tracker/data` independently, but only to emit SSE events for the real-time dashboard. All InfluxDB writes are handled by the bridge.

---

## Architecture

```
[Gateway Node] --MQTT cow/tracker/data--> [Mosquitto]
                                               │
                            ┌──────────────────┴──────────────────┐
                            ▼                                       ▼
                  [Bridge service]                           [API mqtt/client.ts]
                  bridge/src/index.ts                        (SSE delivery only)
                       │
                  validate via SQLite
                       │
                       ▼
                  [InfluxDB]  (GPS + battery time-series)
                       │
                  write success
                       │
                       ▼
              publish cow/tracker/ack --> [Mosquitto] --> [Gateway Node]
                                                                │
                                                         send ESP-NOW ack
                                                                │
                                                                ▼
                                                         [Edge Node] → deep sleep

[Edge Node] --HTTP POST  /api/trackers--> [API] --> [SQLite]  (registration)
                                                       └──► publish cow/tracker/register
[Edge Node] --HTTP PATCH /api/trackers/:mac--> [API] --> [SQLite]  (update)
                                                             └──► publish cow/tracker/update
```

---

## Docker Services

| Service | Image / Build | Port | Description |
|---------|--------------|------|-------------|
| Mosquitto | `eclipse-mosquitto:latest` | `1883` | MQTT broker |
| InfluxDB | `influxdb:2.7` | `8086` | Time-series database |
| Bridge | `./bridge` | — | MQTT → InfluxDB data bridge |
| API | `./api` | `3000` | REST API + SSE server |
| Web | `./web` | `80` | Next.js dashboard |

---

## Bridge — `bridge/src/`

### File structure

```
bridge/
├── src/
│   ├── index.ts      # MQTT client, message routing, graceful shutdown
│   ├── influxdb.ts   # InfluxDB client singleton
│   └── db.ts         # SQLite client (tracker validation, upsert, update)
├── package.json
├── tsconfig.json
├── Dockerfile
└── .env.example
```

### `cow/tracker/data` handler

On each message received:

1. Parse JSON payload
2. Validate `mac_address` and `tracker_id` are present
3. Look up `mac_address` in SQLite `trackers` table — discard if not registered
4. Write `tracker` measurement to InfluxDB
5. On successful write, read `sleep_time_sec` from the `trackers` table by `mac_address` (falls back to 15 s if no tracker record exists)
6. Publish `cow/tracker/ack` with `{mac_address, tracker_id, sleep_time_sec}` so the gateway can forward the sleep time to the edge node via ESP-NOW

If SQLite is not yet available (e.g., API still initialising on first boot), the bridge allows all data through and writes to InfluxDB without tracker validation.

**InfluxDB write:**

| Property | Value |
|----------|-------|
| Measurement | `tracker` |
| Tag: `tracker_id` | from payload |
| Tag: `mac_address` | from payload |
| Field: `latitude` | float |
| Field: `longitude` | float |
| Field: `battery_mv` | integer |
| Timestamp | server receive time |

> GPS coordinates are timestamped at broker receipt by the bridge. The edge node has no RTC or NTP and has no concept of absolute time. Under normal Wi-Fi conditions MQTT delivery latency is typically under 1 second, making timestamps accurate enough for livestock tracking. Delayed or queued packets (e.g., during a broker outage followed by reconnect) will carry timestamps that reflect broker receipt time rather than GPS reading time. The historical location feature relies on these timestamps for track replay — extended delivery delays will distort the playback timeline.

### SQLite access

The bridge mounts the `api_data` Docker volume at `/app/data` in read-write mode. Both the API and bridge access the same SQLite file. SQLite WAL mode (enabled by the API on startup) serialises concurrent writes safely — the bridge validates tracker registration, upserts on `cow/tracker/register`, and updates on `cow/tracker/update`.

---

## MQTT Topics

| Topic | Publisher | Subscriber(s) | Description |
|-------|-----------|---------------|-------------|
| `cow/tracker/data` | Gateway Node | Bridge (→ InfluxDB + ack) + API (→ SSE) | GPS + battery payload |
| `cow/tracker/ack` | Bridge | Gateway Node | Published after successful InfluxDB write — carries `sleep_time_sec`; gateway forwards it to the edge node via ESP-NOW |
| `cow/tracker/register` | API | Bridge (→ SQLite upsert) + Gateway (→ log) | Published after edge node registers |
| `cow/tracker/update` | API | Bridge (→ SQLite update) + Gateway (→ log) | Published after edge node info update |

---

## Tracker Registration Flow

The edge node talks to the API over HTTP. The API writes to SQLite synchronously (so the response is immediate), then publishes an MQTT notification. The bridge receives the notification and performs an idempotent write to SQLite.

### Registration

1. Edge node → `POST /api/trackers` (mac_address, tracker_id, location)
2. API reads `gateway_location` from SQLite → gets initial coordinates
3. API writes to SQLite `trackers` table
4. **API responds to edge node** with `{status, tracker_id, location, mac_address, initial_latitude, initial_longitude, registered_at}` — this response is the notification that tells the edge node registration was persisted; the edge node stores it to flash and enters deep sleep
5. API publishes `cow/tracker/register` to MQTT (fire-and-forget)
6. Bridge receives `cow/tracker/register` → upserts record in SQLite `trackers` table

### Update

1. Edge node → `PATCH /api/trackers/:mac_address` (tracker_id, location)
2. API updates SQLite `trackers` table
3. **API responds to edge node** with `{status, tracker_id, location, mac_address, updated_at}` — this response is the notification that tells the edge node the update was persisted; the edge node stores the confirmed values to flash and enters deep sleep
4. API publishes `cow/tracker/update` to MQTT (fire-and-forget)
5. Bridge receives `cow/tracker/update` → updates record in SQLite `trackers` table

> The API's direct SQLite write ensures the tracker record exists before any MQTT interaction. The MQTT publish is fire-and-forget and does not delay the HTTP response to the edge node. The bridge's write is idempotent — safe even if the record already exists. The edge node does not sleep until it receives the HTTP success response from the API.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MQTT_PROTOCOL` | `mqtt` | MQTT protocol |
| `MQTT_HOST` | `localhost` | MQTT broker hostname |
| `MQTT_PORT` | `1883` | MQTT broker port |
| `MQTT_USERNAME` | — | Optional MQTT username |
| `MQTT_PASSWORD` | — | Optional MQTT password |
| `INFLUX_HOST` | `localhost` | InfluxDB hostname |
| `INFLUX_PORT` | `8086` | InfluxDB port |
| `INFLUX_TOKEN` | — | InfluxDB auth token |
| `INFLUX_DATABASE` | `cow` | InfluxDB bucket/database |
| `DB_PATH` | `/app/data/database.sqlite` | Path to SQLite file |

---

## MQTT Payload — `cow/tracker/data`

```json
{
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "tracker_id": "ESP-01",
  "latitude": 1.856273,
  "longitude": 103.756489,
  "battery_mv": 3742
}
```

## MQTT Payload — `cow/tracker/ack`

Published by the bridge after each successful InfluxDB write. The `sleep_time_sec` value is read from the `trackers` table in SQLite by `mac_address`. Dashboard users set this value on the Tracker Management page. Falls back to `15` seconds — matching the `trackers` table default — if no tracker record exists for the tracker.

```json
{
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "tracker_id": "ESP-01",
  "sleep_time_sec": 15
}
```

---

## SQLite Schema

### `trackers` table — used for tracker validation

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PRIMARY KEY | Auto-increment |
| `mac_address` | TEXT UNIQUE | Tracker hardware identifier |
| `tracker_id` | TEXT | Human-readable tracker name |
| `location` | TEXT | Physical location description |
| `initial_latitude` | REAL | Initial latitude from gateway |
| `initial_longitude` | REAL | Initial longitude from gateway |
| `registered_at` | TEXT | ISO 8601 registration timestamp |
| `updated_at` | TEXT | ISO 8601 last update timestamp |

### `trackers` table — used for `sleep_time_sec` lookup

The bridge queries this table to determine how long the edge node should sleep after each data transmission. Records are created and managed by dashboard users on the Tracker Management page, then linked to a cow and a physical tracker by MAC address.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PRIMARY KEY | Auto-increment |
| `board_id` | TEXT NOT NULL UNIQUE | Human-readable tracker board identifier assigned by the dashboard user |
| `mac_address` | TEXT NOT NULL UNIQUE | Tracker MAC address — matches `trackers.mac_address` |
| `assigned_cow_id` | INTEGER | FK → `cows.id`; the cow this tracker is attached to (nullable) |
| `sleep_time_sec` | INTEGER DEFAULT 15 | Deep sleep duration in seconds, delivered to the edge node via `cow/tracker/ack` |
| `battery_threshold` | INTEGER DEFAULT 20 | Battery level (%) below which a low-battery alert is triggered |
| `status` | TEXT DEFAULT 'Inactive' | `Active` / `Inactive` / `Maintenance` |
| `created_at` | TEXT | ISO 8601 creation timestamp |
| `updated_at` | TEXT | ISO 8601 last update timestamp |

---

## Tracker Lifecycle

A single `trackers` table stores all tracker data. Registration and management operate on the same record.

### Onboarding

```
1. Edge node powers on → Registration Mode
   └── POSTs to /api/trackers/register → record created in `trackers` table
   └── Status defaults to 'Inactive', sleep_time_sec defaults to 15 s

2. Dashboard user opens Tracker Management → sees all registered trackers
   └── Can edit sleep_time_sec, battery_threshold, toggle status to Active
   └── Can assign tracker to a cow

3. Bridge reads sleep_time_sec from `trackers` on each data packet
   └── Falls back to 15 s if no record exists
```

> A tracker transmits data and has GPS recorded in InfluxDB as soon as it's registered. Defaults: status = Inactive, sleep_time_sec = 15 s, battery_threshold = 20%.

---

## InfluxDB Schema

- **Bucket:** `cow`
- **Measurement:** `tracker`
- **Tags:** `tracker_id`, `mac_address`
- **Fields:** `latitude` (float), `longitude` (float), `battery_mv` (integer)

---

## Notes

- The bridge and API both subscribe to `cow/tracker/data`. The bridge writes to InfluxDB and publishes `cow/tracker/ack`; the API emits SSE. Each subscriber handles its own responsibility independently.
- `cow/tracker/ack` is published only after a successful InfluxDB write. If the write fails, no ack is published and the edge node falls through to its timeout and sleeps anyway.
- The `api_data` Docker volume is shared between `api` (read/write) and `bridge` (read/write). SQLite WAL mode (enabled by the API on startup) serialises concurrent writes safely.
- The bridge depends on `api` starting first so the SQLite file and `trackers` table exist before the bridge tries to open them.
- The bridge subscribes to all three inbound MQTT topics. `cow/tracker/data` is routed to InfluxDB (then ack published); `cow/tracker/register` and `cow/tracker/update` are routed to SQLite.
- The API's direct SQLite write always happens before the MQTT publish, so the tracker record exists before the bridge receives the notification. The bridge's write is idempotent (upsert / update) and safe to run after the API has already written.

---

## Resilience & Error Handling

The system is designed so that each component fails gracefully without blocking. The edge node always enters deep sleep regardless of whether the full pipeline succeeds.

### Failure Scenarios

| Scenario | Affected Components | Outcome | GPS Data Lost? |
|----------|---------------------|---------|----------------|
| InfluxDB unavailable or write fails | Bridge, edge node | Bridge does not publish `cow/tracker/ack`. Edge node times out, reads `sleep_time_sec` from NVS flash, enters deep sleep. | Yes — record for that cycle |
| Bridge crashes after InfluxDB write but before ack publish | Bridge, edge node | GPS record already safely written. Edge node times out and sleeps using NVS flash sleep value. Bridge restarts and resumes on next packet. | No |
| Bridge crashes during `cow/tracker/register` or `cow/tracker/update` handling | Bridge | API has already written to SQLite and responded to the edge node. Edge node is registered and asleep. Bridge's secondary upsert/update is missed but the API write is authoritative. | No |
| Bridge starts before API (SQLite not yet initialised) | Bridge, tracker validation | Bridge allows all `cow/tracker/data` through without tracker validation. GPS data is still written to InfluxDB. Once API starts and creates tables, bridge reconnects to SQLite normally. | No |
| MQTT broker (Mosquitto) unavailable | Gateway, bridge, API | Gateway MQTT client retries until reconnected. ESP-NOW packets are buffered in the gateway queue. Bridge and API receive nothing until the broker recovers. Packets that overflow the queue before reconnect are lost. | Yes — packets during outage |
| API unavailable during edge node registration | Edge node, API | Edge node retries the HTTP POST. It does not enter deep sleep until it receives a success response. Field worker must wait for the API to recover or restart the edge node. | N/A — no GPS data yet |
| Gateway loses Wi-Fi or MQTT connection | Gateway, edge node | Gateway main loop reconnects automatically. Buffered ESP-NOW packets are published on reconnect. Edge node may time out waiting for ack if the reconnect takes longer than the ack wait window, causing it to fall back to NVS flash sleep value. | Possible — timeout path |
| Edge node ESP-NOW delivery fails (all retries exhausted) | Edge node | Edge node continues to the ack wait step, times out, reads `sleep_time_sec` from NVS flash, and enters deep sleep. The GPS record never reaches the broker. | Yes — packet lost at radio layer |

### Key design properties

- **Edge node always sleeps.** The ack wait window has a fixed timeout. Whether the ack arrives or not, the edge node enters deep sleep and never blocks indefinitely.
- **`sleep_time_sec` is always available.** After the first successful ack, the value is stored in NVS flash and survives power cycles. All subsequent cycles use the flash value as a fallback, so the sleep interval is never lost.
- **Bridge restart is safe.** The bridge is stateless between messages — restarting it has no side effects on already-processed records. It resumes cleanly on the next incoming MQTT message.
- **Registration writes are authoritative at the API.** The API writes to SQLite before responding to the edge node and before publishing MQTT. If the bridge never receives the MQTT notification, the tracker is still registered via the API's direct write.
