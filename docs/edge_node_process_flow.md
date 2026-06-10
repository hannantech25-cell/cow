# Edge Node — Process Flow

*Last updated: 2026-06-09*

## Overview

The edge node (XIAO ESP32-C3) has three distinct operating modes:

| Mode | Trigger |
|------|---------|
| **First Time Operation** | Power on with no registration in flash |
| **Normal Operation** | Timer wakeup from deep sleep |
| **Information Update** | Physical button press wakeup |

Both First Time and Information Update modes require login before accessing the web form. Default credentials are stored in flash and can be changed from within the web interface.

---

## 1. First Time Operation

```
                        ┌─────────────────────┐
                        │    Power On /       │
                        │    First Boot       │
                        └──────────┬──────────┘
                                   │
                                   ▼
                        ┌─────────────────────┐
                        │  Boot / Initialize  │
                        │  - GPIO             │
                        │  - UART (GPS)       │
                        └──────────┬──────────┘
                                   │
                                   ▼
                        ┌─────────────────────┐
                        │  Start Wi-Fi AP     │
                        │  + HTTP Web Server  │
                        └──────────┬──────────┘
                                   │
                                   ▼
                        ┌─────────────────────┐
                        │  Show Login Page    │◄──────────────┐
                        └──────────┬──────────┘               │
                                   │ Credentials submitted     │
                                   ▼                           │
                        ┌─────────────────────┐               │
                        │  Credentials        │  Invalid      │
                        │  Valid?             ├───────────────┘
                        └──────────┬──────────┘  (show error)
                                   │ Valid
                                   ▼
                        ┌─────────────────────────────────────┐
                        │  Show Registration Form             │
                        │  - Tracker ID                        │
                        │  - Location                         │
                        │  - MAC Address (auto-populated)     │
                        │  ───────────────────────────────    │
                        │  Change Credentials (optional)      │
                        │  - New Username                     │
                        │  - New Password                     │
                        └──────────┬──────────────────────────┘
                                   │ Form submitted
                                   ▼
                        ┌─────────────────────┐
                        │  Save Credentials   │
                        │  to Flash (if       │
                        │  changed)           │
                        └──────────┬──────────┘
                                   │
                                   ▼
                        ┌─────────────────────┐        ┌─────────────────────┐
                        │  POST Registration  │  Fail  │  Show Error on      │
                        │  to Server          ├───────►│  Web Page, Retry    │
                        └──────────┬──────────┘        └─────────────────────┘
                                   │ Success
                                   ▼
                        ┌─────────────────────┐
                        │  Receive Initial    │
                        │  Lat/Long from      │
                        │  Server (sourced    │
                        │  from Gateway)      │
                        └──────────┬──────────┘
                                   │
                                   ▼
                        ┌─────────────────────┐
                        │  Store to Flash     │
                        │  - Tracker ID        │
                        │  - Location         │
                        │  - Coordinates      │
                        │  - Registered flag  │
                        └──────────┬──────────┘
                                   │
                                   ▼
                        ┌─────────────────────┐
                        │  Stop AP &          │
                        │  Web Server         │
                        └──────────┬──────────┘
                                   │
                                   ▼
                        ┌─────────────────────┐
                        │  Enter Deep Sleep   │
                        │  (firmware default: │
                        │   15 s)             │
                        └─────────────────────┘
```

---

## 2. Normal Operation

