import { asc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { authUser, hashPassword, requireRole } from '../auth.js';
import { db } from '../db/client.js';
import { userStores, users } from '../db/schema.js';
import { config } from '../config.js';
import { isDemoAccount } from '../demo/accounts.js';
import { AppError, notFound, parse } from '../lib/errors.js';
import { uuid } from '../lib/zod.js';

export const usersRouter = Router();

/** Team list. Everyone can see colleagues at their stores (needed for staff pickers). */
usersRouter.get('/', async (req, res) => {
  const me = authUser(req);
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, bookable: users.bookable, color: users.color, active: users.active })
    .from(users)
    .orderBy(asc(users.name));
  const links = await db.select().from(userStores);
  const withStores = rows.map((u) => ({ ...u, storeIds: links.filter((l) => l.userId === u.id).map((l) => l.storeId) }));
  const visible = me.role === 'owner' ? withStores : withStores.filter((u) => u.role !== 'owner' && u.storeIds.some((s) => me.storeIds.includes(s)));
  res.json({ users: visible });
});

const userBody = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  name: z.string().trim().min(1).max(80),
  role: z.enum(['owner', 'manager', 'cashier', 'staff']),
  bookable: z.boolean().default(false),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).default('#6366f1'),
  active: z.boolean().default(true),
  storeIds: z.array(uuid).default([]),
  password: z.string().min(8).max(100).optional(),
});

usersRouter.post('/', requireRole('owner'), async (req, res) => {
  const body = parse(userBody.required({ password: true }), req.body);
  const id = await db.transaction(async (tx) => {
    const { storeIds, password, ...rest } = body;
    const [u] = await tx.insert(users).values({ ...rest, passwordHash: await hashPassword(password) }).returning({ id: users.id });
    if (storeIds.length) await tx.insert(userStores).values(storeIds.map((storeId) => ({ userId: u!.id, storeId })));
    return u!.id;
  });
  res.status(201).json({ id });
});

usersRouter.patch('/:id', requireRole('owner'), async (req, res) => {
  const id = parse(uuid, req.params.id);
  const body = parse(userBody.partial(), req.body);
  if (config.demoPublic) {
    // Visitors share the demo accounts: nobody may change their password, email, role or access, or disable them.
    const [target] = await db.select({ email: users.email }).from(users).where(eq(users.id, id));
    if (target && isDemoAccount(target.email)) throw new AppError(403, 'DEMO_LOCKED', 'Demo accounts are shared and cannot be changed.');
  }
  await db.transaction(async (tx) => {
    const { storeIds, password, ...rest } = body;
    const set = { ...rest, ...(password ? { passwordHash: await hashPassword(password) } : {}) };
    if (Object.keys(set).length) {
      const [u] = await tx.update(users).set(set).where(eq(users.id, id)).returning({ id: users.id });
      if (!u) throw notFound('User');
    }
    if (storeIds) {
      await tx.delete(userStores).where(eq(userStores.userId, id));
      if (storeIds.length) await tx.insert(userStores).values(storeIds.map((storeId) => ({ userId: id, storeId })));
    }
  });
  res.json({ ok: true });
});
