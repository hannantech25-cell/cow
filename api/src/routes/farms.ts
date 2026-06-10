import { Router, Response } from 'express';
import db from '../services/db';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();
router.use(authenticate);

function recalcCenter(farmId: number | string) {
  const pts = db.prepare('SELECT latitude, longitude FROM farm_points WHERE farm_id = ?').all(farmId) as any[];
  if (!pts.length) {
    db.prepare('UPDATE farms SET center_lat=NULL, center_lng=NULL, updated_at=datetime(\'now\') WHERE id=?').run(farmId);
    return;
  }
  const centerLat = pts.reduce((s: number, p: any) => s + parseFloat(p.latitude),  0) / pts.length;
  const centerLng = pts.reduce((s: number, p: any) => s + parseFloat(p.longitude), 0) / pts.length;
  db.prepare('UPDATE farms SET center_lat=?, center_lng=?, updated_at=datetime(\'now\') WHERE id=?').run(centerLat, centerLng, farmId);
}

function resequence(farmId: number | string) {
  const rows = db.prepare('SELECT id FROM farm_points WHERE farm_id = ? ORDER BY sequence ASC').all(farmId) as any[];
  for (let i = 0; i < rows.length; i++) {
    db.prepare('UPDATE farm_points SET sequence=? WHERE id=?').run(i + 1, rows[i].id);
  }
}

router.get('/', (_req: AuthRequest, res: Response) => {
  try {
    res.json(db.prepare('SELECT * FROM farms ORDER BY created_at DESC').all());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', (req: AuthRequest, res: Response) => {
  try {
    const farm = db.prepare('SELECT * FROM farms WHERE id = ?').get(req.params.id);
    if (!farm) { res.status(404).json({ error: 'Farm not found' }); return; }
    const points = db.prepare('SELECT * FROM farm_points WHERE farm_id = ? ORDER BY sequence ASC').all(req.params.id);
    res.json({ ...(farm as any), points });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', (req: AuthRequest, res: Response) => {
  try {
    const { name, address } = req.body;
    if (!name?.trim()) { res.status(400).json({ error: 'Name is required.' }); return; }
    const result = db.prepare('INSERT INTO farms (name, address) VALUES (?, ?)').run(name.trim(), address?.trim() || null);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', (req: AuthRequest, res: Response) => {
  try {
    const { name, address, center_lat, center_lng } = req.body;
    if (!name?.trim()) { res.status(400).json({ error: 'Name is required.' }); return; }
    db.prepare(
      'UPDATE farms SET name=?, address=?, center_lat=?, center_lng=?, updated_at=datetime(\'now\') WHERE id=?'
    ).run(name.trim(), address?.trim() || null, center_lat ?? null, center_lng ?? null, req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', (req: AuthRequest, res: Response) => {
  try {
    db.prepare('DELETE FROM farms WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/points', (req: AuthRequest, res: Response) => {
  try {
    res.json(db.prepare('SELECT * FROM farm_points WHERE farm_id = ? ORDER BY sequence ASC').all(req.params.id));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/points', (req: AuthRequest, res: Response) => {
  try {
    const farmId = req.params.id;
    const { latitude, longitude } = req.body;
    const countRow = db.prepare('SELECT COUNT(*) AS cnt FROM farm_points WHERE farm_id = ?').get(farmId) as any;
    const count = countRow.cnt;
    if (count >= 20) { res.status(400).json({ error: 'Maximum 20 points allowed.' }); return; }
    const sequence = count + 1;
    const result = db.prepare(
      'INSERT INTO farm_points (farm_id, sequence, latitude, longitude) VALUES (?, ?, ?, ?)'
    ).run(farmId, sequence, latitude, longitude);
    recalcCenter(farmId);
    res.status(201).json({ id: result.lastInsertRowid, sequence });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/points/:pointId', (req: AuthRequest, res: Response) => {
  try {
    const { latitude, longitude } = req.body;
    db.prepare('UPDATE farm_points SET latitude=?, longitude=? WHERE id=? AND farm_id=?').run(latitude, longitude, req.params.pointId, req.params.id);
    recalcCenter(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/points', (req: AuthRequest, res: Response) => {
  try {
    db.prepare('DELETE FROM farm_points WHERE farm_id = ?').run(req.params.id);
    recalcCenter(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/points/:pointId', (req: AuthRequest, res: Response) => {
  try {
    db.prepare('DELETE FROM farm_points WHERE id=? AND farm_id=?').run(req.params.pointId, req.params.id);
    resequence(req.params.id);
    recalcCenter(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
