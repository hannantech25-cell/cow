import { Router, Request, Response } from 'express';
import db from '../services/db';

const router = Router();

// POST /gateway/location — called by gateway node on first boot (no JWT)
router.post('/location', (req: Request, res: Response) => {
  try {
    const { latitude, longitude } = req.body as { latitude: number; longitude: number };

    if (latitude === undefined || longitude === undefined) {
      res.status(400).json({ error: 'latitude and longitude are required.' });
      return;
    }

    db.prepare(`
      INSERT INTO gateway_location (id, latitude, longitude, stored_at)
      VALUES (1, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        latitude  = excluded.latitude,
        longitude = excluded.longitude,
        stored_at = excluded.stored_at
    `).run(latitude, longitude);

    res.json({ status: 'success' });
  } catch (err: any) {
    console.error('[POST /gateway/location]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /gateway/location — read the stored gateway coordinates
router.get('/location', (_req: Request, res: Response) => {
  try {
    const row = db.prepare('SELECT latitude, longitude, stored_at FROM gateway_location WHERE id = 1').get();
    if (!row) { res.status(404).json({ error: 'Gateway location not set.' }); return; }
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
