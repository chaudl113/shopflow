import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Public demo mode is read from the environment when the app module loads.
vi.hoisted(() => {
  process.env.DEMO_PUBLIC = '1';
});

import { createBooking } from '../src/booking/booking.js';
import { db, pool } from '../src/db/client.js';
import { bookings, sales, shifts, staffServices, variants } from '../src/db/schema.js';
import { simulateDemoDay, walkInPlan } from '../src/demo/simulate.js';
import { createSale } from '../src/pos/sales.js';
import { closeShift, openShift } from '../src/pos/shifts.js';
import { DateTime } from 'luxon';
import { api, app, makeProduct, makeStore, makeUser, resetDb } from './helpers.js';

afterAll(() => pool.end());

type User = Awaited<ReturnType<typeof makeUser>>;
let owner: User;
let cashier: User;
let stylist: User;
let dt: Awaited<ReturnType<typeof makeStore>>;
let cut: Awaited<ReturnType<typeof makeProduct>>;

const NY = 'America/New_York';
const at = (iso: string) => DateTime.fromISO(iso, { zone: NY }).toJSDate();

beforeEach(async () => {
  await resetDb();
  dt = await makeStore({ code: 'DT', slug: 'downtown', name: 'Lumen Downtown', timezone: NY, bookingEnabled: true });
  owner = await makeUser('owner', [], { email: 'owner@shopflow.demo', name: 'Olivia' });
  cashier = await makeUser('cashier', [dt.id], { email: 'cashier@shopflow.demo', name: 'Chloe' });
  stylist = await makeUser('staff', [dt.id], { email: 'mia@shopflow.demo', name: 'Mia', bookable: true });
  cut = await makeProduct({ name: 'Haircut', type: 'service', durationMin: 60, priceCents: 6500 });
  await db.insert(staffServices).values({ userId: stylist.id, productId: cut.product.id });
  // Every retail SKU the walk-in plan can pick, well stocked.
  for (const sku of ['NAIL-CRL', 'NAIL-RBY', 'NAIL-NUD', 'MASK-HYD', 'ARG-SH-250', 'ARG-SH-500', 'SILK-CO', 'CLAY-MT', 'HEAT-SP', 'SER-VITC', 'BR-RND-S', 'BR-RND-M', 'BR-RND-L', 'DRY-ION-BK', 'DRY-ION-PL']) {
    const { variant } = await makeProduct({ name: sku, priceCents: 1200 });
    await db.update(variants).set({ sku }).where(eq(variants.id, variant.id));
    await api(owner.token).post('/api/inventory/receive', { storeId: dt.id, lines: [{ variantId: variant.id, qty: 500 }] }).expect(201);
  }
});

