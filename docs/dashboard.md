# Dashboard — Requirements & Module Reference

*Last updated: 2026-06-09*

## Overview

Web-based dashboard for monitoring GPS-tracked livestock in real time. Displays live tracker locations on a map, tracker status, battery levels, historical GPS tracks, and manages farms, cows, tracker hardware, and dashboard users. Built on top of the archived `cow-tracker` project with the API adapted for the new edge node / gateway node system.

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| API framework | Express 4 + TypeScript |
| Authentication | JWT (jsonwebtoken) + bcrypt (bcryptjs) |
| MQTT client | mqtt.js v5 |
| InfluxDB client | `@influxdata/influxdb3-client` |
| Real-time delivery | Polling (10 s) + SSE per tracker |
| Frontend framework | Next.js 14 (App Router) + TypeScript |
| Map | Leaflet.js |
| UI template | Materio Bootstrap |
| Database | SQLite (`better-sqlite3`) — replaces MySQL |

---

## Adaptations from Archived Project

| Item | Archived | New |
|------|----------|-----|
| MQTT subscribe topic | `gps/+/data` | `cow/tracker/data` |
| Tracker identifier | `board_id` | `mac_address` + `tracker_id` |
| Battery field | `batteryPercent` (0–100 %) | `battery_mv` (millivolts) |
| Removed GPS fields | `rssi`, `speed`, `heading`, `fixValid` | not in new payload |
| Database | MySQL (`mysql2`) | SQLite (`better-sqlite3`) |
| InfluxDB measurement | `gps_data` | `tracker` |
| InfluxDB tags | `board_id`, `mac_address` | `mac_address`, `tracker_id` |
| Retained features | farms, geofences, alerts, cows, trackers, users | all kept |
| New endpoints | — | `/api/trackers`, `/api/gateway/location` |
| Tracker registration | Manual via dashboard UI | Edge node web server → `/api/trackers` |
| SSE stream key | `gps:<board_id>` | `tracker:<mac_address>` |

---

## Navigation (Sidebar)

| Label | Route | Icon |
|-------|-------|------|
| Real-Time Location | `/realtime-map` | `ri-map-pin-line` |
| Historical Location | `/historical-location` | `ri-history-line` |
| Real-Time Data | `/realtime-data` | `ri-bar-chart-2-line` |
| Farm | `/farms` | `ri-community-line` |
| Cow | `/cows` | `ri-profile-line` |
| Tracker | `/trackers` | `ri-router-line` |
| User | `/users` | `ri-team-line` |

---

## Pages

### 1. Login

**Route:** `/login`  
**File:** `web/src/app/(auth)/login/`

- Username + password form
- POSTs to `POST /api/auth/login`
- Saves JWT token + user object to `localStorage`
- Redirects to `/realtime-map` on success

---

### 2. Real-Time Map *(default landing page)*

**Route:** `/realtime-map`  
**Files:** `RealtimeMapClient.tsx`, `MapClient.tsx`

**Purpose:** Show live location of all registered edge node trackers on a Leaflet map.

**Data sources:**
- `GET /api/realtime/locations` — polled every 10 seconds
- `GET /api/farms` — farm boundary polygons overlaid on map
- SSE `GET /api/realtime/stream/:macAddress` — live push per selected tracker

**Features:**
- Farm selector dropdown — filters map view to a selected farm's boundary polygon
- Leaflet.js map, one marker per tracker with location name from SQLite
- Markers refresh every 10 seconds
- Click marker → popup: Tracker ID, MAC address, Location, Battery mV (colour-coded), Last seen
- Tracker status badge derived from last-seen time (Online / Idle / Offline)
- Stat cards: Total Trackers, Online, Low Battery, No Signal
- Farm boundary polygon overlay from `GET /api/farms/:id` points

---

### 3. Historical Location

**Route:** `/historical-location`  
**Files:** `HistoricalLocationClient.tsx`, `HistoricalMapClient.tsx`

**Purpose:** Replay a tracker's GPS track for a selected date.

**Data source:** `GET /api/realtime/history?mac_address=&date=YYYY-MM-DD`

**Features:**
- Tracker selector (MAC address / tracker ID)
- Date picker
- Leaflet.js polyline of all GPS points for the day
- Point markers at each recorded position
- Timeline table: Time, Latitude, Longitude, Battery mV

---

### 4. Real-Time Data

**Route:** `/realtime-data`  
**File:** `RealtimeDataClient.tsx`

**Purpose:** Live scrolling table of incoming MQTT data packets.

