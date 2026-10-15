/**
 * Live demo trading. The public demo is reset once a night, but visitors arrive at any hour and
 * expect the dashboard's "Today" to show something. Every few minutes this replays a fixed,
 * per-day plan of walk-in sales up to the current time and checks out appointments that have
 * finished, using the same POS and booking code as real users.
 *
 * Every step is idempotent: walk-ins carry a stable client_ref, so replaying a tick books nothing
 * twice. A session advisory lock keeps two ticks (or a tick and `demo:reset`) from overlapping.
 */
import { and, asc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { updateBooking } from '../booking/booking.js';
import { db, pool } from '../db/client.js';
import { bookings, sales, shifts, stores, userStores, users, variants } from '../db/schema.js';
import { closeShift, findOpenShift, openShift, shiftSummary } from '../pos/shifts.js';
import { ADD_ONS, CUSTOMERS, RETAIL_MIX, randFor, ringUp, uuidFrom, weighted, type DemoLine } from './plan.js';

const LOCK_KEY = 727_001;
const OPENING_FLOAT_CENTS = 15_000;
/** Appointments are checked out this long after they end; anything sooner is left for visitors. */
const CHECKOUT_DELAY_MIN = 10;
const NO_SHOW_RATE = 0.08;

/**
 * Runs `fn` while holding the demo lock. `wait: false` gives up immediately when someone else
 * holds it (a tick that overlaps another tick or a reset simply skips).
 */
export async function withDemoLock<T>(fn: () => Promise<T>, opts: { wait: boolean }): Promise<T | null> {
  const client = await pool.connect();
  try {
    if (opts.wait) await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    else if (!(await client.query('select pg_try_advisory_lock($1) as ok', [LOCK_KEY])).rows[0].ok) return null;
    try {
      return await fn();
    } finally {
      await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

export interface WalkIn {
  index: number;
  at: DateTime;
  skus: { sku: string; qty: number }[];
}

/**
 * The walk-in plan for one store and local day. Busy during the day; a thin trickle overnight so
 * "Today" is never empty for long after midnight, whatever the visitor's time zone (demo only).
 */
export function walkInPlan(storeCode: string, day: DateTime): WalkIn[] {
  const rand = randFor(`walkins:${storeCode}:${day.toISODate()}`);
  const plan: WalkIn[] = [];
  let minute = 3 + Math.floor(rand() * 6);
  while (minute < 24 * 60) {
    const skus: WalkIn['skus'] = [];
    const n = rand() < 0.7 ? 1 : rand() < 0.8 ? 2 : 3;
    for (let k = 0; k < n; k++) {
      const sku = weighted(rand, RETAIL_MIX);
      const same = skus.find((s) => s.sku === sku);
      if (same) same.qty++;
      else skus.push({ sku, qty: rand() < 0.15 ? 2 : 1 });
    }
    plan.push({ index: plan.length, at: day.plus({ minutes: minute }), skus });
    const hour = minute / 60;
    minute += Math.round(hour >= 9 && hour < 20 ? 70 + rand() * 80 : 150 + rand() * 90);
  }
  return plan;
}

export interface SimulationResult {
  sales: number;
  checkedOut: number;
  noShows: number;
  closedShifts: number;
}

/** Brings every store's "today" up to `now`. Safe to call as often as you like. */
export async function simulateDemoDay(now = new Date(), opts: { locked?: boolean } = {}): Promise<SimulationResult | null> {
  const run = async () => {
    const result: SimulationResult = { sales: 0, checkedOut: 0, noShows: 0, closedShifts: 0 };
    const shops = await db.select().from(stores).where(eq(stores.kind, 'store'));
    for (const store of shops) await simulateStore(store, now, result);
    return result;
  };
  return opts.locked ? run() : withDemoLock(run, { wait: false });
}

async function simulateStore(store: typeof stores.$inferSelect, now: Date, result: SimulationResult) {
  const nowLocal = DateTime.fromJSDate(now).setZone(store.timezone);
  const today = nowLocal.startOf('day');

  // The store's main till: its first cashier.
  const [till] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(userStores, eq(userStores.userId, users.id))
    .where(and(eq(userStores.storeId, store.id), eq(users.role, 'cashier'), eq(users.active, true)))
    .orderBy(asc(users.createdAt), asc(users.email))
    .limit(1);
  if (!till) return;

  // 1. Close drawers left open on earlier days, as if counted at closing time with no difference.
  const stale = await db
    .select()
    .from(shifts)
    .where(and(eq(shifts.storeId, store.id), eq(shifts.status, 'open'), lt(shifts.openedAt, today.toJSDate())));
  for (const s of stale) {
    const last = await db.execute(sql`
      select greatest(
        (select max(created_at) from payments where shift_id = ${s.id}),
        (select max(created_at) from cash_movements where shift_id = ${s.id})) as at`);
    const lastAt = (last.rows[0] as { at: Date | string | null }).at;
    const closing = DateTime.fromJSDate(s.openedAt).setZone(store.timezone).set({ hour: 19, minute: 30 });
    const afterLast = lastAt ? DateTime.fromJSDate(new Date(lastAt)).plus({ minutes: 1 }) : closing;
    const at = DateTime.min(DateTime.max(closing, afterLast), nowLocal);
    const { expectedCashCents } = await shiftSummary(db, s.id);
    await closeShift(s.id, s.userId, expectedCashCents, 'Closed automatically after hours (demo)', at.toJSDate());
    result.closedShifts++;
  }

  // 2. The till's drawer for today. If a visitor closed it, reopen from that moment on.
  let shift = await findOpenShift(till.id, store.id);
  if (!shift) {
    const [prev] = await db
      .select({ closedAt: shifts.closedAt })
      .from(shifts)
      .where(and(eq(shifts.userId, till.id), eq(shifts.storeId, store.id), gte(shifts.openedAt, today.toJSDate())))
      .orderBy(sql`${shifts.closedAt} desc nulls last`)
      .limit(1);
    const openAt = prev?.closedAt ? DateTime.fromJSDate(prev.closedAt) : today.plus({ minutes: 1 });
    try {
      shift = await openShift(till.id, store.id, OPENING_FLOAT_CENTS, DateTime.min(openAt, nowLocal).toJSDate());
    } catch {
      return; // The cashier has a drawer open at another store; leave it alone.
    }
  }
  const from = DateTime.fromJSDate(shift.openedAt);

  // 3. Walk-ins due by now that have not been rung up yet.
  const skuIds = new Map(
    (await db.select({ id: variants.id, sku: variants.sku }).from(variants).where(inArray(variants.sku, RETAIL_MIX.map(([s]) => s)))).map((v) => [v.sku, v.id]),
  );
  const due = walkInPlan(store.code, today)
    .filter((w) => w.at <= nowLocal && w.at >= from)
    .map((w) => ({ ...w, ref: uuidFrom(`walkin:${store.id}:${today.toISODate()}:${w.index}`) }));
  const done = new Set(
    due.length ? (await db.select({ ref: sales.clientRef }).from(sales).where(inArray(sales.clientRef, due.map((d) => d.ref)))).map((r) => r.ref) : [],
  );
  for (const w of due) {
    if (done.has(w.ref)) continue;
    const lines = w.skus.flatMap((s) => (skuIds.has(s.sku) ? [{ variantId: skuIds.get(s.sku)!, qty: s.qty }] : []));
    if (!lines.length) continue;
    const rand = randFor(w.ref);
    const customerName = rand() < 0.3 ? CUSTOMERS[Math.floor(rand() * CUSTOMERS.length)]! : '';
    if (await tryRingUp(rand, till.id, { storeId: store.id, lines, customerName, clientRef: w.ref }, w.at.toJSDate())) result.sales++;
  }

  // 4. Appointments that finished a little while ago: most are paid, a few were no-shows.
  const finished = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.storeId, store.id),
        eq(bookings.status, 'booked'),
        gte(bookings.endsAt, DateTime.max(today, from).toJSDate()),
        lte(bookings.endsAt, nowLocal.minus({ minutes: CHECKOUT_DELAY_MIN }).toJSDate()),
      ),
    );
  for (const b of finished) {
    const rand = randFor(`booking:${b.id}`);
    if (rand() < NO_SHOW_RATE) {
      await updateBooking(b.id, { status: 'no_show' }).catch(() => undefined);
      result.noShows++;
      continue;
    }
    const lines: DemoLine[] = [{ variantId: b.variantId, qty: 1, staffId: b.staffId }];
    const addOn = rand() < 0.35 ? skuIds.get(ADD_ONS[Math.floor(rand() * ADD_ONS.length)]!) : undefined;
    if (addOn) lines.push({ variantId: addOn, qty: 1 });
    const sale = { storeId: store.id, customerName: b.customerName, bookingId: b.id, clientRef: uuidFrom(`booking:${b.id}`) };
    // If the add-on is sold out, the appointment is still paid on its own.
    const ok =
      (await tryRingUp(rand, till.id, { ...sale, lines }, b.endsAt)) ||
      (lines.length > 1 && (await tryRingUp(rand, till.id, { ...sale, lines: lines.slice(0, 1) }, b.endsAt)));
    if (ok) result.checkedOut++;
  }
}

/** A simulated sale may legitimately fail (item sold out, a visitor checked the booking out first). */
async function tryRingUp(rand: () => number, userId: string, input: Parameters<typeof ringUp>[2], at: Date) {
  try {
    await ringUp(rand, userId, input, at);
    return true;
  } catch {
    return false;
  }
}