describe('public demo sign-in and account lock', () => {
  it('tells the web app it is a demo and where the booking page is', async () => {
    const res = await request(app).get('/api/meta').expect(200);
    expect(res.body).toEqual({ demo: true, bookingPage: { slug: 'downtown', name: 'Lumen Downtown' } });
  });

  it('signs in as a demo role with one click, without a password', async () => {
    const res = await request(app).post('/api/auth/demo').send({ as: 'cashier' }).expect(200);
    expect(res.body.user).toMatchObject({ email: 'cashier@shopflow.demo', role: 'cashier' });
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`).expect(200);
    await request(app).post('/api/auth/demo').send({ as: 'root' }).expect(400);
  });

  it('refuses to change or disable shared demo accounts, other users stay editable', async () => {
    for (const body of [{ password: 'hijacked-123' }, { active: false }, { email: 'me@example.com' }, { role: 'staff' }]) {
      const res = await api(owner.token).patch(`/api/users/${cashier.id}`, body).expect(403);
      expect(res.body.error.code).toBe('DEMO_LOCKED');
    }
    const visitor = await makeUser('cashier', [dt.id]);
    await api(owner.token).patch(`/api/users/${visitor.id}`, { name: 'Renamed', password: 'new-password-1' }).expect(200);
  });
});

describe('live demo trading for today', () => {
  it('replays the day up to now, checks out finished appointments and closes yesterday’s drawer', async () => {
    // Yesterday's drawer was left open with one sale at 9:40 pm.
    const old = await openShift(cashier.id, dt.id, 10000, at('2026-10-13T09:00'));
    const { variant: shampoo } = await makeProduct({ name: 'Old shampoo', priceCents: 2000 });
    await api(owner.token).post('/api/inventory/receive', { storeId: dt.id, lines: [{ variantId: shampoo.id, qty: 5 }] }).expect(201);
    await createSale(cashier.id, { storeId: dt.id, lines: [{ variantId: shampoo.id, qty: 1 }], payments: [{ method: 'cash', amountCents: 5000 }] }, { at: at('2026-10-13T21:40') });
    // Today: one appointment already over, one later this afternoon.
    const book = (start: string) =>
      createBooking({ storeId: dt.id, variantId: cut.variant.id, staffId: stylist.id, startsAt: at(start), customerName: 'Grace Lee', source: 'online' }, { enforceHours: false });
    const done = await book('2026-10-14T10:00');
    const later = await book('2026-10-14T16:00');

    const now = at('2026-10-14T14:00');
    const r1 = await simulateDemoDay(now);
    expect(r1).toMatchObject({ closedShifts: 1 });

    const [closed] = await db.select().from(shifts).where(eq(shifts.id, old.id));
    expect(closed).toMatchObject({ status: 'closed', differenceCents: 0, closedAt: at('2026-10-13T21:41') });

    const today = await db.select().from(sales).where(eq(sales.storeId, dt.id));
    const todays = today.filter((s) => s.createdAt >= at('2026-10-14T00:00'));
    const plannedByNow = walkInPlan('DT', DateTime.fromJSDate(now).setZone(NY).startOf('day')).filter((w) => w.at.toJSDate() <= now).length;
    expect(todays.length).toBe(plannedByNow + (r1!.noShows ? 0 : 1));
    expect(todays.every((s) => s.createdAt <= now)).toBe(true);

    const [b1] = await db.select().from(bookings).where(eq(bookings.id, done.id));
    const [b2] = await db.select().from(bookings).where(eq(bookings.id, later.id));
    expect(['completed', 'no_show']).toContain(b1!.status);
    expect(b2!.status).toBe('booked');

    // Replaying the same moment books nothing twice.
    const r2 = await simulateDemoDay(now);
    expect(r2).toEqual({ sales: 0, checkedOut: 0, noShows: 0, closedShifts: 0 });

    // Later in the day the plan continues on the same drawer.
    const r3 = await simulateDemoDay(at('2026-10-14T20:00'));
    expect(r3!.sales).toBeGreaterThan(0);
    const open = await db.select().from(shifts).where(and(eq(shifts.userId, cashier.id), eq(shifts.status, 'open')));
    expect(open).toHaveLength(1);
  });

  it('has sales on the dashboard for "today" a quarter of an hour after midnight', async () => {
    await simulateDemoDay(at('2026-10-15T00:15'));
    const res = await api(owner.token).get(`/api/reports/sales?storeId=${dt.id}&from=2026-10-15&to=2026-10-15`).expect(200);
    expect(res.body.totals.salesCount).toBeGreaterThan(0);
  });

  it('reopens the till from the moment a visitor closed it, never filling the gap behind them', async () => {
    await simulateDemoDay(at('2026-10-14T11:00'));
    const [shift] = await db.select().from(shifts).where(eq(shifts.status, 'open'));
    // A visitor counts the drawer and closes it at 11:30.
    const closedAt = at('2026-10-14T11:30');
    await closeShift(shift!.id, cashier.id, 0, 'Visitor closed it', closedAt);

    await simulateDemoDay(at('2026-10-14T23:00'));
    const [reopened] = await db.select().from(shifts).where(eq(shifts.status, 'open'));
    expect(reopened!.openedAt.getTime()).toBe(closedAt.getTime());
    const after = await db.execute(sql`select count(*)::int as n from sales where shift_id = ${reopened!.id} and created_at < ${closedAt}`);
    expect((after.rows[0] as { n: number }).n).toBe(0);
  });

  it('skips a tick while another one (or a reset) holds the demo lock', async () => {
    const [a, b] = await Promise.all([simulateDemoDay(at('2026-10-14T12:00')), simulateDemoDay(at('2026-10-14T12:00'))]);
    expect([a, b].filter((r) => r === null)).toHaveLength(1);
  });
});

describe('rate limits (per client IP)', () => {
  it('limits one-click demo sign-in', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 22; i++) codes.push((await request(app).post('/api/auth/demo').send({ as: 'owner' })).status);
    expect(codes.slice(0, 18).every((c) => c === 200)).toBe(true); // earlier tests in this file used 2
    expect(codes.at(-1)).toBe(429);
  });

  it('limits sign-in attempts in demo mode to 10 a minute', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await request(app).post('/api/auth/login').send({ email: 'owner@shopflow.demo', password: 'wrong' })).status);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});
