import { Router, Response } from 'express';
import db from '../services/db';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();
router.use(authenticate);

router.get('/', (_req: AuthRequest, res: Response) => {
  try {
    const rows = db.prepare(`
      SELECT
        c.id, c.farm_id, f.name AS farm_name,
        c.tag_number, c.name, c.breed,
        c.sex AS gender, c.dob AS date_of_birth,
        c.status, c.created_at,
        t.id       AS assigned_tracker_id,
        t.board_id AS tracker_board_id
      FROM cows c
      LEFT JOIN farms f ON f.id = c.farm_id
      LEFT JOIN trackers t ON t.assigned_cow_id = c.id
      ORDER BY c.created_at DESC
    `).all();
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', (req: AuthRequest, res: Response) => {
  try {
    const cow = db.prepare(`
      SELECT
        c.id, c.farm_id, f.name AS farm_name,
        c.tag_number, c.name, c.breed,
        c.sex AS gender, c.dob AS date_of_birth,
        c.status, c.created_at,
        t.id       AS assigned_tracker_id,
        t.board_id AS tracker_board_id
      FROM cows c
      LEFT JOIN farms f ON f.id = c.farm_id
      LEFT JOIN trackers t ON t.assigned_cow_id = c.id
      WHERE c.id = ?
    `).get(req.params.id);
    if (!cow) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(cow);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', (req: AuthRequest, res: Response) => {
  try {
    const { name, breed, gender, date_of_birth, farm_id } = req.body;
    if (!name) { res.status(400).json({ error: 'Name is required.' }); return; }
    const result = db.prepare(
      `INSERT INTO cows (farm_id, name, breed, sex, dob, status) VALUES (?, ?, ?, ?, ?, 'Unpair')`
    ).run(farm_id ?? null, name, breed ?? null, gender ?? null, date_of_birth ?? null);
    res.status(201).json({ id: result.lastInsertRowid, tag_number: null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', (req: AuthRequest, res: Response) => {
  try {
    const { name, breed, gender, date_of_birth, farm_id } = req.body;
    db.prepare(
      `UPDATE cows SET farm_id=?, name=?, breed=?, sex=?, dob=?, updated_at=datetime('now') WHERE id=?`
    ).run(farm_id ?? null, name ?? null, breed ?? null, gender ?? null, date_of_birth ?? null, req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/tag', (req: AuthRequest, res: Response) => {
  try {
    const cowId = Number(req.params.id);
    const { tracker_id } = req.body;

    db.prepare(`UPDATE trackers SET assigned_cow_id=NULL, updated_at=datetime('now') WHERE assigned_cow_id=?`).run(cowId);

    if (tracker_id !== null && tracker_id !== undefined) {
      const tracker = db.prepare(`SELECT board_id FROM trackers WHERE id=? AND status='Active'`).get(tracker_id) as any;
      if (!tracker) { res.status(404).json({ error: 'Tracker not found or not active.' }); return; }
      db.prepare(`UPDATE trackers SET assigned_cow_id=?, updated_at=datetime('now') WHERE id=?`).run(cowId, tracker_id);
      db.prepare(`UPDATE cows SET tag_number=?, status='Pair', updated_at=datetime('now') WHERE id=?`).run(tracker.board_id, cowId);
    } else {
      db.prepare(`UPDATE cows SET tag_number=NULL, status='Unpair', updated_at=datetime('now') WHERE id=?`).run(cowId);
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', (req: AuthRequest, res: Response) => {
  try {
    db.prepare(`UPDATE trackers SET assigned_cow_id=NULL, updated_at=datetime('now') WHERE assigned_cow_id=?`).run(req.params.id);
    db.prepare('DELETE FROM cows WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
