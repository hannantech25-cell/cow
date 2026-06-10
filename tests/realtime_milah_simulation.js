'use strict';
// =============================================================================
// Real-Time Simulation: Milah Cow Movement -- Ladang Pagoh
// Cow    : Milah (id=2, tag=TRACKER-01, farm_id=2)
// Tracker: TRACKER-01 / MAC AA:BB:CC:DD:EE:FF (id=21, assigned_cow_id=2)
// Mode   : Real-time MQTT  cow/tracker/data  every 15 seconds
// Path   : 37 original waypoints interpolated to 721 pts/cycle (20 steps/seg)
// Loop   : Continuous -- Ctrl+C to stop
// Run    : docker exec -it bridge node /tmp/realtime_milah_simulation.js
// =============================================================================

const mqtt = require('mqtt');

const MAC        = 'AA:BB:CC:DD:EE:FF';
const TRACKER_ID = 'TRACKER-01';
const INTERVAL   = 15000;  // ms between publishes
const TOPIC      = 'cow/tracker/data';
const BROKER     = 'mqtt://mosquitto:1883';

// --- Ladang Pagoh fence (farm_points farm_id=2, ordered by sequence) ---
// [lat, lng]
const FENCE = [
  [2.149124793923078,  102.73047281043128],
  [2.148454713183066,  102.72988806195077],
  [2.14777927149958,   102.73066631457559],
  [2.1479508122728954, 102.73160539000985],
  [2.148824597787911,  102.73152477052949],
  [2.148824597787911,  102.73090755810660],
];

