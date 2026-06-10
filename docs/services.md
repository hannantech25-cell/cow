# Services Reference

*Last updated: 2026-06-09*

All services run in Docker on the same `cow_network`. Internal hostnames match the container names and are used for service-to-service communication (e.g. `api` → `influxdb`, `api` → `mosquitto`).

---

## Mosquitto (MQTT Broker)

| Property | Value |
|----------|-------|
| Container | `mosquitto` |
| Image | `eclipse-mosquitto:latest` |
| Internal Host | `mosquitto` |
| External URL | `mqtt://localhost:1883` |
| Port | `1883` |
| Authentication | None (development) |
| Config File | `mosquitto/config/mosquitto.conf` |
| Data Volume | `mosquitto_data` |
| Log Volume | `mosquitto_log` |

**Topics:**

| Topic | Publisher | Subscriber(s) | Description |
|-------|-----------|---------------|-------------|
| `cow/tracker/data` | Gateway Node | Bridge, API | GPS + battery data |
| `cow/tracker/ack` | Bridge | Gateway Node | InfluxDB write confirmed — carries `sleep_time_sec` (from Tracker Management); gateway forwards to edge node via ESP-NOW |
| `cow/tracker/register` | API | Bridge, Gateway Node | New tracker registered |
| `cow/tracker/update` | API | Bridge, Gateway Node | Tracker info updated |

---

## InfluxDB

| Property | Value |
|----------|-------|
| Container | `influxdb` |
| Image | `influxdb:2.7` |
| Internal URL | `http://influxdb:8086` |
| External URL | `http://localhost:8086` |
| Username | `admin` |
| Password | `admin@1234` |
| Organisation | `cow_org` |
| Bucket | `cow` |
| Admin Token | `cow-super-secret-token` |
| Data Volume | `influxdb_data` |
| Config Folder | `influxdb/config/` |

**Schema:**

| Property | Value |
|----------|-------|
| Measurement | `tracker` |
| Tags | `tracker_id`, `mac_address` |
| Fields | `latitude`, `longitude`, `battery_mv` |

**Useful URLs:**

| Page | URL |
|------|-----|
| Dashboard | `http://localhost:8086` |
| Write API | `http://localhost:8086/api/v2/write?org=cow_org&bucket=cow&precision=s` |
| Query API | `http://localhost:8086/api/v2/query?org=cow_org` |

---

## Bridge (Data Bridge)

| Property | Value |
|----------|-------|
| Container | `bridge` |
| Build Context | `./bridge` |
| Port | — (no HTTP server) |
| MQTT Subscriptions | `cow/tracker/data`, `cow/tracker/register`, `cow/tracker/update` |
| InfluxDB Write | measurement `tracker` (from `cow/tracker/data`) |
| SQLite Access | read-write, shared `api_data` volume |

**Key environment variables:**

| Variable | Value |
|----------|-------|
| `MQTT_HOST` | `mosquitto` |
| `MQTT_PORT` | `1883` |
| `INFLUX_HOST` | `influxdb` |
| `INFLUX_PORT` | `8086` |
| `INFLUX_TOKEN` | `cow-super-secret-token` |
| `INFLUX_DATABASE` | `cow` |
| `DB_PATH` | `/app/data/database.sqlite` |

---

## API

| Property | Value |
|----------|-------|
| Container | `api` |
| Build Context | `./api` |
| Internal URL | `http://api:3000` |
| External URL | `http://localhost:3000` |
| Port | `3000` |
| DB Path (in container) | `/app/data/database.sqlite` (named volume `api_data`) |
| JWT Secret | `cow-jwt-super-secret-change-in-production` |
| MQTT Host (internal) | `mosquitto` |
| InfluxDB Host (internal) | `influxdb` |
| SSE | `api/src/mqtt/client.ts` — subscribes to `cow/tracker/data`, emits SSE events (InfluxDB writes handled by bridge) |

**Key environment variables (`docker-compose.yml`):**

| Variable | Value |
|----------|-------|
| `DB_PATH` | `/app/data/database.sqlite` |
| `JWT_SECRET` | `cow-jwt-super-secret-change-in-production` |
| `MQTT_HOST` | `mosquitto` |
| `MQTT_PORT` | `1883` |
| `INFLUX_HOST` | `influxdb` |
| `INFLUX_PORT` | `8086` |
| `INFLUX_TOKEN` | `cow-super-secret-token` |
| `INFLUX_DATABASE` | `cow` |
| `CORS_ORIGIN` | `http://localhost:80,http://localhost:3000` |

**Endpoints:** See `docs/dashboard.md` → API Endpoints section for the full reference.

---

## Web Dashboard

| Property | Value |
|----------|-------|
| Container | `web` |
| Build Context | `./web` |
| Internal URL | `http://web:3000` |
| External URL | `http://localhost:80` (mapped 80→3000) |
| API proxy | `/api/*` → `http://api:3000/api/*` (Next.js rewrite — `API_URL` baked in at build time via Docker build arg, rewrite applied at request time) |
| Build arg | `API_URL=http://api:3000` |

---

## Docker Network

| Property | Value |
|----------|-------|
| Name | `cow_network` |
| Driver | `bridge` |

All containers communicate using their **container name** as the hostname within `cow_network`.

---

## Docker Volumes

| Volume | Used By | Description |
|--------|---------|-------------|
| `mosquitto_data` | Mosquitto | Persistent MQTT message store |
| `mosquitto_log` | Mosquitto | Mosquitto log files |
| `influxdb_data` | InfluxDB | Persistent time-series data |
| `api_data` | API, Bridge | SQLite database (`database.sqlite`) — shared read-write |

---

## Quick Start

```bash
# Start all services
docker compose up -d

# Check running containers
docker compose ps

# View logs for a specific service
docker compose logs -f mosquitto
docker compose logs -f influxdb
docker compose logs -f api

# Stop all services
docker compose down

# Stop and remove volumes (wipes all data)
docker compose down -v
```

---

## Startup Order

Services must start in the following order. `docker-compose.yml` `depends_on` enforces this automatically.

```
1. influxdb    — time-series database must be ready before bridge writes
2. mosquitto   — MQTT broker must be ready before gateway, bridge, and API connect
3. api         — initialises SQLite (creates all tables, enables WAL mode) before bridge opens the DB file
4. bridge      — requires SQLite tables to exist; requires MQTT and InfluxDB to be reachable
   web         — requires API to serve /api/* routes (starts concurrently with bridge)
```

> If the bridge starts before the API has created the SQLite tables, it falls back to allowing all data through without tracker validation. This is a graceful fallback, not an error — but tracker registration checks will be skipped until the API is up and the bridge reconnects to SQLite.

---

## Notes

- Change `cow-super-secret-token` to a secure random string before deploying to production.
- Set `allow_anonymous false` in `mosquitto/config/mosquitto.conf` and configure username/password for production.
- InfluxDB is auto-initialised on first run using the environment variables in `docker-compose.yml`. Changing them after first run has no effect — modify via the InfluxDB UI instead.
