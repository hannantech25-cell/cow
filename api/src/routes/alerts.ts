import { Router, Response } from 'express';
import db from '../services/db';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();
router.use(authenticate);

router.get('/', (req: AuthRequest, res: Response) => {
  try {
    const { unread } = req.query;
    const where = unread === 'true' ? 'WHERE a.is_read = 0' : '';
    const rows = db.prepare(`
      SELECT a.*, c.tag_number AS cow_tag, c.name AS cow_name, g.name AS geofence_name
      FROM alerts a
      LEFT JOIN cows c ON c.id = a.cow_id
      LEFT JOIN geofences g ON g.id = a.geofence_id
      ${where}
      ORDER BY a.timestamp DESC
      LIMIT 100
    `).all();
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/read-all', (_req: AuthRequest, res: Response) => {
  try {
    db.prepare('UPDATE alerts SET is_read=1').run();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/read', (req: AuthRequest, res: Response) => {
  try {
    db.prepare('UPDATE alerts SET is_read=1 WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
