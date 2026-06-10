# Documentation Issues — Project COW

Review conducted: 2026-06-09  
Reviewer: Senior System Analyst

---

## Priority Legend

| Priority | Meaning |
|----------|---------|
| Critical | Fix before implementation begins |
| High | Fix before system integration testing |
| Medium | Fix before first production deployment |
| Missing | Add before handover to operations team |
| Minor | Address in next documentation revision |

---

## Critical Issues

### ISSUE-01 — Sleep time fallback conflicts with database default
**File:** `bridge/src/db.ts`, `docs/data_bridge.md`  
**Status:** Resolved  
The `getSleepTimeSec()` fallback is **30 seconds** but the `trackers` table default is **300 seconds** (5 minutes). A new tracker with no tracker record will sleep for 30 s instead of 300 s. The discrepancy is undocumented and will produce unexpected behaviour on first deployment.  
**Fix:** Align the bridge fallback to 300 s to match the database default, or explicitly document the intentional difference and the reason.

---

### ISSUE-02 — ESP-NOW ack payload missing from `edge_node_payloads.md`
**File:** `docs/edge_node_payloads.md`  
**Status:** Resolved  
The file documents all payloads the edge node sends and receives over HTTP, and the outbound ESP-NOW packet — but the inbound ESP-NOW ack from the gateway (`{"status":"ok","sleep_time_sec":N}`) is never documented. This is the payload the edge node must parse and act on in every Normal Operation cycle.  
**Fix:** Add Section 4: "Normal Operation — Ack Received from Gateway (ESP-NOW)" with payload structure, field descriptions, NVS flash storage note, and fallback behaviour.

---

### ISSUE-03 — ESP-NOW peer registration race condition in gateway
**File:** `docs/gateway_node_process_flow.md`  
**Status:** Resolved  
The flow diagram shows the gateway registering the edge node MAC as an ESP-NOW peer inside the `cow/tracker/ack` MQTT callback, then immediately calling `esp_now_send()`. In ESP-NOW, `esp_now_add_peer()` must complete before `esp_now_send()`. If the ack fires before the peer is registered, the send fails silently. Peer registration should happen in `OnDataReceived` (when the gateway first receives a packet from an edge node), before the MQTT callback ever fires.  
**Fix:** Move peer registration step to the `OnDataReceived` callback. The ack callback should only check if peer exists and send — not register. Document this ordering explicitly in the States table and Notes.

---

### ISSUE-04 — `POST /api/trackers` authentication model undocumented
**File:** `docs/dashboard.md`, `docs/edge_node_payloads.md`  
**Status:** Resolved  
The endpoint table marks `POST /api/trackers` as Auth: None, but the request body includes `username` and `password`. It is never explained who validates these credentials, what happens if wrong credentials are submitted, or whether any tracker can self-register with any MAC address. The API code does not validate or store these fields — they are edge-node-local credentials only — but this is never stated.  
**Fix:** Add an "Edge Node Authentication" subsection in `dashboard.md` clarifying: (1) `username`/`password` are the edge node's own web form credentials stored in NVS flash; (2) the API does not validate them; (3) the MAC address is the unique tracker identifier; (4) there is currently no server-side protection against unauthorised self-registration.

---

## High Priority Issues

### ISSUE-05 — Last known GPS coordinates storage location unspecified
**File:** `docs/edge_node_process_flow.md`  
**Status:** Resolved  
The Normal Operation flow shows a fallback to "Use Last Known GPS Coordinates" on timeout, but nowhere states that these are persisted in NVS flash. A firmware developer would not know whether to store them in RAM (lost on deep sleep) or flash (persisted across cycles), which is a critical implementation decision.  
**Fix:** Added "Store GPS Coords to NVS Flash" step after successful GPS fix in the flow diagram. Updated States table with NVS key names (`gps/last_latitude`, `gps/last_longitude`). Added Note specifying keys, persistence across deep sleep, and first-boot fallback to initial registration coordinates.

---