**Data source:** SSE `GET /api/realtime/stream/:macAddress` or polled `/api/realtime/locations`

**Features:**
- Dropdown to select a registered tracker
- Connection status badges (MQTT, InfluxDB) from `GET /api/realtime/status`
- Live data table: Timestamp, MAC Address, Tracker ID, Latitude, Longitude, Battery mV
- Auto-scrolling to newest entry

---

### 5. Farm Management

**Route:** `/farms`  
**File:** `FarmsClient.tsx`

**Purpose:** Create and manage farms and their GPS boundary polygons.

**Data sources:**
- `GET /api/farms` — list all farms
- `GET /api/farms/:id` — farm detail + boundary points
- `POST/PUT/DELETE /api/farms`
- `POST/PUT/DELETE /api/farms/:id/points`

**Features:**
- Table of farms: Name, Address, Boundary Points, Actions
- Add / edit / delete farm
- Boundary point editor: add GPS points that define the farm polygon (max 20 points)
- Centre lat/long auto-calculated from boundary points
- Farm polygon used on Real-Time Map for boundary overlay

---

### 6. Cow Management

**Route:** `/cows`  
**File:** `CowsClient.tsx`

**Purpose:** Register and manage livestock records.

**Data sources:**
- `GET /api/cows` — list all cows (with farm name, assigned tracker)
- `POST/PUT /api/cows`
- `PATCH /api/cows/:id/tag` — assign / unassign tracker
- `DELETE /api/cows/:id`
- `GET /api/farms` — populate farm dropdown
- `GET /api/trackers` — populate tracker dropdown

**Features:**
- Table: Tag Number, Name, Breed, Sex, DOB, Farm, Status (Pair / Unpair), Assigned Tracker
- Add cow: Name, Breed, Sex, Date of Birth, Farm
- Edit cow info
- Assign / unassign tracker (links cow ↔ tracker in SQLite)
- Delete cow — auto-unassigns linked tracker
- Search / filter by name, tag number, status

---

### 7. Tracker Management

**Route:** `/trackers`  
**File:** `TrackersClient.tsx`

**Purpose:** Register and manage physical tracker hardware (edge node trackers as dashboard entries).

**Data sources:**
- `GET /api/trackers`
- `POST/PUT /api/trackers`
- `PATCH /api/trackers/:id/assign`
- `PATCH /api/trackers/:id/status`
- `DELETE /api/trackers/:id`

**Features:**
- Table: Board ID, MAC Address, Assigned Cow, Sleep Time (sec), Battery Threshold (%), Status, Actions
- Add tracker: Board ID, MAC Address, Sleep Time, Battery Threshold
- Edit tracker settings — including Sleep Time
- Toggle status: Active / Inactive (Maintenance locked)
- Assign tracker to a cow (sets status → Active)
- Delete tracker — auto-unassigns from cow

**Sleep Time behaviour:** The `sleep_time_sec` value set here is read by the bridge service each time GPS data arrives from the edge node. The bridge includes it in the `cow/tracker/ack` MQTT message → the gateway forwards it to the edge node via ESP-NOW → the edge node stores it in NVS flash and uses it as the deep sleep duration after each transmission. Changes take effect on the next data packet received from that tracker.

**Note:** Edge nodes that self-register via the web server automatically appear in this table with status `Inactive`. Dashboard users can then configure settings, assign to a cow, and activate.

---

### 8. User Management

**Route:** `/users`  
**File:** `UsersClient.tsx`  
**Access:** Admin only

**Purpose:** Manage dashboard login accounts.

**Data sources:**
- `GET /api/users`
- `POST/PUT /api/users`
- `PATCH /api/users/:id/status`
- `DELETE /api/users/:id`

**Features:**
- Table: Name, Username, Email, Role (Admin / User), Status (Active / Inactive), Joined
- Add user: Name, Username, Email, Password, Role
- Edit user info and role
- Change password (requires current password)
- Toggle Active / Inactive
- Delete user — cannot delete self or last Admin
- Avatar auto-generated from initials if no avatar URL

---

### 9. Dashboard Summary *(placeholder)*

**Route:** `/dashboard`  
**File:** `web/src/app/(dashboard)/dashboard/page.tsx`

Currently a placeholder. Intended to show:
- Stat cards: Total Trackers, Online, Low Battery, No Signal
- MQTT + InfluxDB connection health
- Recent activity log

---

## API Endpoints — Complete Reference

### Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/auth/login` | None | Login, returns JWT + user |
| `GET` | `/api/auth/me` | JWT | Current user profile |

### Users *(Admin only)*

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/users` | List all users |
| `GET` | `/api/users/:id` | Get user by ID |
| `POST` | `/api/users` | Create user |
| `PUT` | `/api/users/:id` | Update user (password change requires `currentPassword`) |
| `PATCH` | `/api/users/:id/status` | Toggle Active / Inactive |
| `DELETE` | `/api/users/:id` | Delete user |

### Cows

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/cows` | List cows with farm + tracker info |
| `GET` | `/api/cows/:id` | Get single cow |
| `POST` | `/api/cows` | Create cow |
| `PUT` | `/api/cows/:id` | Update cow |
| `PATCH` | `/api/cows/:id/tag` | Assign / unassign tracker |
| `DELETE` | `/api/cows/:id` | Delete cow |

### Trackers

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/trackers` | List trackers with assigned cow |
| `POST` | `/api/trackers` | Register tracker |
| `PUT` | `/api/trackers/:id` | Update tracker settings |
| `PATCH` | `/api/trackers/:id/assign` | Assign / unassign to a cow |
| `PATCH` | `/api/trackers/:id/status` | Toggle Active / Inactive |
| `DELETE` | `/api/trackers/:id` | Delete tracker |

### Farms

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/farms` | List farms |
| `GET` | `/api/farms/:id` | Farm detail + boundary points |
| `POST` | `/api/farms` | Create farm |
| `PUT` | `/api/farms/:id` | Update farm name / address |
| `DELETE` | `/api/farms/:id` | Delete farm |
| `GET` | `/api/farms/:id/points` | List boundary points |
| `POST` | `/api/farms/:id/points` | Add boundary point (max 20) |
| `PUT` | `/api/farms/:id/points/:pointId` | Update a boundary point |
| `DELETE` | `/api/farms/:id/points` | Delete all points |
| `DELETE` | `/api/farms/:id/points/:pointId` | Delete one point |

### Geofences

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/geofences` | List geofence zones |
| `POST` | `/api/geofences` | Create geofence (`Polygon` or `Circle`) |
| `PUT` | `/api/geofences/:id` | Update geofence |
| `DELETE` | `/api/geofences/:id` | Delete geofence |

### Alerts

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/alerts` | List alerts (last 100); `?unread=true` to filter |
| `PATCH` | `/api/alerts/read-all` | Mark all alerts read |
| `PATCH` | `/api/alerts/:id/read` | Mark single alert read |

### Real-Time *(JWT required)*

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/realtime/status` | MQTT + InfluxDB connection health |
| `GET` | `/api/realtime/locations` | Latest GPS position per tracker (InfluxDB + SQLite join) |
| `GET` | `/api/realtime/history?mac_address=&date=YYYY-MM-DD` | Full day GPS track for one tracker |
| `GET` | `/api/realtime/stream/:macAddress` | SSE — live GPS push for one tracker |

#### `GET /api/realtime/locations` — response schema

Returns an array of the most recent GPS record per registered tracker, joining the latest InfluxDB point with tracker metadata from SQLite.

```json
[
  {
    "mac_address": "AA:BB:CC:DD:EE:FF",
    "tracker_id": "ESP-01",
    "location": "Padang A",
    "latitude": 1.856273,
    "longitude": 103.756489,
    "battery_mv": 3742,
    "timestamp": "2026-06-09T08:00:00Z"
  }
]
```

| Field | Source | Description |
|-------|--------|-------------|
| `mac_address` | SQLite `trackers` / InfluxDB tag | Join key — unique tracker identifier |
| `tracker_id` | SQLite `trackers` | Human-readable tracker name |
| `location` | SQLite `trackers` | Physical location description |
| `latitude` | InfluxDB `tracker` (latest point) | Most recent GPS latitude in decimal degrees |
| `longitude` | InfluxDB `tracker` (latest point) | Most recent GPS longitude in decimal degrees |
| `battery_mv` | InfluxDB `tracker` (latest point) | Most recent battery voltage in millivolts |
| `timestamp` | InfluxDB (server receive time) | ISO 8601 timestamp of the last data point |

### Trackers *(Edge node registration — no JWT)*

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/trackers/register` | None | Register edge node; returns `initial_latitude` + `initial_longitude` from gateway |
| `PATCH` | `/api/trackers/:mac_address` | None | Update `tracker_id` / `location` |
| `GET` | `/api/trackers` | JWT | List all registered trackers |
| `GET` | `/api/trackers/:mac_address` | JWT | Get single tracker |
| `DELETE` | `/api/trackers/:mac_address` | JWT | Remove tracker |

