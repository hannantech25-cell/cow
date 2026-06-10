import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import db from '../services/db';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();
router.use(authenticate, requireAdmin);

router.get('/', (_req: AuthRequest, res: Response) => {
  try {
    const rows = db.prepare(
      'SELECT id, name, username, email, phone, avatar, role, status, created_at FROM users ORDER BY created_at DESC'
    ).all();
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', (req: AuthRequest, res: Response) => {
  try {
    const user = db.prepare(
      'SELECT id, name, username, email, phone, avatar, role, status, created_at FROM users WHERE id = ?'
    ).get(req.params.id);
    if (!user) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(user);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  const { name, username, email, phone, password, role, avatar } = req.body;
  if (!name || !username || !email || !password) {
    res.status(400).json({ error: 'name, username, email and password are required.' });
    return;
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = db.prepare(
      'INSERT INTO users (name, username, email, phone, password_hash, role, avatar) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(name, username, email, phone ?? null, hash, role ?? 'User', avatar ?? null);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (err: any) {
    if ((err as any).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'Username or email already exists.' });
    } else {
      throw err;
    }
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  const { name, username, email, phone, password, currentPassword, role, avatar } = req.body;
  try {
    if (password) {
      if (!currentPassword) {
        res.status(400).json({ error: 'Current password is required to change password.' });
        return;
      }
      const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.params.id) as any;
      if (!user) { res.status(404).json({ error: 'User not found.' }); return; }
      const match = await bcrypt.compare(currentPassword, user.password_hash);
      if (!match) {
        res.status(400).json({ error: 'Current password is incorrect.' });
        return;
      }
      const hash = await bcrypt.hash(password, 10);
      db.prepare(
        'UPDATE users SET name=?, username=?, email=?, phone=?, password_hash=?, role=?, avatar=?, updated_at=datetime(\'now\') WHERE id=?'
      ).run(name, username, email, phone ?? null, hash, role, avatar ?? null, req.params.id);
    } else {
      db.prepare(
        'UPDATE users SET name=?, username=?, email=?, phone=?, role=?, avatar=?, updated_at=datetime(\'now\') WHERE id=?'
      ).run(name, username, email, phone ?? null, role, avatar ?? null, req.params.id);
    }
    res.json({ success: true });
  } catch (err: any) {
    if ((err as any).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'Username or email already exists.' });
    } else {
      throw err;
    }
  }
});

router.patch('/:id/status', (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.body;
    if (status !== 'Active' && status !== 'Inactive') {
      res.status(400).json({ error: 'status must be Active or Inactive.' });
      return;
    }
    db.prepare('UPDATE users SET status=?, updated_at=datetime(\'now\') WHERE id=?').run(status, req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', (req: AuthRequest, res: Response) => {
  try {
    const targetId = Number(req.params.id);
    if (req.user?.id === targetId) {
      res.status(400).json({ error: 'You cannot delete your own account.' });
      return;
    }
    const target = db.prepare('SELECT role FROM users WHERE id = ?').get(targetId) as any;
    if (!target) { res.status(404).json({ error: 'User not found.' }); return; }

    if (target.role === 'Admin') {
      const countRow = db.prepare('SELECT COUNT(*) AS count FROM users WHERE role = \'Admin\'').get() as any;
      if (countRow.count <= 1) {
        res.status(400).json({ error: 'Cannot delete the last administrator.' });
        return;
      }
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