### ISSUE-06 — Normal Operation GPS timeout loop is ambiguous
**File:** `docs/edge_node_process_flow.md`  
**Status:** Resolved  
The "No" path from "GPS Fix Acquired?" branches to "Timeout Reached?" — but the "No" path from "Timeout Reached?" loops back to "Wait for GPS Fix" via a shared arrow, creating an ambiguous structure with no visible maximum duration or termination condition. A firmware developer cannot determine when the loop ends.  
**Fix:** Replaced the double-branch ("Wait for GPS Fix" → "GPS Fix Acquired?" → "Timeout Reached?" loop) with a single clean decision: "Wait for GPS Fix (NMEA parsing, max T seconds)" → "GPS Fix Acquired?" → Yes: Store to NVS Flash → Build Payload | No/Timeout: Use Last Known GPS Coordinates (from NVS flash) → Build Payload. Removed the intermediate "Timeout Reached?" node entirely.

---

### ISSUE-07 — `trackers` table schema missing from `data_bridge.md`
**File:** `docs/data_bridge.md`  
**Status:** Resolved  
The bridge now queries `trackers.sleep_time_sec` by `mac_address`, but only the `trackers` table schema is documented in `data_bridge.md`. Any developer extending the bridge must infer the `trackers` schema from other documents.  
**Fix:** Added `trackers` table schema section after `trackers` in the SQLite Schema section. All columns documented including `sleep_time_sec` (DEFAULT 300), `battery_threshold` (DEFAULT 20), `status`, `assigned_cow_id` FK, and timestamps. Added a note explaining the `trackers`↔`trackers` relationship and the 300 s fallback behaviour when no tracker record exists. Also fixed two leftover ISSUE-01 artifacts in this file: `30 s` fallback in the handler description and `"sleep_time_sec": 30` in the ack payload example — both corrected to `300`.

---

### ISSUE-08 — Data flow steps 4–6 incorrectly shown as sequential
**File:** `docs/setup.md`  
**Status:** Resolved  
Data flow steps 4–5 (bridge InfluxDB write → gateway acks edge node) and step 6 (API emits SSE to dashboard) are parallel, independent flows both triggered by the same `cow/tracker/data` message. Presenting them as a numbered sequence implies they are serial, which would mislead a developer debugging latency or tracing message flow.  
**Fix:** Merged old steps 4–6 into a single step 4 with two parallel sub-flows under a single bullet each (Bridge and API), making the concurrency explicit. Total steps reduced from 7 to 5.

---

### ISSUE-09 — MQTT Topics table in gateway doc is one-directional
**File:** `docs/gateway_node_process_flow.md`  
**Status:** Resolved  
The MQTT Topics table uses a single "Direction" column showing only the gateway's perspective (e.g., `cow/tracker/data` as "Gateway → Broker"). It does not show the subscribers (Bridge, API) or that some topics flow in both directions in the broader system. This is inconsistent with the `services.md` topics table which uses Publisher/Subscriber columns.  
**Fix:** Replaced the Direction column with Publisher and Subscriber(s) columns, matching the `services.md` format. All four topics now show their full publisher and subscriber list.

---

### ISSUE-10 — Stale developer notes in `dashboard.md`
**File:** `docs/dashboard.md`  
**Status:** Resolved  
Two sections are internal developer notes, not reference documentation:  
(1) "Source Project" — references an absolute path on a developer's machine (`D:\project\archieved\cow-tracker`)  
(2) "Web files still needing adaptation" — an open TODO list of incomplete implementation work  
These will be confusing or misleading once the adaptation is complete and do not belong in a reference document.  
**Fix:** Removed "Source Project" section entirely. Removed "Web files still needing adaptation" table. Removed two "Adaptation needed:" paragraphs from the Real-Time Map and Real-Time Data page descriptions. Removed `⚠ needs adaptation` inline comments from the Folder Structure code block. Also corrected stale `api/mqtt/client.ts` comment (`→ InfluxDB + SSE` → `→ emit SSE`). The "Adaptations from Archived Project" table is retained as it documents intentional design decisions.

