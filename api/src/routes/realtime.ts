import { Router, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { mqttStatus, mqttEvents } from '../mqtt/client';
import { AuthRequest } from '../types';
import db from '../services/db';
import influxdb, { queryInfluxQL } from '../services/influxdb';

const router = Router();
router.use(authenticate);

router.get('/status', async (_req: AuthRequest, res: Response) => {
  let influxConnected = false;
  try {
    const influxHost  = process.env.INFLUX_HOST  ?? 'localhost';
    const influxPort  = process.env.INFLUX_PORT   ?? '8086';
    const influxToken = process.env.INFLUX_TOKEN  ?? '';
    const controller  = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const r = await fetch(`http://${influxHost}:${influxPort}/health`, {
      headers: { Authorization: `Bearer ${influxToken}` },
      signal: controller.signal,
    });
    clearTimeout(timer);
    influxConnected = r.ok;
  } catch {}

  res.json({ mqtt: mqttStatus.connected, influx: influxConnected });
});

router.get('/locations', async (_req: AuthRequest, res: Response) => {
  try {
    const trackers = db.prepare(`
      SELECT t.*, c.id AS cow_id, c.name AS cow_name, c.farm_id,
             f.name AS farm_name
      FROM trackers t
      LEFT JOIN cows c ON c.id = t.assigned_cow_id
      LEFT JOIN farms f ON f.id = c.farm_id
    `).all() as any[];
    if (!trackers.length) { res.json([]); return; }

    const macList = trackers
      .map(d => `'${String(d.mac_address).replace(/'/g, '')}'`)
      .join(', ');

    // LAST() per mac_address tag — one row per tracker, no gRPC needed
    const influxQL = `
      SELECT LAST(latitude) AS latitude, LAST(longitude) AS longitude, LAST(battery_mv) AS battery_mv
      FROM tracker
      WHERE time >= now() - 24h
        AND "mac_address" =~ /^(${macList.replace(/'/g, '').replace(/, /g, '|')})$/
      GROUP BY "mac_address"
    `;

    const latestByMac: Record<string, any> = {};
    try {
      const rows = await queryInfluxQL(influxQL);
      for (const row of rows) {
        const mac = String(row['mac_address']);
        latestByMac[mac] = row;
      }
    } catch (err) {
      console.error('[realtime/locations] InfluxDB error:', err);
    }

    res.json(trackers.map(d => ({
      mac_address:  d.mac_address,
      tracker_id:   d.tracker_id,
      board_id:     d.board_id,
      location:     d.location,
      status:       d.status,
      battery_threshold: d.battery_threshold,
      cow_id:       d.cow_id        ?? null,
      cow_name:     d.cow_name      ?? null,
      farm_id:      d.farm_id       ?? null,
      farm_name:    d.farm_name     ?? null,
      latitude:     latestByMac[d.mac_address]?.latitude   ?? null,
      longitude:    latestByMac[d.mac_address]?.longitude  ?? null,
      battery_mv:   latestByMac[d.mac_address]?.battery_mv ?? null,
      last_seen:    latestByMac[d.mac_address]?.time       ?? null,
    })));
  } catch (err: any) {
    console.error('[GET /realtime/locations]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/history', async (req: AuthRequest, res: Response) => {
  try {
    let { mac_address, board_id, date, date_to } = req.query as {
      mac_address?: string; board_id?: string; date?: string; date_to?: string;
    };

    // Accept board_id as alternative — resolve to mac_address from trackers table
    if (!mac_address && board_id) {
      const tracker = db.prepare('SELECT mac_address FROM trackers WHERE board_id = ?').get(board_id) as any;
      if (tracker) mac_address = tracker.mac_address;
    }

    if (!mac_address || !date) {
      res.status(400).json({ error: 'mac_address and date are required.' });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'date must be YYYY-MM-DD.' });
      return;
    }

    // End date — exclusive upper bound, so always add 1 day to make date_to inclusive
    const baseEnd = (date_to && /^\d{4}-\d{2}-\d{2}$/.test(date_to)) ? date_to : date;
    const nextDay = new Date(baseEnd);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const endDate = nextDay.toISOString().split('T')[0];

    const safeMac = String(mac_address).replace(/'/g, '');
    const influxQL = `
      SELECT latitude, longitude, battery_mv, rssi
      FROM tracker
      WHERE "mac_address" = '${safeMac}'
        AND time >= '${date}T00:00:00Z'
        AND time <  '${endDate}T00:00:00Z'
      ORDER BY time ASC
    `;

    const points: any[] = [];
    try {
      const rows = await queryInfluxQL(influxQL);
      for (const row of rows) {
        points.push({
          latitude:   Number(row['latitude']),
          longitude:  Number(row['longitude']),
          battery_mv: Number(row['battery_mv']),
          rssi:       row['rssi'] != null ? Number(row['rssi']) : null,
          time:       String(row['time']),
        });
      }
    } catch (err) {
      console.error('[realtime/history] InfluxDB error:', err);
    }

    res.json(points);
  } catch (err: any) {
    console.error('[GET /realtime/history]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/stream/:macAddress', (req: AuthRequest, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const { macAddress } = req.params;

  const handler = (data: unknown) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  mqttEvents.on(`tracker:${macAddress}`, handler);

  res.on('close', () => {
    mqttEvents.off(`tracker:${macAddress}`, handler);
  });
});

export default router;