```
                        ┌──────────────────────────┐
                        │   Deep Sleep Mode        │
                        │   (sleep_time_sec from   │
                        │    NVS flash)            │
                        └──────────┬───────────────┘
                                   │ Timer wakeup
                                   ▼
                        ┌─────────────────────┐
                        │  Boot / Initialize  │
                        │  - GPIO             │
                        │  - UART (GPS)       │
                        │  - Wi-Fi STA        │
                        │  - ESP-NOW          │
                        └──────────┬──────────┘
                                   │
                                   ▼
                        ┌─────────────────────┐
                        │   Read Battery      │
                        │   Voltage (ADC)     │
                        └──────────┬──────────┘
                                   │
                                   ▼
                        ┌─────────────────────┐
                        │   Power On GPS      │
                        │   Module            │
                        └──────────┬──────────┘
                                   │
                                   ▼
                        ┌─────────────────────┐
                        │  Wait for GPS Fix   │
                        │  (NMEA parsing,     │
                        │   max T seconds)    │
                        └──────────┬──────────┘
                                   │
                                   ▼
                        ┌─────────────────────┐        ┌─────────────────────┐
                        │   GPS Fix           │  No /  │  Use Last Known     │
                        │   Acquired?         │Timeout │  GPS Coordinates    │
                        │                    ├───────►│  (from NVS flash)   │
                        └──────────┬──────────┘        └──────────┬──────────┘
                                   │ Yes                           │
                                   ▼                               │
                        ┌─────────────────────┐                   │
                        │  Store GPS Coords   │                   │
                        │  to NVS Flash       │                   │
                        └──────────┬──────────┘                   │
                                   │                               │
                                   ▼                               │
                        ┌─────────────────────┐◄──────────────────┘
                        │   Build Payload     │
                        │   - MAC Address     │
                        │   - Tracker ID       │
                        │   - Latitude        │
                        │   - Longitude       │
                        │   - Battery voltage │
                        └──────────┬──────────┘
                                   │
                                   ▼
                        ┌─────────────────────┐
                        │  Send via ESP-NOW   │
                        │  to Gateway MAC     │
                        └──────────┬──────────┘
                                   │
                                   ▼
                        ┌─────────────────────┐        ┌─────────────────┐
                        │  Delivery           │  No    │  Retry (max 3x) │
                        │  Confirmed?         ├───────►│  then continue  │
                        │  (OnDataSent CB)    │        └────────┬────────┘
                        └──────────┬──────────┘                 │
                                   │ Yes                         │
                                   │◄────────────────────────────┘
                                   ▼
                        ┌─────────────────────┐        ┌─────────────────────┐
                        │  Wait for ESP-NOW   │Timeout │  Use NVS flash      │
                        │  Ack from Gateway   ├───────►│  sleep_time_sec     │
                        │  (OnDataReceived)   │        │  (fallback)         │
                        └──────────┬──────────┘        └──────────┬──────────┘
                                   │ Ack received                  │
                                   ▼                               │
                        ┌─────────────────────┐                   │
                        │  Store sleep_time_  │                   │
                        │  sec to NVS Flash   │                   │
                        └──────────┬──────────┘                   │
                                   │                               │
                                   ▼                               │
                        ┌─────────────────────┐◄──────────────────┘
                        │  Power Off GPS      │
                        │  Deinit Peripherals │
                        └──────────┬──────────┘
                                   │
                                   ▼
                        ┌──────────────────────────┐
                        │  Enter Deep Sleep        │
                        │  (sleep_time_sec from    │
                        │   ack or NVS fallback)   │
                        └──────────────────────────┘
```

---

## 3. Information Update

```
                        ┌─────────────────────┐
                        │   Deep Sleep Mode   │
                        └──────────┬──────────┘
                                   │ Button press wakeup
                                   ▼
                        ┌─────────────────────┐
                        │  Boot / Initialize  │
                        │  - GPIO             │
                        │  - Wi-Fi            │
                        └──────────┬──────────┘
                                   │
                                   ▼
                        ┌─────────────────────┐
                        │  Start Wi-Fi AP     │
                        │  + HTTP Web Server  │
                        └──────────┬──────────┘
                                   │
                                   ▼
                        ┌─────────────────────┐
                        │  Show Login Page    │◄──────────────┐
                        └──────────┬──────────┘               │
                                   │ Credentials submitted    │
                                   ▼                          │
                        ┌─────────────────────┐               │
                        │  Credentials        │  Invalid      │
                        │  Valid?             ├───────────────┘
                        └──────────┬──────────┘  (show error)
                                   │ Valid
                                   ▼
                        ┌─────────────────────────────────────┐
                        │  Show Update Form                   │
                        │  - Tracker ID                        │
                        │  - Location                         │
                        │  ───────────────────────────────    │
                        │  Change Credentials (optional)      │
                        │  - New Username                     │
                        │  - New Password                     │
                        └──────────┬──────────────────────────┘
                                   │ Form submitted
                                   ▼
                        ┌─────────────────────┐
                        │  Save Credentials   │
                        │  to Flash (if       │
                        │  changed)           │
                        └──────────┬──────────┘
                                   │
                                   ▼
                        ┌─────────────────────┐        ┌─────────────────────┐
                        │  PATCH Tracker Info  │  Fail  │  Show Error on      │
                        │  to Server          ├───────►│  Web Page, Retry    │
                        └──────────┬──────────┘        └─────────────────────┘
                                   │ Success
                                   ▼
                        ┌─────────────────────┐
                        │  Receive            │
                        │  Confirmation from  │
                        │  Server             │
                        │  - status           │
                        │  - tracker_id        │
                        │  - location         │
                        │  - mac_address      │
                        │  - updated_at       │
                        └──────────┬──────────┘
                                   │
                                   ▼
                        ┌─────────────────────┐
                        │  Update Tracker Info │
                        │  in Flash           │
                        │  - Tracker ID        │
                        │  - Location         │
                        └──────────┬──────────┘
                                   │
                                   ▼
                        ┌─────────────────────┐
                        │  Stop AP &          │
                        │  Web Server         │
                        └──────────┬──────────┘
                                   │
                                   ▼
                        ┌─────────────────────┐
                        │  Enter Deep Sleep   │
                        │  (sleep_time_sec    │
                        │   from NVS flash)   │
                        └─────────────────────┘
```

