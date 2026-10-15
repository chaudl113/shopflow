import { and, eq, sql } from 'drizzle-orm';
import type { DbOrTx, Tx } from '../db/client.js';
import { db } from '../db/client.js';
import { cashMovements, shifts, users } from '../db/schema.js';
import { conflict, notFound } from '../lib/errors.js';

export type Shift = typeof shifts.$inferSelect;

export async function openShift(userId: string, storeId: string, openingFloatCents: number, at?: Date): Promise<Shift> {
  try {
    const [row] = await db.insert(shifts).values({ userId, storeId, openingFloatCents, ...(at ? { openedAt: at } : {}) }).returning();
    return row!;
  } catch (e) {
    const cause = (e as { cause?: { constraint?: string } }).cause ?? (e as { constraint?: string });
    if (cause?.constraint === 'shifts_one_open_per_user') throw conflict('SHIFT_ALREADY_OPEN', 'You already have an open shift. Close it first.');
    throw e;
  }
}

/**
 * The actor's open shift at a store. Sales and returns take it FOR SHARE so they can run in
 * parallel with each other but never interleave with the shift being closed (FOR UPDATE).
 */
export async function requireOpenShift(tx: Tx, userId: string, storeId: string): Promise<Shift> {
  const res = await tx.execute(sql`select id from shifts where user_id = ${userId} and status = 'open' for share`);
  const id = (res.rows[0] as { id: string } | undefined)?.id;
  const [shift] = id ? await tx.select().from(shifts).where(eq(shifts.id, id)) : [];
  if (!shift) throw conflict('NO_OPEN_SHIFT', 'Open a shift before selling or refunding.');
  if (shift.storeId !== storeId) throw conflict('SHIFT_OTHER_STORE', 'Your open shift is at a different store.');
  return shift;
}

export async function findOpenShift(userId: string, storeId: string) {
  const [s] = await db.select().from(shifts).where(and(eq(shifts.userId, userId), eq(shifts.storeId, storeId), eq(shifts.status, 'open')));
  return s ?? null;
}

export interface ShiftSummary {
  shift: Shift & { userName: string };
  salesCount: number;
  returnsCount: number;
  salesTotalCents: number;
  refundsTotalCents: number;
  byMethod: Record<'cash' | 'card' | 'other', { inCents: number; outCents: number }>;
  payInCents: number;
  payOutCents: number;
  /** Opening float + cash taken - cash refunded + pay-ins - pay-outs. */
  expectedCashCents: number;
  cashMovements: (typeof cashMovements.$inferSelect)[];
}

export async function shiftSummary(conn: DbOrTx, shiftId: string): Promise<ShiftSummary> {
  const [row] = await conn.select({ shift: shifts, userName: users.name }).from(shifts).innerJoin(users, eq(users.id, shifts.userId)).where(eq(shifts.id, shiftId));
  if (!row) throw notFound('Shift');
  const { shift } = row;

  const pay = await conn.execute(sql`
    select method,
           coalesce(sum(amount_cents) filter (where amount_cents > 0), 0)::int as "in",
           coalesce(-sum(amount_cents) filter (where amount_cents < 0), 0)::int as "out"
      from payments where shift_id = ${shiftId} group by method`);
  const byMethod = { cash: { inCents: 0, outCents: 0 }, card: { inCents: 0, outCents: 0 }, other: { inCents: 0, outCents: 0 } };
  for (const r of pay.rows as { method: keyof typeof byMethod; in: number; out: number }[]) byMethod[r.method] = { inCents: r.in, outCents: r.out };

  const counts = await conn.execute(sql`
    select (select count(*) from sales where shift_id = ${shiftId})::int as sales,
           (select coalesce(sum(total_cents), 0) from sales where shift_id = ${shiftId})::int as "salesTotal",
           (select count(*) from sale_returns where shift_id = ${shiftId})::int as returns,
           (select coalesce(sum(total_cents), 0) from sale_returns where shift_id = ${shiftId})::int as "refundsTotal"`);
  const c = counts.rows[0] as { sales: number; salesTotal: number; returns: number; refundsTotal: number };

  const moves = await conn.select().from(cashMovements).where(eq(cashMovements.shiftId, shiftId)).orderBy(cashMovements.createdAt);
  const payInCents = moves.filter((m) => m.kind === 'pay_in').reduce((s, m) => s + m.amountCents, 0);
  const payOutCents = moves.filter((m) => m.kind === 'pay_out').reduce((s, m) => s + m.amountCents, 0);
  const expectedCashCents = shift.openingFloatCents + byMethod.cash.inCents - byMethod.cash.outCents + payInCents - payOutCents;

  return {
    shift: { ...shift, userName: row.userName },
    salesCount: c.sales,
    returnsCount: c.returns,
    salesTotalCents: c.salesTotal,
    refundsTotalCents: c.refundsTotal,
    byMethod,
    payInCents,
    payOutCents,
    expectedCashCents,
    cashMovements: moves,
  };
}

/** Locks the shift row so no sale/refund can land between computing "expected" and closing. */
export async function lockOpenShift(tx: Tx, shiftId: string): Promise<Shift> {
  await tx.execute(sql`select id from shifts where id = ${shiftId} for update`);
  const [s] = await tx.select().from(shifts).where(eq(shifts.id, shiftId));
  if (!s) throw notFound('Shift');
  if (s.status !== 'open') throw conflict('SHIFT_CLOSED', 'This shift is already closed.');
  return s;
}

export async function closeShift(shiftId: string, closedBy: string, countedCashCents: number, note: string, at?: Date) {
  return db.transaction(async (tx) => {
    await lockOpenShift(tx, shiftId);
    const summary = await shiftSummary(tx, shiftId);
    const differenceCents = countedCashCents - summary.expectedCashCents;
    await tx
      .update(shifts)
      .set({ status: 'closed', closedAt: at ?? new Date(), closedBy, expectedCashCents: summary.expectedCashCents, countedCashCents, differenceCents, closingNote: note })
      .where(eq(shifts.id, shiftId));
    return { expectedCashCents: summary.expectedCashCents, countedCashCents, differenceCents };
  });
}
