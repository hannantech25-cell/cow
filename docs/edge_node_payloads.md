# Edge Node — JSON Payloads

*Last updated: 2026-06-09*

---

## 1. First Time Registration

### Request — Edge Node → Server

```json
{
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "tracker_id": "ESP-01",
  "location": "Padang A",
  "username": "admin",
  "password": "admin@1234"
}
```

| Field | Description |
|-------|-------------|
| `mac_address` | Auto-populated from ESP32 chip. Used as the unique tracker identifier on the server. |
| `tracker_id` | Human-readable name entered by user in the registration form. |
| `location` | Physical location description entered by user in the registration form. |
| `username` | The edge node's own web form login username. Stored in NVS flash only — **not validated or stored by the API server**. |
| `password` | The edge node's own web form login password. Stored in NVS flash only — **not validated or stored by the API server**. |

> `username` and `password` protect the edge node's built-in captive portal (used by field workers to configure the tracker). The API ignores these fields entirely.

### Response (Success) — Server → Edge Node

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

| Field | Description |
|-------|-------------|
| `status` | `"success"` or `"error"`. |
| `tracker_id` | Confirmed tracker ID as stored by the server. |
| `location` | Confirmed location as stored by the server. |
| `mac_address` | Confirmed MAC address as stored by the server. |
| `initial_latitude` | Initial latitude sourced from gateway node. |
| `initial_longitude` | Initial longitude sourced from gateway node. |
| `registered_at` | ISO 8601 timestamp of successful registration. |

### Response (Error) — Server → Edge Node

```json
{
  "status": "error",
  "message": "Tracker already registered"
}
```

---

## 2. Normal Operation

### Payload — Edge Node → Gateway Node (ESP-NOW)

```json
{
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "tracker_id": "ESP-01",
  "latitude": 1.856273,
  "longitude": 103.756489,
  "battery_mv": 3742
}
```

| Field | Type | Description |
|-------|------|-------------|
| `mac_address` | string | MAC address of the edge node for server-side identification. |
| `tracker_id` | string | Identifier of the transmitting edge node. |
| `latitude` | float | Current GPS latitude in decimal degrees. |
| `longitude` | float | Current GPS longitude in decimal degrees. |
| `battery_mv` | uint16 | Battery voltage in millivolts. |

### Payload — Gateway Node → Mosquitto Broker (MQTT)

Same payload forwarded as-is to topic `cow/tracker/data`.

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

## 3. Information Update

### Request — Edge Node → Server

```json
{
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "tracker_id": "ESP-01-B",
  "location": "Padang B",
  "username": "admin2",
  "password": "newpass@5678"
}
```

| Field | Description |
|-------|-------------|
| `mac_address` | Used by server to identify which tracker record to update. |
| `tracker_id` | Updated tracker name entered by user in the update form. |
| `location` | Updated location entered by user in the update form. |
| `username` | Updated web form login username. Stored in NVS flash only — **not validated or stored by the API server**. Omit field if not changing. |
| `password` | Updated web form login password. Stored in NVS flash only — **not validated or stored by the API server**. Omit field if not changing. |

> `username` and `password` protect the edge node's built-in captive portal only. The API ignores these fields entirely.

### Response (Success) — Server → Edge Node

```json
{
  "status": "success",
  "tracker_id": "ESP-01-B",
  "location": "Padang B",
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "updated_at": "2026-06-09T10:30:00Z"
}
```

| Field | Description |
|-------|-------------|
| `status` | `"success"` or `"error"`. |
| `tracker_id` | Updated tracker ID as stored by the server. |
| `location` | Updated location as stored by the server. |
| `mac_address` | MAC address of the tracker (unchanged). |
| `updated_at` | ISO 8601 timestamp of successful update. |

### Response (Error) — Server → Edge Node

```json
{
  "status": "error",
  "message": "Tracker not found"
}
```

---

## 4. Normal Operation — Ack Received from Gateway (ESP-NOW)

After the edge node transmits its GPS payload via ESP-NOW, it registers an `OnDataReceived` callback and waits briefly for a response from the gateway. The gateway sends this ack after it receives the `cow/tracker/ack` MQTT message published by the bridge upon a successful InfluxDB write.

### Ack Payload — Gateway Node → Edge Node (ESP-NOW)

```json
{
  "status": "ok",
  "sleep_time_sec": 15
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Always `"ok"`. Confirms the data was written to InfluxDB. |
| `sleep_time_sec` | uint32 | Deep sleep duration in seconds, configured by the dashboard user on the Tracker Management page. Default: `15` (15 seconds). |

### Edge Node Behaviour on Receipt

1. Parse `sleep_time_sec` from the received payload.
2. Store `sleep_time_sec` to NVS flash (key: `config/sleep_time_sec`) so the value survives deep sleep cycles.
3. Proceed to power off GPS, deinitialise peripherals, and call `esp_deep_sleep(sleep_time_sec * 1,000,000)` (microseconds).

### Fallback — Ack Not Received (Timeout)

If no ack arrives within the wait window:

1. Read `sleep_time_sec` from NVS flash (`config/sleep_time_sec`).
2. If the NVS key is absent (first boot, never received an ack), use the firmware compile-time default (e.g. `15` seconds).
3. Proceed to deep sleep using the fallback value.

> The edge node always enters deep sleep regardless of whether the ack is received. The timeout ensures the tracker does not wait indefinitely if the bridge or gateway is temporarily unavailable.
