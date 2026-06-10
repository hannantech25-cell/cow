import mqtt from 'mqtt';
import { EventEmitter } from 'events';
import db from '../services/db';

export const mqttEvents = new EventEmitter();
mqttEvents.setMaxListeners(200);

export const mqttStatus = { connected: false };

let mqttClient: mqtt.MqttClient | null = null;

export function publish(topic: string, payload: object): void {
  if (!mqttClient || !mqttStatus.connected) return;
  mqttClient.publish(topic, JSON.stringify(payload));
}

export function connectMqtt() {
  const protocol = process.env.MQTT_PROTOCOL ?? 'mqtt';
  const host     = process.env.MQTT_HOST     ?? '127.0.0.1';
  const port     = process.env.MQTT_PORT     ?? '1883';
  const brokerUrl = `${protocol}://${host}:${port}`;

  const options: mqtt.IClientOptions = {};
  if (process.env.MQTT_USERNAME) options.username = process.env.MQTT_USERNAME;
  if (process.env.MQTT_PASSWORD) options.password = process.env.MQTT_PASSWORD;

  mqttClient = mqtt.connect(brokerUrl, options);

  mqttClient.on('connect', () => {
    console.log(`MQTT connected to ${brokerUrl}`);
    mqttStatus.connected = true;
    mqttClient!.subscribe('cow/tracker/data');
  });

  mqttClient.on('offline',    () => { mqttStatus.connected = false; });
  mqttClient.on('disconnect', () => { mqttStatus.connected = false; });

  mqttClient.on('message', (topic, payload) => {
    try {
      if (topic !== 'cow/tracker/data') return;

      const data = JSON.parse(payload.toString()) as {
        mac_address: string;
        tracker_id:  string;
        latitude:    number;
        longitude:   number;
        battery_mv:  number;
      };

      if (!data.mac_address || !data.tracker_id) return;

      const device = db.prepare(
        'SELECT id FROM trackers WHERE UPPER(mac_address) = UPPER(?)'
      ).get(data.mac_address);

      if (!device) return;

      // Emit SSE event for real-time dashboard delivery.
      // InfluxDB writes are handled by the bridge service.
      mqttEvents.emit(`tracker:${data.mac_address}`, {
        ...data,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('MQTT message error:', err);
    }
  });

  mqttClient.on('error', (err) => {
    console.error('MQTT error:', err);
    mqttStatus.connected = false;
  });
}
