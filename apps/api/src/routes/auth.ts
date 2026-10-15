import { eq } from 'drizzle-orm';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authUser, loadAuthUser, requireAuth, signToken, verifyPassword } from '../auth.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { AppError, parse } from '../lib/errors.js';

export const authRouter = Router();

const loginLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });

authRouter.post('/login', loginLimiter, async (req, res) => {
  const body = parse(z.object({ email: z.string().trim().toLowerCase(), password: z.string().min(1) }), req.body);
  const [u] = await db.select().from(users).where(eq(users.email, body.email));
  if (!u || !u.active || !(await verifyPassword(body.password, u.passwordHash))) {
    throw new AppError(401, 'BAD_CREDENTIALS', 'Email or password is incorrect');
  }
  res.json({ token: signToken(u.id), user: await loadAuthUser(u.id) });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: authUser(req) });
});
