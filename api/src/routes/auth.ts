import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../services/db';
import { User, AuthRequest } from '../types';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body as { username: string; password: string };
  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' });
    return;
  }
  try {
    const user = db.prepare(
      `SELECT * FROM users WHERE (username = ? OR email = ?) AND status = 'Active'`
    ).get(username, username) as User | undefined;

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET ?? 'secret',
      { expiresIn: process.env.JWT_EXPIRES_IN ?? '7d' } as jwt.SignOptions
    );
    res.json({
      token,
      user: {
        id:       user.id,
        name:     user.name,
        username: user.username,
        email:    user.email,
        phone:    user.phone ?? null,
        avatar:   user.avatar ?? null,
        role:     user.role,
      },
    });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const user = db.prepare(
      'SELECT id, name, username, email, phone, avatar, role, status, created_at FROM users WHERE id = ?'
    ).get(req.user!.id);
    if (!user) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(user);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
