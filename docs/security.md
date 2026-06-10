# Security Considerations

*Last updated: 2026-06-09*

This document describes the current security posture of Project COW and the minimum steps required before any production or internet-facing deployment.

The default configuration is intentionally permissive to simplify local development. **None of the defaults below are safe for production.**

---

## Current Security State (Development)

| Area | Current State | Risk |
|------|--------------|------|
| MQTT broker | Anonymous access, no TLS | Any tracker on the network can publish or subscribe to any topic |
| Edge node HTTP | Plain HTTP, no TLS | Credentials and tracker data transmitted in cleartext over Wi-Fi |
| `POST /api/trackers` | No authentication, no rate limiting | Any caller who can reach the API can register arbitrary trackers |
| `PATCH /api/trackers/:mac_address` | No authentication | Any caller who knows a MAC address can update tracker metadata |
| JWT secret | Hardcoded in `docker-compose.yml` | Predictable secret; tokens can be forged if the value is leaked |
| InfluxDB token | Hardcoded in `docker-compose.yml` | Predictable token; direct time-series read/write access if leaked |
| Docker network | All containers on shared `cow_network` | Container-to-container traffic is unencrypted |

---

## MQTT Broker (Mosquitto)

**Current:** `allow_anonymous true` in `mosquitto/config/mosquitto.conf`. No TLS configured.

**Risks:**
- Any tracker on the same network can publish spoofed GPS packets to `cow/tracker/data`.
- Any tracker can subscribe to all topics and read all GPS and registration data.

**Production requirements:**
1. Set `allow_anonymous false` in `mosquitto.conf`.
2. Create a Mosquitto password file (`mosquitto_passwd`) with separate credentials for the gateway node, bridge, and API.
3. Enable TLS: generate a CA certificate, server certificate, and client certificates; configure `cafile`, `certfile`, `keyfile` in `mosquitto.conf`.
4. Update `MQTT_USERNAME` and `MQTT_PASSWORD` environment variables in `docker-compose.yml` for bridge and API containers.
5. Update gateway node firmware with MQTT credentials and CA certificate for TLS verification.

---

## Edge Node HTTP (Registration and Update)

**Current:** The edge node's captive portal and API calls use plain HTTP. Credentials (`username`/`password`) and tracker data are sent in cleartext.

**Risks:**
- Anyone with Wi-Fi access to the edge node's AP can intercept credentials.
- The API does not validate these credentials — they are for the local captive portal only. See `docs/dashboard.md` → Edge Node Authentication Model.

**Production requirements:**
1. Enable HTTPS on the edge node's built-in web server (requires certificate provisioning to flash).
2. Enable HTTPS on the API (reverse proxy with TLS termination, e.g. nginx + Let's Encrypt, is the practical approach for Docker deployments).
3. Document and enforce a credential rotation policy for field workers.

---

## API Endpoints

**Current:** `POST /api/trackers` and `PATCH /api/trackers/:mac_address` require no authentication and have no rate limiting. The `mac_address` field is the sole tracker identifier.

**Risks:**
- Any caller who can reach the API can self-register a tracker with any MAC address.
- Any caller who knows a MAC address can overwrite `tracker_id` and `location`.
- No rate limiting means the `trackers` table can be flooded with registrations.

**Production requirements:**
1. Add a pre-shared tracker secret (e.g. a per-tracker token provisioned at manufacture) to the registration payload and validate it server-side.
2. Alternatively, maintain an allowlist of approved MAC addresses and reject unknown MACs at registration.
3. Add rate limiting to `POST /api/trackers` (e.g. `express-rate-limit`) — suggested limit: 10 registrations per hour per IP.
4. Consider requiring a one-time registration token issued by an administrator before an edge node can self-register.

---

## JWT Secret

**Current:** `JWT_SECRET=cow-jwt-super-secret-change-in-production` is hardcoded in `docker-compose.yml`.

**Risk:** If this value is committed to a public repository or leaked, all issued JWTs can be forged.

**Production requirements:**
1. Replace with a cryptographically random string of at least 32 bytes (e.g. `openssl rand -hex 32`).
2. Store the secret in an environment variable or secret manager — never hardcode it in version-controlled files.
3. Add `docker-compose.yml` to `.gitignore` or use a `docker-compose.override.yml` for secrets that is excluded from the repository.

---

## InfluxDB Token

**Current:** `INFLUX_TOKEN=cow-super-secret-token` is hardcoded in `docker-compose.yml`.

**Risk:** Direct read/write access to all time-series data if the token is leaked.

**Production requirements:**
1. Replace with a randomly generated InfluxDB API token (generate via the InfluxDB UI after first run).
2. Store in an environment variable or secret manager — not in version-controlled files.
3. Create a separate read-only token for any service that only needs to query InfluxDB (e.g. dashboard queries).

---

## Minimum Production Checklist

Before exposing any service to a non-development network:

- [ ] MQTT: `allow_anonymous false`, credentials configured for all MQTT clients
- [ ] MQTT: TLS enabled (CA + server certificate)
- [ ] API: HTTPS enabled (TLS termination via reverse proxy)
- [ ] JWT secret: replaced with a cryptographically random value, stored outside version control
- [ ] InfluxDB token: replaced with a randomly generated token, stored outside version control
- [ ] `POST /api/trackers`: rate limiting and tracker pre-authorisation mechanism in place
- [ ] InfluxDB and API admin credentials changed from defaults
- [ ] Docker network: consider isolating bridge and API on a separate internal network from the web container
