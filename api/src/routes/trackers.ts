import { Router, Request, Response } from 'express';
import db from '../services/db';
import { publish } from '../mqtt/client';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();
const toIso = (d: string) => d ? d.replace(' ', 'T') + 'Z' : d;

// ── Open routes (edge node — no JWT) ──────────────────────────────────────────

// POST /register — called by edge node for first-time registration
router.post('/register', (req: Request, res: Response) => {
  try {
    const { mac_address, tracker_id, location } = req.body as {
      mac_address: string;
      tracker_id:  string;
      location:    string;
    };

    if (!mac_address || !tracker_id || !location) {
      res.status(400).json({ error: 'mac_address, tracker_id and location are required.' });
      return;
    }

    const gw = db.prepare('SELECT latitude, longitude FROM gateway_location WHERE id = 1').get() as any;

    db.prepare(`
      INSERT INTO trackers (mac_address, tracker_id, board_id, location, initial_latitude, initial_longitude)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      mac_address.toUpperCase(),
      tracker_id,
      tracker_id,
      location,
      gw?.latitude  ?? null,
      gw?.longitude ?? null,
    );

    const device = db.prepare('SELECT * FROM trackers WHERE mac_address = ?').get(mac_address.toUpperCase()) as any;

    publish('cow/tracker/register', {
      mac_address:       device.mac_address,
      tracker_id:        device.tracker_id,
      location:          device.location,
      initial_latitude:  device.initial_latitude,
      initial_longitude: device.initial_longitude,
      registered_at:     toIso(device.registered_at),
    });

    res.status(201).json({
      status:            'success',
      tracker_id:        device.tracker_id,
      location:          device.location,
      mac_address:       device.mac_address,
      initial_latitude:  device.initial_latitude,
      initial_longitude: device.initial_longitude,
      registered_at:     toIso(device.registered_at),
    });
  } catch (err: any) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'Tracker with this MAC address is already registered.' });
    } else {
      console.error('[POST /trackers/register]', err.message);
      res.status(500).json({ error: err.message });
    }
  }
});

// PATCH /:mac_address — called by edge node for info update (no JWT)
router.patch('/:mac_address', (req: Request, res: Response) => {
  try {
    const mac = req.params.mac_address.toUpperCase();
    const { tracker_id, location } = req.body as { tracker_id?: string; location?: string };

    if (!tracker_id && !location) {
      res.status(400).json({ error: 'At least tracker_id or location is required.' });
      return;
    }

    const existing = db.prepare('SELECT * FROM trackers WHERE mac_address = ?').get(mac) as any;
    if (!existing) { res.status(404).json({ error: 'Tracker not found.' }); return; }

    db.prepare(`
      UPDATE trackers
      SET tracker_id = COALESCE(?, tracker_id),
          location   = COALESCE(?, location),
          updated_at = datetime('now')
      WHERE mac_address = ?
    `).run(tracker_id ?? null, location ?? null, mac);

    const updated = db.prepare('SELECT * FROM trackers WHERE mac_address = ?').get(mac) as any;

    publish('cow/tracker/update', {
      mac_address: updated.mac_address,
      tracker_id:  updated.tracker_id,
      location:    updated.location,
      updated_at:  toIso(updated.updated_at),
    });

    res.json({
      status:      'success',
      tracker_id:  updated.tracker_id,
      location:    updated.location,
      mac_address: updated.mac_address,
      updated_at:  toIso(updated.updated_at),
    });
  } catch (err: any) {
    console.error('[PATCH /trackers/:mac_address]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Authenticated routes (dashboard — JWT required) ────────────────────────────
router.use(authenticate);

router.get('/', (_req: AuthRequest, res: Response) => {
  try {
    const rows = db.prepare(`
      SELECT d.*, d.registered_at AS created_at, c.tag_number AS cow_tag, c.name AS cow_name
      FROM trackers d
      LEFT JOIN cows c ON c.id = d.assigned_cow_id
      ORDER BY d.registered_at DESC
    `).all();
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', (req: AuthRequest, res: Response) => {
  const { board_id, mac_address, sleep_time_sec, battery_threshold } = req.body;
  if (!board_id || !mac_address) {
    res.status(400).json({ error: 'board_id and mac_address are required.' });
    return;
  }
  try {
    const result = db.prepare(
      'INSERT INTO trackers (board_id, mac_address, tracker_id, location, sleep_time_sec, battery_threshold) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(board_id, mac_address, board_id, '', sleep_time_sec ?? 15, battery_threshold ?? 20);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (err: any) {
    if ((err as any).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'Board ID or MAC address already exists.' });
    } else { throw err; }
  }
});

router.patch('/:id/assign', (req: AuthRequest, res: Response) => {
  try {
    const { cow_id } = req.body;
    const newStatus = cow_id ? 'Active' : 'Inactive';
    db.prepare(
      'UPDATE trackers SET assigned_cow_id=?, status=?, updated_at=datetime(\'now\') WHERE id=?'
    ).run(cow_id ?? null, newStatus, req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', (req: AuthRequest, res: Response) => {
  const { board_id, mac_address, sleep_time_sec, battery_threshold } = req.body;
  try {
    db.prepare(
      'UPDATE trackers SET board_id=?, mac_address=?, sleep_time_sec=?, battery_threshold=?, updated_at=datetime(\'now\') WHERE id=?'
    ).run(board_id, mac_address, sleep_time_sec, battery_threshold, req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    if ((err as any).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'Board ID or MAC address already exists.' });
    } else { throw err; }
  }
});

router.patch('/:id/status', (req: AuthRequest, res: Response) => {
  try {
    const tracker = db.prepare('SELECT status FROM trackers WHERE id = ?').get(req.params.id) as any;
    if (!tracker) { res.status(404).json({ error: 'Tracker not found.' }); return; }
    if (tracker.status === 'Maintenance') {
      res.status(400).json({ error: 'Cannot toggle a tracker in Maintenance status.' });
      return;
    }
    const next = tracker.status === 'Active' ? 'Inactive' : 'Active';
    db.prepare('UPDATE trackers SET status=?, updated_at=datetime(\'now\') WHERE id=?').run(next, req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', (req: AuthRequest, res: Response) => {
  try {
    const tracker = db.prepare('SELECT id FROM trackers WHERE id = ?').get(req.params.id);
    if (!tracker) { res.status(404).json({ error: 'Tracker not found.' }); return; }
    db.prepare('DELETE FROM trackers WHERE id = ?').run(req.params.id);
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