---

## Medium Priority Issues

### ISSUE-11 — `trackers` ↔ `trackers` relationship never documented
**File:** `docs/data_bridge.md`, `docs/dashboard.md`  
**Status:** Resolved  
Both `trackers` and `trackers` tables use `mac_address` as a key field, but no document explains: how they relate, whether they must have the same MAC, what happens when a tracker is in `trackers` but not in `trackers` (currently: sleep falls back to 30 s — see ISSUE-01), or the expected lifecycle (tracker self-registers → dashboard user creates tracker entry → tracker assigned to cow).  
**Fix:** Added "Tracker vs Tracker Records" section to `data_bridge.md` (after SQLite Schema). Includes a comparison table (creator, manager, cow link, sleep_time_sec ownership, purpose), a relationship note (shared mac_address key), and a 4-step onboarding lifecycle (self-register → create tracker → assign to cow → bridge reads sleep_time_sec). Blockquote clarifies fallback behaviour when `trackers` record is absent.

---

### ISSUE-12 — Multi-tracker concurrency not addressed in gateway doc
**File:** `docs/gateway_node_process_flow.md`  
**Status:** Resolved  
The main loop handles one ESP-NOW packet at a time, but multiple edge nodes may transmit near-simultaneously. The docs are silent on queuing, packet ordering, and potential loss under load. The `OnDataReceived` callback fires in interrupt context and must buffer packets to the main loop (already noted), but the MQTT ack callbacks also queue — and multiple acks could arrive before any are processed.  
**Fix:** Added a "Multi-tracker concurrency" note to the Notes section of `gateway_node_process_flow.md`. Explains that packets are buffered into a queue and drained sequentially in the main loop; ack callbacks similarly queued by `mqttClient.loop()`; no packets dropped by design; back-to-back arrivals add one loop iteration of latency; recommends staggering sleep times for dense deployments.

---

### ISSUE-13 — Sleep time unit conversion never documented for firmware
**File:** `docs/edge_node_process_flow.md`  
**Status:** Resolved  
`trackers.sleep_time_sec` is stored and transmitted in **seconds**. The ESP32 `esp_deep_sleep()` function takes **microseconds**. The firmware conversion is never documented, leaving room for a unit error (sleeping 30 microseconds instead of 30 seconds).  
**Fix:** Applied during ISSUE-05/06 resolution — the note "`esp_deep_sleep()` takes microseconds — convert `sleep_time_sec` with `sleep_time_sec * 1,000,000`" was added to the Normal Operation Notes section of `edge_node_process_flow.md`.

---

### ISSUE-14 — "Next.js rewrite at build time" is technically incorrect
**File:** `docs/services.md`  
**Status:** Resolved  
The Web Dashboard section states: "API proxy: `/api/*` → `http://api:3000/api/*` (Next.js rewrite at build time)." Next.js rewrites in `next.config.js` are applied at **request time** by the Next.js server, not at build time. The `API_URL` build argument is baked in at build time, but the rewrite itself runs at request time.  
**Fix:** Updated the API proxy row in the Web Dashboard table to: "Next.js rewrite — `API_URL` baked in at build time via Docker build arg, rewrite applied at request time."

---

### ISSUE-15 — Registration and update step ordering is ambiguous
**File:** `docs/data_bridge.md`  
**Status:** Resolved  
Both Registration and Update flows show: write SQLite → publish MQTT → respond to edge node. This implies the MQTT publish blocks the HTTP response. In practice the HTTP response should be sent before or simultaneously with the fire-and-forget MQTT publish.  
**Fix:** Reordered both flows to: write SQLite → respond to edge node → publish MQTT (fire-and-forget). Added "fire-and-forget" label to the MQTT publish step in both flows. Updated the closing blockquote to include: "The MQTT publish is fire-and-forget and does not delay the HTTP response to the edge node."

---

## Missing Sections

