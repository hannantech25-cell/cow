const Database = require('better-sqlite3');
const db = new Database('/app/data/database.sqlite', { readonly: true });

// Schema inspection
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('TABLES:' + JSON.stringify(tables.map(t => t.name)));

const fpSchema = db.prepare("PRAGMA table_info(farm_points)").all();
console.log('FARM_POINTS_SCHEMA:' + JSON.stringify(fpSchema, null, 2));

const gfSchema = db.prepare("PRAGMA table_info(geofences)").all();
console.log('GEOFENCES_SCHEMA:' + JSON.stringify(gfSchema, null, 2));

const cowSchema = db.prepare("PRAGMA table_info(cows)").all();
console.log('COWS_SCHEMA:' + JSON.stringify(cowSchema, null, 2));

// Farm
const farm = db.prepare("SELECT * FROM farms WHERE name LIKE '%Pagoh%'").get();
console.log('FARM:' + JSON.stringify(farm, null, 2));

// Farm boundary points
const pts = db.prepare('SELECT * FROM farm_points WHERE farm_id = ?').all(farm.id);
console.log('FARM_POINTS:' + JSON.stringify(pts, null, 2));

// Geofences for this farm
const gf = db.prepare('SELECT * FROM geofences WHERE name LIKE ? OR name LIKE ?').all('%Pagoh%', '%pagoh%');
console.log('GEOFENCES:' + JSON.stringify(gf, null, 2));

// Cow Milah
const cow = db.prepare("SELECT * FROM cows WHERE name LIKE '%Milah%'").get();
console.log('COW:' + JSON.stringify(cow, null, 2));

if (cow) {
  const tracker = db.prepare('SELECT * FROM trackers WHERE assigned_cow_id = ?').get(cow.id);
  console.log('TRACKER:' + JSON.stringify(tracker, null, 2));
}

db.close();