---

## States

### First Time Operation

| State | Description |
|-------|-------------|
| Boot / Initialize | Initialize GPIO, UART for GPS. |
| Start Wi-Fi AP + Web Server | Broadcast access point and start HTTP server. |
| Show Login Page | Serve login form. Default credentials: `admin` / `admin@1234`. |
| Credentials Valid? | Compare submitted credentials against value stored in flash. |
| Show Registration Form | Form with tracker ID, location, auto-populated MAC, and optional credential change fields. |
| Save Credentials to Flash | If user submitted new username/password, overwrite in flash (NVS). |
| POST Registration to Server | Send tracker ID, location, and MAC to server via HTTP POST. |
| Receive Initial Coordinates | Server responds with initial lat/long sourced from the gateway node. |
| Store to Flash | Persist tracker ID, location, coordinates, and registered flag to flash. |
| Stop AP & Web Server | Tear down access point and HTTP server. |
| Enter Deep Sleep | Enter deep sleep using firmware default of 15 s (no ack has been received yet; `config/sleep_time_sec` not yet set in NVS). |

### Normal Operation

| State | Description |
|-------|-------------|
| Deep Sleep | MCU in deep sleep. Wakes via RTC timer using `sleep_time_sec` from NVS flash. |
| Boot / Initialize | Initialize GPIO, UART for GPS, Wi-Fi STA (no connection), ESP-NOW. |
| Read Battery Voltage | Sample ADC pin connected to battery voltage divider. |
| Power On GPS | Enable GPS module power. |
| Wait for GPS Fix | Parse NMEA sentences until a valid GPS fix is obtained or the timeout (max T seconds) expires. |
| GPS Fix Acquired? | Yes: proceed to store coordinates to NVS flash. No/Timeout: use last known GPS coordinates from NVS flash. |
| Store GPS Coords to NVS Flash | Save current latitude and longitude to NVS flash (keys: `gps/last_latitude`, `gps/last_longitude`) so they survive deep sleep cycles. |
| Use Last Known GPS Coordinates | Read `gps/last_latitude` and `gps/last_longitude` from NVS flash. If absent (first boot with no prior fix), use the initial coordinates received during tracker registration. |
| Build Payload | Pack MAC address, tracker ID, lat/long, and battery voltage into payload struct. |
| Send via ESP-NOW | Transmit payload to gateway using gateway MAC address. |
| Delivery Confirmed? | Check `OnDataSent` callback status. Retry up to 3 times on failure. |
| Wait for ESP-NOW Ack | Wait for an incoming ESP-NOW packet from the gateway (`{"status":"ok","sleep_time_sec":N}`). On receipt, proceed to store. On timeout, branch to NVS fallback. |
| Store sleep_time_sec to NVS Flash | Save the `sleep_time_sec` value from the ack to NVS flash (key: `config/sleep_time_sec`) so it survives deep sleep cycles. |
| Use NVS flash sleep_time_sec | Read `config/sleep_time_sec` from NVS flash. If absent (first boot, never received an ack), use firmware compile-time default (15 seconds). |
| Power Off GPS & Deinit | Power off GPS module and deinitialize peripherals. |
| Enter Deep Sleep | Call `esp_deep_sleep(sleep_time_sec * 1,000,000)` using the value from the ack (just stored) or the NVS fallback. |

### Information Update