#### Edge Node Authentication Model

The `POST /api/trackers` and `PATCH /api/trackers/:mac_address` endpoints require no JWT. Their authentication model differs from the dashboard and is important to understand correctly.

**Edge node web form credentials (`username` / `password`):**
- These are the credentials that protect the edge node's own built-in HTTP web server (the captive portal shown when a field worker connects to configure the tracker).
- They are stored in the edge node's NVS flash and are never validated, stored, or processed by the API server.
- The `POST /api/trackers` request body includes `username` and `password` fields, but the API reads only `mac_address`, `tracker_id`, and `location` — the credential fields are silently ignored.
- Changing these credentials via the registration or update form updates the edge node's local flash only; the server has no record of them.

**Tracker identity:**
- The `mac_address` is the sole unique identifier used by the server. Any tracker that knows a valid MAC address format can submit a registration request.
- There is currently no server-side protection against unauthorised self-registration. For production deployments, consider adding a pre-shared tracker secret or an allowlist of known MAC addresses.

**`PATCH /api/trackers/:mac_address` (information update):**
- The endpoint is unauthenticated. Any caller who knows the MAC address can update `tracker_id` and `location`.
- In the intended deployment, only the physical edge node itself (running in Information Update mode) calls this endpoint over its own Wi-Fi AP connection.

### Gateway *(Hardware — no JWT)*

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/gateway/location` | Gateway node stores its coordinates on first boot |
| `GET` | `/api/gateway/location` | Read stored gateway coordinates |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Returns `{ status: "ok" }` |

---

## MQTT Integration (API Server)

The API subscribes to `cow/tracker/data` on startup for SSE delivery only. InfluxDB writes are handled exclusively by the bridge service.

**On each message:**
1. Parse JSON payload
2. Look up `mac_address` in the SQLite `trackers` table — discard if not registered
3. Emit `tracker:<mac_address>` SSE event → delivered to clients on `/api/realtime/stream/:macAddress`

| Topic | Direction | Handler |
|-------|-----------|---------|
| `cow/tracker/data` | Gateway → Broker → API | Emit SSE only (bridge handles InfluxDB write) |

---

## Tracker Status Rules

| Condition | Status | Indicator |
|-----------|--------|-----------|
| Last seen < 5 min | Online | Green |
| Last seen 5–15 min | Idle | Yellow |
| Last seen > 15 min | Offline | Red |
| No InfluxDB record | No Signal | Grey |

---

## Battery Display Rules

Battery transmitted as raw millivolts (`battery_mv`):

| Voltage | Level | Indicator |
|---------|-------|-----------|
| ≥ 3700 mV | Good | Green |
| 3500–3699 mV | Low | Yellow |
| < 3500 mV | Critical | Red + warning icon |

---

## Edge Node Credentials *(separate from dashboard login)*

Stored on edge node flash (NVS). Changed via the edge node's own web form.

| Field | Default |
|-------|---------|
| Username | `admin` |
| Password | `admin@1234` |

---

## UI Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Cow→Mana       [breadcrumb path]             [user avatar ▾]    │
├──────────────┬───────────────────────────────────────────────────┤
│  🗺 Real-Time │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐   │
│  📜 History  │  │ Total  │ │ Online │ │ Low Batt│ │No Signal│   │
│  📊 RT Data  │  │   12   │ │   9    │ │    2   │ │    1    │   │
│  🏡 Farm     │  └────────┘ └────────┘ └────────┘ └────────┘   │
│  🐄 Cow      ├───────────────────────────────────────────────────┤
│  📡 Tracker  │                                                   │
│  👥 User     │            MAP  (Leaflet.js)                      │
│              │                                                   │
│  ──────────  │    📍 ESP-01           📍 ESP-02                 │
│  Logout      │                  📍 ESP-03                        │
│              │        [Farm A boundary polygon]                  │
└──────────────┴───────────────────────────────────────────────────┘
```

---

## Folder Structure