### ISSUE-16 — No error handling and resilience documentation
**File:** Missing across all docs  
**Status:** Resolved  
No document describes what happens when a component goes down mid-operation. Key failure scenarios not covered: bridge crashes after InfluxDB write but before ack publish (edge node times out, uses flash sleep value — undocumented as designed behaviour); InfluxDB unavailable (no ack published); API unavailable during edge node registration (max retry count and backoff undefined).  
**Fix:** Added "Resilience & Error Handling" section to `data_bridge.md`. Includes an 8-row failure scenario table (scenario, affected components, outcome, GPS data lost?) covering: InfluxDB failure, bridge crash at various points, MQTT broker outage, API unavailable at registration, gateway connectivity loss, ESP-NOW delivery failure. Followed by four "key design properties" summarising the always-sleep guarantee, NVS flash fallback, stateless bridge restart, and authoritative API write.

---

### ISSUE-17 — No security documentation
**File:** Missing across all docs  
**Status:** Resolved  
No document covers security in any detail beyond a single line in `services.md` Notes. Unaddressed risks: MQTT broker uses anonymous access with no TLS; edge node credentials transmitted over plain HTTP; `POST /api/trackers` has no rate limiting; JWT secret is hardcoded in `docker-compose.yml`.  
**Fix:** Created `docs/security.md`. Covers: current security state summary table, MQTT anonymous access and TLS hardening steps, edge node plain-HTTP credential exposure, API endpoint risks and pre-authorisation options, JWT secret rotation, InfluxDB token rotation, and a minimum production checklist with 8 items.

---

### ISSUE-18 — Timestamp strategy and limitations undocumented
**File:** `docs/data_bridge.md`  
**Status:** Resolved  
InfluxDB records use "server receive time" as the timestamp (set by the bridge). The edge node has no RTC and no NTP — it has no concept of absolute time. If MQTT delivery is delayed, the InfluxDB timestamp will be inaccurate relative to when the GPS reading was taken. The historical location feature depends on these timestamps. This design decision and its limitations are never discussed.  
**Fix:** Added a blockquote note after the InfluxDB write table in `data_bridge.md` explaining: timestamps reflect broker receipt time, the edge node has no RTC/NTP, normal latency is under 1 second, and packets delayed by broker outages will have distorted timestamps that affect historical track replay.

---

### ISSUE-19 — Service startup order not documented in `services.md`
**File:** `docs/services.md`  
**Status:** Resolved  
`data_bridge.md` notes that the bridge depends on the API starting first (so SQLite is initialised). But `services.md` — the operational reference — does not mention this dependency. A DevOps engineer reading only `services.md` would not know why the bridge fails on a cold start.  
**Fix:** Added a "Startup Order" section to `services.md` (before Notes). Shows the four-stage order: influxdb + mosquitto → api → bridge + web (concurrent). Includes a note explaining the graceful fallback if bridge starts before API.

---

### ISSUE-20 — `GET /api/realtime/locations` response schema undocumented
**File:** `docs/dashboard.md`  
**Status:** Resolved  
The Real-Time Map page polls `GET /api/realtime/locations` every 10 seconds. The description says "InfluxDB + SQLite join" but never defines which fields come from each source, what the join key is, or what the response schema looks like. Frontend developers cannot implement or debug this without the schema.  
**Fix:** Added a `#### GET /api/realtime/locations — response schema` subsection under the Real-Time endpoints table in `dashboard.md`. Includes a JSON example and a 7-row field table showing each field's source (SQLite `trackers` or InfluxDB `tracker` latest point) and description.

---

## Minor Issues

### ISSUE-21 — No document versioning or last-updated dates
**File:** All docs  
**Status:** Resolved  
No document carries a version number, last-updated date, or author. When docs evolve alongside the codebase, there is no way to tell which doc revision matches which code revision.  
**Fix:** Added `*Last updated: 2026-06-09*` immediately after the H1 heading in all nine documents: `setup.md`, `edge_node_process_flow.md`, `edge_node_payloads.md`, `gateway_node_process_flow.md`, `data_bridge.md`, `dashboard.md`, `services.md`, `security.md`, and `CLAUDE.md`.