function pointInPolygon(lat, lng) {
  const n = FENCE.length;
  let inside = false, j = n - 1;
  for (let i = 0; i < n; i++) {
    const [yi, xi] = FENCE[i];
    const [yj, xj] = FENCE[j];
    if ((yi > lat) !== (yj > lat) &&
        lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
    j = i;
  }
  return inside;
}

// --- Original 37 waypoints ---
// Inside 09:00-09:55 | Outside west 10:10-10:20 | Inside 10:25-11:25
// Outside north 11:30-11:40 | Inside 11:45-12:00
const ORIG_WP = [
  [2.14875, 102.73090],  // 0  09:00 Inside
  [2.14870, 102.73100],  // 1  09:05 Inside
  [2.14862, 102.73115],  // 2  09:10 Inside
  [2.14850, 102.73120],  // 3  09:15 Inside
  [2.14840, 102.73108],  // 4  09:20 Inside
  [2.14835, 102.73095],  // 5  09:25 Inside
  [2.14840, 102.73080],  // 6  09:30 Inside
  [2.14848, 102.73068],  // 7  09:35 Inside
  [2.14855, 102.73055],  // 8  09:40 Inside
  [2.14848, 102.73042],  // 9  09:45 Inside
  [2.14844, 102.73032],  // 10 09:50 Inside
  [2.14843, 102.73018],  // 11 09:55 Inside
  [2.14843, 102.73005],  // 12 10:00 Inside
  [2.14842, 102.72998],  // 13 10:05 Inside
  [2.14841, 102.72975],  // 14 10:10 OUTSIDE
  [2.14840, 102.72950],  // 15 10:15 OUTSIDE
  [2.14841, 102.72963],  // 16 10:20 OUTSIDE
  [2.14842, 102.73005],  // 17 10:25 Inside
  [2.14840, 102.73020],  // 18 10:30 Inside
  [2.14825, 102.73042],  // 19 10:35 Inside
  [2.14812, 102.73060],  // 20 10:40 Inside
  [2.14800, 102.73082],  // 21 10:45 Inside
  [2.14802, 102.73100],  // 22 10:50 Inside
  [2.14810, 102.73115],  // 23 10:55 Inside
  [2.14822, 102.73108],  // 24 11:00 Inside
  [2.14835, 102.73095],  // 25 11:05 Inside
  [2.14847, 102.73082],  // 26 11:10 Inside
  [2.14860, 102.73072],  // 27 11:15 Inside
  [2.14875, 102.73066],  // 28 11:20 Inside
  [2.14895, 102.73062],  // 29 11:25 Inside
  [2.14920, 102.73060],  // 30 11:30 OUTSIDE
  [2.14932, 102.73068],  // 31 11:35 OUTSIDE
  [2.14922, 102.73065],  // 32 11:40 OUTSIDE
  [2.14880, 102.73075],  // 33 11:45 Inside
  [2.14870, 102.73078],  // 34 11:50 Inside
  [2.14862, 102.73082],  // 35 11:55 Inside
  [2.14852, 102.73085],  // 36 12:00 Inside
];

// --- Original RSSI profile (37 values, one per original waypoint) ---
const ORIG_RSSI = [
  -58, -60, -61, -63, -62, -64, -65, -63, -61, -62, -64, -66,  // 0-11  inside
  -68, -70, -74, -78, -76, -71,                                  // 12-17 west excursion
  -69, -67, -65, -63, -62, -60, -61, -63, -64, -62, -61, -63,  // 18-29 inside
  -75, -80, -77,                                                  // 30-32 north excursion
  -68, -65, -63, -61,                                            // 33-36 inside
];

// --- Interpolate: 20 sub-steps per segment = 15s x 20 = 5 min per segment ---
const STEPS = 20;
const lats = [], lngs = [], rssiPts = [];

for (let i = 0; i < ORIG_WP.length - 1; i++) {
  for (let s = 0; s < STEPS; s++) {
    const t = s / STEPS;
    lats.push(ORIG_WP[i][0] + (ORIG_WP[i + 1][0] - ORIG_WP[i][0]) * t);
    lngs.push(ORIG_WP[i][1] + (ORIG_WP[i + 1][1] - ORIG_WP[i][1]) * t);
    rssiPts.push(Math.round(ORIG_RSSI[i] + (ORIG_RSSI[i + 1] - ORIG_RSSI[i]) * t));
  }
}
lats.push(ORIG_WP[ORIG_WP.length - 1][0]);
lngs.push(ORIG_WP[ORIG_WP.length - 1][1]);
rssiPts.push(ORIG_RSSI[ORIG_RSSI.length - 1]);

const TOTAL_PTS = lats.length;  // 721

// --- ANSI colours ---
const C = { green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', white: '\x1b[37m', red: '\x1b[31m', reset: '\x1b[0m' };

// --- State ---
let ptIdx     = 0;
let cycle     = 1;
let totalSent = 0;
let totalFail = 0;
let battBase  = 3900;  // mV; drains 1 mV per 10 sends (~2.5 min)

// --- Connect to MQTT ---
const client = mqtt.connect(BROKER);

client.on('connect', () => {
  const cycleMin = Math.round(TOTAL_PTS * INTERVAL / 1000 / 60);
  console.log('');
  console.log(`${C.cyan}==========================================`);
  console.log(`  Milah Real-Time Simulation -- Ladang Pagoh`);
  console.log(`==========================================`);
  console.log(`  Cow     : Milah (id=2)`);
  console.log(`  Tracker : ${TRACKER_ID}  |  MAC: ${MAC}`);
  console.log(`  Farm    : Ladang Pagoh (id=2)  |  Fence pts: ${FENCE.length}`);
  console.log(`  Interval: ${INTERVAL / 1000}s  |  Points/cycle: ${TOTAL_PTS} (~${cycleMin} min)`);
  console.log(`  Topic   : ${TOPIC}`);
  console.log(`  Press Ctrl+C to stop`);
  console.log(`==========================================${C.reset}`);
  console.log('');
  console.log(`${C.white}  Cyc   Pt     Time         Latitude        Longitude       Batt(mV)  RSSI    Zone${C.reset}`);
  console.log(`  ${'-'.repeat(82)}`);
  scheduleNext(0);
});

function scheduleNext(delay) {
  setTimeout(sendPoint, delay);
}

function sendPoint() {
  const lat   = parseFloat(lats[ptIdx].toFixed(8));
  const lng   = parseFloat(lngs[ptIdx].toFixed(8));
  const rssi  = rssiPts[ptIdx];
  const batt  = Math.max(3000, battBase - Math.floor(totalSent / 10));
  const inside = pointInPolygon(lat, lng);
  const zone   = inside ? 'Inside ' : 'OUTSIDE';
  const color  = inside ? C.green : C.yellow;

  const payload = JSON.stringify({
    mac_address: MAC,
    tracker_id:  TRACKER_ID,
    latitude:    lat,
    longitude:   lng,
    battery_mv:  batt,
    rssi:        rssi,
  });

  const now = new Date().toLocaleTimeString('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur', hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  client.publish(TOPIC, payload, { qos: 0 }, (err) => {
    if (err) {
      console.log(`${C.red}  [FAIL] c=${cycle} pt=${ptIdx + 1} ${now} : ${err.message}${C.reset}`);
      totalFail++;
    } else {
      const row = [
        String(cycle).padEnd(5),
        String(ptIdx + 1).padEnd(6),
        now.padEnd(13),
        String(lat).padEnd(16),
        String(lng).padEnd(16),
        String(batt).padEnd(10),
        String(rssi).padEnd(8),
        `[${zone}]`,
      ].join(' ');
      console.log(`${color}  ${row}${C.reset}`);
      totalSent++;
    }

    ptIdx++;
    if (ptIdx >= TOTAL_PTS) {
      ptIdx = 0;
      console.log('');
      console.log(`${C.cyan}  -- Cycle ${cycle} done. Total sent: ${totalSent} | Failed: ${totalFail} --${C.reset}`);
      console.log('');
      cycle++;
    }

    scheduleNext(INTERVAL);
  });
}

client.on('error', (err) => {
  console.error(`${C.red}[MQTT error] ${err.message}${C.reset}`);
});

process.on('SIGINT', () => {
  console.log('');
  console.log(`${C.cyan}  Stopping...  Total sent: ${totalSent}  |  Failed: ${totalFail}${C.reset}`);
  client.end(true, () => process.exit(0));
});