```
web/                                              # Next.js 14 App Router
├── public/
│   └── materio/                                  # Materio Bootstrap UI assets
├── src/
│   ├── app/
│   │   ├── layout.tsx                            # Root HTML layout
│   │   ├── page.tsx                              # Root → redirect to /login
│   │   ├── (auth)/
│   │   │   ├── layout.tsx
│   │   │   └── login/
│   │   │       ├── page.tsx
│   │   │       └── LoginForm.tsx
│   │   └── (dashboard)/
│   │       ├── layout.tsx                        # Wraps pages in DashboardShell
│   │       ├── DashboardShell.tsx                # Sidebar + top navbar + profile modal
│   │       ├── dashboard/
│   │       │   └── page.tsx                      # Summary stats (placeholder)
│   │       ├── realtime-map/
│   │       │   ├── page.tsx
│   │       │   ├── MapClient.tsx                 # Leaflet map wrapper (SSR-safe)
│   │       │   └── RealtimeMapClient.tsx         # Polling + SSE + farm overlay
│   │       ├── historical-location/
│   │       │   ├── page.tsx
│   │       │   ├── HistoricalLocationClient.tsx  # Date + tracker selector
│   │       │   └── HistoricalMapClient.tsx       # Leaflet polyline
│   │       ├── realtime-data/
│   │       │   ├── page.tsx
│   │       │   └── RealtimeDataClient.tsx        # Live data table
│   │       ├── farms/
│   │       │   ├── page.tsx
│   │       │   └── FarmsClient.tsx               # Farm CRUD + boundary point editor
│   │       ├── cows/
│   │       │   ├── page.tsx
│   │       │   └── CowsClient.tsx                # Cow CRUD + tracker assignment
│   │       ├── trackers/
│   │       │   ├── page.tsx
│   │       │   └── TrackersClient.tsx            # Tracker CRUD + assign/unassign
│   │       └── users/
│   │           ├── page.tsx
│   │           └── UsersClient.tsx               # User CRUD (Admin only)
│   ├── lib/
│   │   └── api.ts                                # Typed fetch wrapper (auth, cows, trackers, geofences, alerts)
│   └── types/
│       └── index.ts                              # Shared TS interfaces (User, Farm, Cow, Tracker, Geofence, Alert)
├── next.config.js
├── package.json
└── Dockerfile

api/                                              # Express 4 + TypeScript
├── src/
│   ├── app.ts                                    # Express app + route registration
│   ├── index.ts                                  # Server entry, port 3000, connectMqtt()
│   ├── middleware/
│   │   ├── auth.ts                               # JWT Bearer verification
│   │   └── errorHandler.ts                       # Global error handler
│   ├── mqtt/
│   │   └── client.ts                             # Subscribe cow/tracker/data → emit SSE
│   ├── routes/
│   │   ├── auth.ts                               # POST /login, GET /me
│   │   ├── users.ts                              # Admin CRUD /api/users
│   │   ├── cows.ts                               # /api/cows
│   │   ├── trackers.ts                           # /api/trackers
│   │   ├── farms.ts                              # /api/farms + boundary points
│   │   ├── geofences.ts                          # /api/geofences
│   │   ├── alerts.ts                             # /api/alerts
│   │   ├── realtime.ts                           # /api/realtime — locations, history, SSE, status
│   │   ├── trackers.ts                            # /api/trackers — edge node self-registration
│   │   └── gateway.ts                            # /api/gateway/location
│   ├── services/
│   │   ├── db.ts                                 # better-sqlite3, auto-creates all tables on startup
│   │   └── influxdb.ts                           # InfluxDB v3 client
│   ├── seeds/
│   │   └── users.ts                              # npm run seed:users
│   └── types/
│       └── index.ts                              # Shared TS interfaces
├── .env.example
├── Dockerfile
├── package.json
└── tsconfig.json
```

---

## SQLite Tables (managed by `api/src/services/db.ts`)

| Table | Purpose |
|-------|---------|
| `users` | Dashboard login accounts |
| `farms` | Farm records with centre coordinates |
| `farm_points` | GPS boundary polygon points per farm |
| `cows` | Livestock records, linked to farms and trackers |
| `trackers` | Physical tracker hardware, linked to cows |
| `geofences` | Named geographic zones (Polygon / Circle) |
| `geofence_assignments` | Links geofences to cows or globally |
| `alerts` | Geofence breach and low-battery alert log |
| `system_settings` | Key-value config store |
| `trackers` | Edge node self-registrations (mac_address, tracker_id, location, initial coords) |
| `gateway_location` | Single-row table storing the gateway node's GPS coordinates |

---

## Default Dashboard Credentials

Seeded via `npm run seed:users` in `api/src/seeds/users.ts`:

| Role | Username | Password |
|------|----------|----------|
| Admin | `admin` | `Admin@1234` |
| User | `johndoe` | `User@1234` |
