import 'dotenv/config';
import mqtt from 'mqtt';
import { writeInfluxLP } from './influxdb';
import { isDeviceRegistered, getSleepTimeSec } from './db';

// ── Types ────────────────────────────────────────────────────────────────────

interface TrackerPayload {
  mac_address: string;
  tracker_id:  string;
  latitude:    number;
  longitude:   number;
  battery_mv:  number;
  rssi?:       number;  // ESP-NOW signal strength (dBm), injected by gateway
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleTrackerData(payload: Buffer): Promise<void> {
  let data: TrackerPayload;
  try {
    data = JSON.parse(payload.toString()) as TrackerPayload;
  } catch {
    console.warn('[Bridge] cow/tracker/data — invalid JSON, discarding');
    return;
  }

  if (!data.mac_address || !data.tracker_id) {
    console.warn('[Bridge] cow/tracker/data — missing mac_address or tracker_id, discarding');
    return;
  }

  if (!isDeviceRegistered(data.mac_address)) {
    console.warn(`[Bridge] cow/tracker/data — unregistered tracker ${data.mac_address}, discarding`);
    return;
  }

  // Escape tag/field values for InfluxDB line protocol
  const safeMac = data.mac_address.replace(/,| |=/g, '_');
  const safeTid = data.tracker_id.replace(/,| |=/g, '_');
  const line = `tracker,tracker_id=${safeTid},mac_address=${safeMac}` +
    ` latitude=${data.latitude ?? 0},longitude=${data.longitude ?? 0}` +
    `,battery_mv=${data.battery_mv ?? 0}i,rssi=${data.rssi ?? 0}i`;

  try {
    await writeInfluxLP(line);
    console.log(`[Bridge] cow/tracker/data → InfluxDB | tracker=${data.tracker_id} mac=${data.mac_address}`);
    const sleepTimeSec = getSleepTimeSec(data.mac_address);
    client.publish('cow/tracker/ack', JSON.stringify({
      mac_address:    data.mac_address,
      tracker_id:     data.tracker_id,
      sleep_time_sec: sleepTimeSec,
    }));
    console.log(`[Bridge] cow/tracker/ack published | mac=${data.mac_address} sleep=${sleepTimeSec}s`);
  } catch (err) {
    console.error('[Bridge] InfluxDB write error:', err);
  }
}

// ── MQTT connection ───────────────────────────────────────────────────────────

const protocol  = process.env.MQTT_PROTOCOL ?? 'mqtt';
const mqttHost  = process.env.MQTT_HOST     ?? 'localhost';
const mqttPort  = process.env.MQTT_PORT     ?? '1883';
const brokerUrl = `${protocol}://${mqttHost}:${mqttPort}`;

const mqttOptions: mqtt.IClientOptions = {};
if (process.env.MQTT_USERNAME) mqttOptions.username = process.env.MQTT_USERNAME;
if (process.env.MQTT_PASSWORD) mqttOptions.password = process.env.MQTT_PASSWORD;

const client = mqtt.connect(brokerUrl, mqttOptions);

const TOPICS = [
  'cow/tracker/data',      // GPS + battery → InfluxDB → then publish cow/tracker/ack
] as const;

client.on('connect', () => {
  console.log(`[Bridge] Connected to MQTT broker at ${brokerUrl}`);

  client.subscribe([...TOPICS], (err) => {
    if (err) {
      console.error('[Bridge] Subscribe error:', err);
    } else {
      console.log('[Bridge] Subscribed:');
      console.log('  cow/tracker/data    → InfluxDB → cow/tracker/ack');
    }
  });
});

client.on('message', (topic, payload) => {
  if (topic === 'cow/tracker/data') {
    handleTrackerData(payload).catch((err) =>
      console.error('[Bridge] Handler error (tracker/data):', err)
    );
  }
});

client.on('error',     (err) => console.error('[Bridge] MQTT error:', err));
client.on('reconnect', ()    => console.log('[Bridge] Reconnecting to MQTT broker...'));
client.on('offline',   ()    => console.warn('[Bridge] MQTT broker offline'));

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function shutdown(): void {
  console.log('[Bridge] Shutting down...');
  client.end();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

console.log('[Bridge] Starting cow data bridge...');
