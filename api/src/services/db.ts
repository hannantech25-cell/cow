import Database from 'better-sqlite3';
import path from 'path';

const dbPath = process.env.DB_PATH ?? path.join(__dirname, '../../database.sqlite');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    username      TEXT NOT NULL UNIQUE,
    avatar        TEXT,
    email         TEXT NOT NULL UNIQUE,
    phone         TEXT,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'User' CHECK(role IN ('Admin','User')),
    status        TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','Inactive')),
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS farms (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    address    TEXT,
    center_lat REAL,
    center_lng REAL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS farm_points (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    farm_id    INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    sequence   INTEGER NOT NULL,
    latitude   REAL NOT NULL,
    longitude  REAL NOT NULL,
    UNIQUE(farm_id, sequence)
  );

  CREATE TABLE IF NOT EXISTS cows (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    farm_id    INTEGER REFERENCES farms(id) ON DELETE SET NULL,
    tag_number TEXT UNIQUE,
    name       TEXT,
    breed      TEXT,
    dob        TEXT,
    sex        TEXT CHECK(sex IN ('Male','Female')),
    status     TEXT NOT NULL DEFAULT 'Unpair' CHECK(status IN ('Pair','Unpair')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS geofences (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    type          TEXT NOT NULL CHECK(type IN ('Polygon','Circle')),
    boundary_data TEXT NOT NULL,
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS geofence_assignments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    geofence_id     INTEGER NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
    cow_id          INTEGER REFERENCES cows(id) ON DELETE CASCADE,
    assignment_type TEXT NOT NULL CHECK(assignment_type IN ('Global','Individual')),
    created_at      TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    cow_id     INTEGER NOT NULL REFERENCES cows(id) ON DELETE CASCADE,
    geofence_id INTEGER REFERENCES geofences(id) ON DELETE CASCADE,
    alert_type TEXT NOT NULL CHECK(alert_type IN ('Exit','Enter','Low_Battery')),
    is_read    INTEGER NOT NULL DEFAULT 0,
    timestamp  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS system_settings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    setting_key   TEXT NOT NULL UNIQUE,
    setting_value TEXT NOT NULL,
    updated_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS trackers (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    mac_address       TEXT NOT NULL UNIQUE,
    tracker_id        TEXT NOT NULL,
    board_id          TEXT,
    location          TEXT NOT NULL,
    initial_latitude  REAL,
    initial_longitude REAL,
    sleep_time_sec    INTEGER DEFAULT 15,
    battery_threshold INTEGER DEFAULT 20,
    status            TEXT NOT NULL DEFAULT 'Inactive' CHECK(status IN ('Active','Inactive','Maintenance')),
    assigned_cow_id   INTEGER UNIQUE REFERENCES cows(id) ON DELETE SET NULL,
    registered_at     TEXT DEFAULT (datetime('now')),
    updated_at        TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gateway_location (
    id         INTEGER PRIMARY KEY CHECK(id = 1),
    latitude   REAL NOT NULL,
    longitude  REAL NOT NULL,
    stored_at  TEXT DEFAULT (datetime('now'))
  );
`);

export default db;
