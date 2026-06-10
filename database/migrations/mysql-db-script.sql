-- ==============================================================================
-- Cow Tracker Web Application - MySQL Database Schema
-- ==============================================================================

USE `iot-apps2`;

-- ------------------------------------------------------------------------------
-- 1. User Management Module
-- ------------------------------------------------------------------------------
CREATE TABLE users (
    id           INT AUTO_INCREMENT NOT NULL,
    name         VARCHAR(100) NOT NULL,
    username     VARCHAR(50) NOT NULL,
    avatar       MEDIUMTEXT NULL,
    email        VARCHAR(150) NOT NULL,
    phone        VARCHAR(20) DEFAULT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role         ENUM('Admin', 'User') NOT NULL DEFAULT 'User',
    status       ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
    created_at   TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY username (username),
    UNIQUE KEY email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------------------------
-- 2. Farm Management Module
-- ------------------------------------------------------------------------------
CREATE TABLE farms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    address VARCHAR(255) NULL,
    center_lat DECIMAL(10, 7) NULL,
    center_lng DECIMAL(10, 7) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE farm_points (
    id INT AUTO_INCREMENT PRIMARY KEY,
    farm_id INT NOT NULL,
    sequence INT NOT NULL,
    latitude DECIMAL(10, 7) NOT NULL,
    longitude DECIMAL(10, 7) NOT NULL,
    UNIQUE KEY unique_farm_sequence (farm_id, sequence),
    FOREIGN KEY (farm_id) REFERENCES farms(id) ON DELETE CASCADE
);

-- ------------------------------------------------------------------------------
-- 3. Livestock (Cow) Management Module
-- ------------------------------------------------------------------------------
CREATE TABLE cows (
    id INT AUTO_INCREMENT PRIMARY KEY,
    farm_id INT NULL,
    tag_number VARCHAR(50) UNIQUE NULL,
    name VARCHAR(100) NULL,
    breed VARCHAR(100) NULL,
    dob DATE NULL,
    sex ENUM('Male', 'Female') NULL,
    status ENUM('Pair', 'Unpair') NOT NULL DEFAULT 'Unpair',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (farm_id) REFERENCES farms(id) ON DELETE SET NULL
);

-- ------------------------------------------------------------------------------
-- 3. Cow Tracker Management Module
-- ------------------------------------------------------------------------------
CREATE TABLE trackers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    board_id VARCHAR(50) UNIQUE NOT NULL,
    mac_address VARCHAR(50) UNIQUE NOT NULL,
    assigned_cow_id INT UNIQUE NULL, -- UNIQUE ensures strict 1:1 pairing
    sleep_time_sec INT DEFAULT 300,
    battery_threshold INT DEFAULT 20,
    status ENUM('Active', 'Inactive', 'Maintenance') NOT NULL DEFAULT 'Inactive',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    -- Pairing Logic: Links tracker to a cow. If the cow is deleted, unpair the tracker (SET NULL)
    FOREIGN KEY (assigned_cow_id) REFERENCES cows(id) ON DELETE SET NULL
);

-- ------------------------------------------------------------------------------
-- 4. Geofencing & Alert Module
-- ------------------------------------------------------------------------------
CREATE TABLE geofences (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    type ENUM('Polygon', 'Circle') NOT NULL,
    boundary_data JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE geofence_assignments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    geofence_id INT NOT NULL,
    cow_id INT NULL,
    assignment_type ENUM('Global', 'Individual') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- If a geofence or cow is deleted, remove their assignments automatically
    FOREIGN KEY (geofence_id) REFERENCES geofences(id) ON DELETE CASCADE,
    FOREIGN KEY (cow_id) REFERENCES cows(id) ON DELETE CASCADE
);

CREATE TABLE alerts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    cow_id INT NOT NULL,
    geofence_id INT NULL, -- NULL allowed for non-geofence alerts (e.g., Low_Battery)
    alert_type ENUM('Exit', 'Enter', 'Low_Battery') NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- If a cow or geofence is deleted, cascade the deletion of their alerts
    FOREIGN KEY (cow_id) REFERENCES cows(id) ON DELETE CASCADE,
    FOREIGN KEY (geofence_id) REFERENCES geofences(id) ON DELETE CASCADE
);

-- ------------------------------------------------------------------------------
-- 5. System Configuration Module
-- ------------------------------------------------------------------------------
-- NOTE: MQTT broker connection settings are intentionally NOT stored in the
-- database. They belong in the API .env file as environment variables:
--
--   MQTT_PROTOCOL=mqtt          # mqtt:// (standard) | mqtts:// (TLS)
--   MQTT_HOST=127.0.0.1         # IP address or hostname
--   MQTT_PORT=1883              # 1883 (unencrypted) | 8883 (TLS)
--   MQTT_USERNAME=              # leave blank if broker requires no auth
--   MQTT_PASSWORD=              # leave blank if broker requires no auth
--
-- Rationale: The MQTT client connects at process startup before any DB query
-- can run. Storing credentials in the DB also creates an unnecessary security
-- surface. Use .env (gitignored) to keep secrets out of version control.
-- ------------------------------------------------------------------------------
CREATE TABLE system_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    setting_key VARCHAR(50) UNIQUE NOT NULL,
    setting_value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);