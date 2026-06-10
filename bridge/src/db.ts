import Database from 'better-sqlite3';
import path from 'path';

const dbPath = process.env.DB_PATH ?? path.join(__dirname, '../../data/database.sqlite');

let db: Database.Database | null = null;

function getDb(): Database.Database | null {
  if (db) return db;
  try {
    db = new Database(dbPath);
    return db;
  } catch {
    return null;
  }
}

export function isDeviceRegistered(macAddress: string): boolean {
  const conn = getDb();
  if (!conn) return true; // SQLite not yet available — allow through
  try {
    const row = conn.prepare(
      'SELECT id FROM trackers WHERE UPPER(mac_address) = UPPER(?)'
    ).get(macAddress);
    return !!row;
  } catch {
    return true;
  }
}

export function getSleepTimeSec(macAddress: string): number {
  const conn = getDb();
  if (!conn) return 15;
  try {
    const row = conn.prepare(
      'SELECT sleep_time_sec FROM trackers WHERE UPPER(mac_address) = UPPER(?)'
    ).get(macAddress) as { sleep_time_sec: number } | undefined;
    return row?.sleep_time_sec ?? 15;
  } catch {
    return 15;
  }
}
