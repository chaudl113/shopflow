import { and, desc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { assertStoreAccess, authUser, requireRole } from '../auth.js';
import { db } from '../db/client.js';
import { cashMovements, shifts, users } from '../db/schema.js';
import { forbidden, notFound, parse } from '../lib/errors.js';
import { cents, uuid } from '../lib/zod.js';
import { closeShift, findOpenShift, lockOpenShift, openShift, shiftSummary } from '../pos/shifts.js';

export const shiftsRouter = Router();
const sellers = requireRole('owner', 'manager', 'cashier');

shiftsRouter.post('/open', sellers, async (req, res) => {
  const user = authUser(req);
  const body = parse(z.object({ storeId: uuid, openingFloatCents: cents }), req.body);
  assertStoreAccess(user, body.storeId);
  const shift = await openShift(user.id, body.storeId, body.openingFloatCents);
  res.status(201).json({ summary: await shiftSummary(db, shift.id) });
});

/** The caller's open shift at the store, with live totals (null when none). */
shiftsRouter.get('/current', sellers, async (req, res) => {
  const user = authUser(req);
  const q = parse(z.object({ storeId: uuid }), req.query);
  assertStoreAccess(user, q.storeId);
  const shift = await findOpenShift(user.id, q.storeId);
  res.json({ summary: shift ? await shiftSummary(db, shift.id) : null });
});

shiftsRouter.get('/', sellers, async (req, res) => {
  const user = authUser(req);
  const q = parse(z.object({ storeId: uuid }), req.query);
  assertStoreAccess(user, q.storeId);
  const where = [eq(shifts.storeId, q.storeId)];
  if (user.role === 'cashier') where.push(eq(shifts.userId, user.id));
  const rows = await db
    .select({ shift: shifts, userName: users.name })
    .from(shifts)
    .innerJoin(users, eq(users.id, shifts.userId))
    .where(and(...where))
    .orderBy(desc(shifts.openedAt))
    .limit(50);
  res.json({ shifts: rows.map((r) => ({ ...r.shift, userName: r.userName })) });
});

async function loadShiftFor(user: ReturnType<typeof authUser>, id: string) {
  const [shift] = await db.select().from(shifts).where(eq(shifts.id, id));
  if (!shift) throw notFound('Shift');
  assertStoreAccess(user, shift.storeId);
  // Cashiers manage only their own drawer; managers/owners can close anyone's (end of day).
  if (user.role === 'cashier' && shift.userId !== user.id) throw forbidden('This is not your shift');
  return shift;
}

shiftsRouter.get('/:id', sellers, async (req, res) => {
  const id = parse(uuid, req.params.id);
  await loadShiftFor(authUser(req), id);
  res.json({ summary: await shiftSummary(db, id) });
});

shiftsRouter.post('/:id/cash', sellers, async (req, res) => {
  const user = authUser(req);
  const id = parse(uuid, req.params.id);
  const body = parse(z.object({ kind: z.enum(['pay_in', 'pay_out']), amountCents: cents.min(1), reason: z.string().trim().min(2).max(120) }), req.body);
  await loadShiftFor(user, id);
  await db.transaction(async (tx) => {
    await lockOpenShift(tx, id);
    await tx.insert(cashMovements).values({ shiftId: id, userId: user.id, ...body });
  });
  res.status(201).json({ summary: await shiftSummary(db, id) });
});

shiftsRouter.post('/:id/close', sellers, async (req, res) => {
  const user = authUser(req);
  const id = parse(uuid, req.params.id);
  const body = parse(z.object({ countedCashCents: cents, note: z.string().trim().max(300).default('') }), req.body);
  await loadShiftFor(user, id);
  await closeShift(id, user.id, body.countedCashCents, body.note);
  res.json({ summary: await shiftSummary(db, id) });
});
