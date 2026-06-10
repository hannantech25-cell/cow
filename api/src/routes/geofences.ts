import { Router, Response } from 'express';
import db from '../services/db';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();
router.use(authenticate);

router.get('/', (_req: AuthRequest, res: Response) => {
  try {
    res.json(db.prepare('SELECT * FROM geofences ORDER BY created_at DESC').all());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', (req: AuthRequest, res: Response) => {
  try {
    const { name, type, boundary_data } = req.body;
    const result = db.prepare(
      'INSERT INTO geofences (name, type, boundary_data) VALUES (?, ?, ?)'
    ).run(name, type, JSON.stringify(boundary_data));
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', (req: AuthRequest, res: Response) => {
  try {
    const { name, type, boundary_data } = req.body;
    db.prepare(
      `UPDATE geofences SET name=?, type=?, boundary_data=?, updated_at=datetime('now') WHERE id=?`
    ).run(name, type, JSON.stringify(boundary_data), req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', (req: AuthRequest, res: Response) => {
  try {
    db.prepare('DELETE FROM geofences WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
