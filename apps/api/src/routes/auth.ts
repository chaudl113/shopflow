import { eq } from 'drizzle-orm';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authUser, loadAuthUser, requireAuth, signToken, verifyPassword } from '../auth.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { config } from '../config.js';
import { DEMO_LOGINS, type DemoRole } from '../demo/accounts.js';
import { AppError, notFound, parse } from '../lib/errors.js';

export const authRouter = Router();

// Per client IP (see TRUST_PROXY). Tighter in the public demo, where anyone can reach the form.
const loginLimiter = rateLimit({ windowMs: 60_000, limit: config.demoPublic ? 10 : 30, standardHeaders: true, legacyHeaders: false });
const demoLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });

authRouter.post('/login', loginLimiter, async (req, res) => {
  const body = parse(z.object({ email: z.string().trim().toLowerCase(), password: z.string().min(1) }), req.body);
  const [u] = await db.select().from(users).where(eq(users.email, body.email));
  if (!u || !u.active || !(await verifyPassword(body.password, u.passwordHash))) {
    throw new AppError(401, 'BAD_CREDENTIALS', 'Email or password is incorrect');
  }
  res.json({ token: signToken(u.id), user: await loadAuthUser(u.id) });
});

/** Public demo only: one-click sign-in as a seeded account, no password typing. */
authRouter.post('/demo', demoLimiter, async (req, res) => {
  if (!config.demoPublic) throw notFound('Demo sign-in');
  const body = parse(z.object({ as: z.enum(Object.keys(DEMO_LOGINS) as [DemoRole, ...DemoRole[]]) }), req.body);
  const [u] = await db.select().from(users).where(eq(users.email, DEMO_LOGINS[body.as]));
  if (!u || !u.active) throw new AppError(503, 'DEMO_UNAVAILABLE', 'The demo is being reset. Try again in a minute.');
  res.json({ token: signToken(u.id), user: await loadAuthUser(u.id) });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: authUser(req) });
});
