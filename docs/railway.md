# Railway Deployment Guide

## Overview

This guide covers deploying all five COW services on [Railway](https://railway.app) from the `hannantech25-cell/cow` GitHub repository.

### Services

| Service | Source | Root Directory |
|---------|--------|----------------|
| `mosquitto` | GitHub repo | `mosquitto` |
| `influxdb` | GitHub repo | `influxdb` |
| `api` | GitHub repo | `api` |
| `bridge` | GitHub repo | `bridge` |
| `web` | GitHub repo | `web` |

### Key Differences from Docker Compose

| Issue | Impact | How It Is Handled |
|-------|--------|-------------------|
| No shared volumes between services | Bridge cannot read the API's SQLite | Bridge has a graceful fallback — it writes all data to InfluxDB without tracker validation |
| Internal hostnames change | `mosquitto`, `influxdb`, etc. no longer resolve | Use `<service>.railway.internal` hostnames in environment variables |
| Web `API_URL` is a build-time argument | Must be known before Next.js build | Set as both an environment variable and a build argument in the web service |
| Mosquitto needs external TCP access | ESP32 gateway connects from outside Railway | Enable TCP Proxy on port 1883 in Mosquitto service settings |

---

## Step 1 — Create a Railway Project

1. Log in to [railway.app](https://railway.app).
2. Click **New Project → Empty Project**.
3. Name the project `cow`.

---

## Step 2 — Add Services

Add five services in this order to avoid connection failures on first boot.

For each service: click **+ New → GitHub Repo → `hannantech25-cell/cow`**, then set the **Root Directory** as listed in the table above.

### 2.1 mosquitto

- **Root Directory:** `mosquitto`
- Railway will detect and use `mosquitto/Dockerfile`.

### 2.2 influxdb

- **Root Directory:** `influxdb`
- No Dockerfile exists — use a **Docker Image** source instead.
- **Image:** `influxdb:2.7`

### 2.3 api

- **Root Directory:** `api`

### 2.4 bridge

- **Root Directory:** `bridge`

### 2.5 web

- **Root Directory:** `web`

---

## Step 3 — Set Environment Variables

Go to each service → **Variables** tab and add the following.

### mosquitto

No environment variables required.

### influxdb

```
DOCKER_INFLUXDB_INIT_MODE=setup
DOCKER_INFLUXDB_INIT_USERNAME=admin
DOCKER_INFLUXDB_INIT_PASSWORD=admin@1234
DOCKER_INFLUXDB_INIT_ORG=cow_org
DOCKER_INFLUXDB_INIT_BUCKET=cow
DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=cow-super-secret-token
```

### api

```
NODE_ENV=production
PORT=3000
DB_PATH=/app/data/database.sqlite
JWT_SECRET=cow-jwt-super-secret-change-in-production
JWT_EXPIRES_IN=7d
MQTT_PROTOCOL=mqtt
MQTT_HOST=mosquitto.railway.internal
MQTT_PORT=1883
INFLUX_HOST=influxdb.railway.internal
INFLUX_PORT=8086
INFLUX_TOKEN=cow-super-secret-token
INFLUX_DATABASE=cow
CORS_ORIGIN=https://<your-web-railway-domain>
```

> Replace `<your-web-railway-domain>` with the public URL Railway assigns to the `web` service (visible under **Settings → Networking → Public Domain**).

### bridge

```
MQTT_PROTOCOL=mqtt
MQTT_HOST=mosquitto.railway.internal
MQTT_PORT=1883
INFLUX_HOST=influxdb.railway.internal
INFLUX_PORT=8086
INFLUX_TOKEN=cow-super-secret-token
INFLUX_DATABASE=cow
DB_PATH=/app/data/database.sqlite
```

> The bridge gets its own empty SQLite file. Tracker validation is skipped gracefully — all GPS data is still written to InfluxDB.

### web

```
API_URL=http://api.railway.internal:3000
```

Also add this as a **Build Argument** (service **Settings → Build → Build Arguments**):

```
API_URL=http://api.railway.internal:3000
```

> This is required because Next.js bakes the rewrite destination into the build output at compile time.

---

## Step 4 — Add Volumes

Go to each service → **Volumes** tab → **Add Volume** and set the mount path.

| Service | Mount Path | Stores |
|---------|-----------|--------|
| `influxdb` | `/var/lib/influxdb2` | InfluxDB time-series data |
| `api` | `/app/data` | SQLite database (`database.sqlite`) |
| `bridge` | `/app/data` | SQLite database (`database.sqlite`) |
| `mosquitto` | `/mosquitto/data` | MQTT persistence |

> `web` does not need a volume — it has no persistent data.

> `api` and `bridge` both use `DB_PATH=/app/data/database.sqlite`. Each service gets its own separate volume at `/app/data` — they do not share the same SQLite file on Railway (see Overview for details).

---

## Step 5 — Expose Public Ports

### web

Railway auto-detects port `3000` from the Dockerfile `EXPOSE` directive and generates a public HTTPS domain.  
Go to **Settings → Networking → Public Domain** and confirm it is enabled.

### api (optional)

Enable a public domain if you need direct HTTP access to the API outside of the dashboard.

### mosquitto — TCP Proxy

The ESP32 gateway node connects to Mosquitto from outside Railway over MQTT (port 1883).

1. Go to the `mosquitto` service → **Settings → Networking → Add TCP Proxy**.
2. Set the internal port to `1883`.
3. Railway will assign a public hostname and port, for example:  
   `roundhouse.proxy.rlwy.net:XXXXX`
4. Update the ESP32 gateway firmware with this hostname and port as the MQTT broker address.

---

## Step 6 — Update ESP32 Gateway Firmware

After enabling the TCP proxy for Mosquitto, update `esp32/gateway_node/src/main.cpp` with the Railway-assigned values:

```cpp
const char* mqtt_server = "roundhouse.proxy.rlwy.net"; // Railway TCP proxy hostname
const int   mqtt_port   = XXXXX;                        // Railway TCP proxy port
```

Rebuild and flash the firmware to the gateway board.

---

## Step 7 — Update CORS After Web Deploys

Once the `web` service is deployed and Railway has assigned its public domain:

1. Copy the domain (e.g., `https://web-production-xxxx.up.railway.app`).
2. Go to the `api` service → **Variables**.
3. Update `CORS_ORIGIN` to that domain.
4. Railway will redeploy the API automatically.

---

## Default Credentials (same as local)

| Service | Username | Password |
|---------|----------|----------|
| InfluxDB | `admin` | `admin@1234` |
| Dashboard | `admin` | `Admin@1234` |
| Dashboard | `johndoe` | `User@1234` |

> Change all passwords and secrets (`JWT_SECRET`, `INFLUX_TOKEN`, InfluxDB init password) before sharing the deployment publicly.

---

## Quick Reference — Railway Internal Hostnames

| Service | Internal Hostname | Port |
|---------|------------------|------|
| Mosquitto | `mosquitto.railway.internal` | `1883` |
| InfluxDB | `influxdb.railway.internal` | `8086` |
| API | `api.railway.internal` | `3000` |