---

### ISSUE-22 — Architecture diagram line wraps on narrow terminals
**File:** `CLAUDE.md`  
**Status:** Resolved  
The ack flow line in the Architecture section is very long and will wrap on standard 80–120 character terminals, breaking the ASCII art alignment.  
**Fix:** Split the Bridge ack flow across three lines: Bridge → InfluxDB / └── write success → publish cow/tracker/ack / └──► Gateway → ESP-NOW → Edge Node. All lines now under 90 characters.

---

### ISSUE-23 — Payload Structure section duplicates Normal Operation diagram
**File:** `docs/edge_node_process_flow.md`  
**Status:** Resolved  
The "Payload Structure" table at the bottom of the file lists the same fields already shown in the "Build Payload" box in the Normal Operation flow diagram. One is redundant.  
**Fix:** Removed the standalone "## Payload Structure" section (field table + JSON example) from `edge_node_process_flow.md`. The "Build Payload" box in the diagram remains. Full payload documentation is in `edge_node_payloads.md`.

---

### ISSUE-24 — Architecture Overview in `setup.md` is too compressed
**File:** `docs/setup.md`  
**Status:** Resolved  
The "Architecture Overview" section uses a single compressed one-line ASCII diagram that is too dense for a setup document. The multi-level diagram in `CLAUDE.md` is much clearer.  
**Fix:** Replaced the one-liner with a multi-level diagram showing Edge Node → Gateway → Mosquitto → Bridge/API parallel flows (including the ack chain), plus the HTTP registration and gateway location flows — matching the structure in `CLAUDE.md` and using the ISSUE-22 line-wrapped ack flow.

---

### ISSUE-25 — Registration response description missing `mac_address` field
**File:** `docs/data_bridge.md`  
**Status:** Resolved  
In the Registration flow, step 5 describes the API response as `{status, tracker_id, location, initial_latitude, initial_longitude, registered_at}` — omitting `mac_address`, which is present in both the actual response and in `edge_node_payloads.md`.  
**Fix:** Added `mac_address` to the response field list in Registration flow step 4 — now reads `{status, tracker_id, location, mac_address, initial_latitude, initial_longitude, registered_at}`.

---

### ISSUE-26 — First boot NVS flag name unspecified in gateway doc
**File:** `docs/gateway_node_process_flow.md`  
**Status:** Resolved  
The "First Boot?" check description says "check flash" but does not name the NVS namespace, key, or flag value used. Firmware developers need this to implement the check.  
**Fix:** Updated the flow diagram box label from "(check flash)" to "(NVS: gateway/first_boot_done)". Updated the First Boot Check row in the States table to specify the full NVS key (`gateway/first_boot_done`), absent/0 = first boot, and that it is set to `1` after coordinates are stored.

---

### ISSUE-27 — Bridge `services.md` section omits `cow/tracker/register` and `cow/tracker/update` subscriptions
**File:** `docs/services.md`  
**Status:** Resolved  
The Bridge service section lists only `cow/tracker/data` under "MQTT Subscription". The bridge also subscribes to `cow/tracker/register` and `cow/tracker/update`, which are omitted entirely.  
**Fix:** Already applied in a prior session — the MQTT Subscriptions row in `services.md` already reads: `cow/tracker/data`, `cow/tracker/register`, `cow/tracker/update`.

---

## Summary

| Priority | Count | Issues |
|----------|-------|--------|
| Critical | 4 | ISSUE-01 to ISSUE-04 |
| High | 6 | ISSUE-05 to ISSUE-10 |
| Medium | 5 | ISSUE-11 to ISSUE-15 |
| Missing sections | 5 | ISSUE-16 to ISSUE-20 |
| Minor | 7 | ISSUE-21 to ISSUE-27 |
| **Total** | **27** | |