| State | Description |
|-------|-------------|
| Deep Sleep | MCU in deep sleep. Wakes via button GPIO interrupt. |
| Boot / Initialize | Initialize GPIO and Wi-Fi. |
| Start Wi-Fi AP + Web Server | Broadcast access point and start HTTP server. |
| Show Login Page | Serve login form using credentials stored in flash. |
| Credentials Valid? | Compare submitted credentials against value stored in flash. |
| Show Update Form | Form with tracker ID and location fields, and optional credential change fields. |
| Save Credentials to Flash | If user submitted new username/password, overwrite in flash (NVS). |
| PATCH Tracker Info to Server | Send updated tracker ID and location to server via HTTP PATCH. |
| Receive Confirmation from Server | Server responds with `{status, tracker_id, location, mac_address, updated_at}`. Edge node waits for this before proceeding — this is the notification that the update was persisted. |
| Update Tracker Info in Flash | Overwrite tracker ID and location in flash with confirmed values from server response. |
| Stop AP & Web Server | Tear down access point and HTTP server. |
| Enter Deep Sleep | Enter deep sleep using `sleep_time_sec` from NVS flash (timer wakeup). Falls back to firmware default 15 s if `config/sleep_time_sec` is absent (tracker never received an ack). |

---

## Credentials

| Field | Default | Storage |
|-------|---------|---------|
| Username | `admin` | Flash (NVS) |
| Password | `admin@1234` | Flash (NVS) |

- Credentials can be changed from within both the registration and update web forms.
- If no credentials have been saved yet (truly first boot), the default values are used.
- Changed credentials persist across deep sleep cycles.

---

## ESP-NOW Configuration

| Item | Details |
|------|---------|
| Mode | Wi-Fi STA (no connection needed — ESP-NOW uses the radio directly) |
| Peer | Gateway node MAC address (stored in NVS flash) |
| Delivery confirmation | `OnDataSent` callback — status: `ESP_NOW_SEND_SUCCESS` / `FAIL` |
| Payload size | Up to 250 bytes (struct or JSON) |
| Retry logic | Up to 3 retries on delivery failure, then continue to deep sleep |
| Ack payload (received) | `{"status":"ok","sleep_time_sec":N}` — carries the next sleep duration set by the dashboard user |

The gateway MAC address must be stored in the edge node's NVS flash before normal operation. It is pre-programmed into the firmware or stored during first-time setup.

The edge node stores the last received `sleep_time_sec` in NVS flash. If the ack times out, the flash value is used so the sleep interval is never lost across power cycles.

---

## Notes

- On first boot the registered flag is absent from flash — this is how the tracker detects first time operation.
- The MAC address is read directly from the ESP32-C3 chip and auto-populated in the registration form; the user cannot edit it.
- The update button is wired to a GPIO configured as an external wakeup source.
- Update mode only allows changing tracker ID, location, and credentials. Coordinates are not modified.
- In Normal Operation, Wi-Fi is started in STA mode but does NOT connect to any router. ESP-NOW uses the Wi-Fi radio independently.
- In First Time and Information Update modes, Wi-Fi is started in AP mode for the HTTP web server. ESP-NOW is not used in these modes.
- In First Time and Information Update modes, the HTTP response from the server is the notification that tells the edge node the operation was persisted. The edge node waits for this response before writing to flash and entering deep sleep. If the HTTP request fails, the edge node retries — it does not sleep until a successful response is received.
- In Normal Operation, the notification is delivered differently: the bridge publishes `cow/tracker/ack` after writing to InfluxDB, the gateway receives it via MQTT and sends an ESP-NOW packet back to the edge node.
- Battery voltage is read via a resistor voltage divider connected to an ADC pin before GPS is powered on to avoid noise.
- If GPS fix is not acquired within the timeout window, the last known coordinates from NVS flash (`gps/last_latitude`, `gps/last_longitude`) are used to maintain data continuity. These keys are written after every successful GPS fix and survive deep sleep cycles. On first boot with no prior fix, the initial coordinates from tracker registration are used.
- After sending via ESP-NOW, the edge node waits for an incoming ESP-NOW packet from the gateway. This ack carries `sleep_time_sec` — the deep sleep duration configured by the dashboard user on the Tracker Management page. The received value is stored to NVS flash (`config/sleep_time_sec`) before sleeping, so it persists across cycles. If the ack never arrives (timeout), the last stored flash value is used; if the key is absent (first boot), the firmware compile-time default (15 seconds) applies.
- `esp_deep_sleep()` takes microseconds — convert `sleep_time_sec` with `sleep_time_sec * 1,000,000`.
