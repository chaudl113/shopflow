import request from 'supertest';
import { sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { availability } from '../src/booking/booking.js';
import { db, pool } from '../src/db/client.js';
import { api, app, makeProduct, makeStore, makeUser, resetDb } from './helpers.js';

afterAll(() => pool.end());

const TZ = 'America/New_York';
type User = Awaited<ReturnType<typeof makeUser>>;

/** A local date in the store's timezone, at least a few days ahead, on the given ISO weekday. */
function upcoming(weekday: number) {
  let d = DateTime.now().setZone(TZ).plus({ days: 3 }).startOf('day');
  while (d.weekday !== weekday) d = d.plus({ days: 1 });
  return d;
}
const at = (day: DateTime, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return day.set({ hour: h, minute: m }).toUTC().toISO()!;
};

let store: Awaited<ReturnType<typeof makeStore>>;
let manager: User;
let cashier: User;
let mia: User;
let noah: User;
let cut: Awaited<ReturnType<typeof makeProduct>>;
let mon: DateTime;

const pub = () => request(app);
const book = (staff: User | null, startsAt: string, name = 'Jane Doe') =>
  pub().post(`/api/public/stores/${store.slug}/bookings`).send({ variantId: cut.variant.id, staffId: staff?.id ?? null, startsAt, customerName: name, customerPhone: '212 555 0100' });
const deskBook = (staff: User, startsAt: string) =>
  api(cashier.token).post('/api/bookings', { storeId: store.id, variantId: cut.variant.id, staffId: staff.id, startsAt, customerName: 'Walk-in' });

beforeEach(async () => {
  await resetDb();
  store = await makeStore({ code: 'DT', bookingEnabled: true, timezone: TZ });
  manager = await makeUser('manager', [store.id]);
  cashier = await makeUser('cashier', [store.id]);
  mia = await makeUser('staff', [store.id], { bookable: true, name: 'Mia' });
  noah = await makeUser('staff', [store.id], { bookable: true, name: 'Noah' });
  cut = await makeProduct({ type: 'service', durationMin: 60, priceCents: 6500, name: 'Haircut' });
  // Both work Monday 09:00-12:00 and do haircuts.
  for (const u of [mia, noah]) {
    await api(manager.token)
      .put(`/api/bookings/team/${u.id}`, { storeId: store.id, hours: [{ weekday: 1, startMin: 9 * 60, endMin: 12 * 60 }], productIds: [cut.product.id] })
      .expect(200);
  }
  mon = upcoming(1);
});

describe('availability', () => {
  it('offers 15-minute starts that fit the service inside working hours and skip existing bookings', async () => {
    await deskBook(mia, at(mon, '10:00')).expect(201);
    const res = await pub().get(`/api/public/stores/${store.slug}/availability?variantId=${cut.variant.id}&date=${mon.toISODate()}&staffId=${mia.id}`).expect(200);
    // 60-minute service in 09:00-12:00 => starts 09:00…11:00; the 10:00-11:00 booking blocks 09:15…10:45.
    expect(res.body.staff[0].slots).toEqual([at(mon, '09:00'), at(mon, '11:00')]);
  });

  it('keeps wall-clock hours across the daylight-saving change', async () => {
    const now = new Date('2026-10-01T00:00:00Z');
    const before = await availability(db, { storeId: store.id, variantId: cut.variant.id, date: '2026-10-26', staffId: mia.id, now });
    const after = await availability(db, { storeId: store.id, variantId: cut.variant.id, date: '2026-11-02', staffId: mia.id, now });
    expect(before.staff[0]!.slots[0]).toBe('2026-10-26T13:00:00.000Z'); // 09:00 EDT (UTC-4)
    expect(after.staff[0]!.slots[0]).toBe('2026-11-02T14:00:00.000Z'); // 09:00 EST (UTC-5)
  });

  it('never offers times in the past and nothing on days off', async () => {
    const today = DateTime.fromISO('2026-10-26T10:20', { zone: TZ });
    const a = await availability(db, { storeId: store.id, variantId: cut.variant.id, date: '2026-10-26', staffId: mia.id, now: today.toJSDate() });
    expect(a.staff[0]!.slots).toEqual([at(today, '10:30'), at(today, '10:45'), at(today, '11:00')]);
    const tue = await availability(db, { storeId: store.id, variantId: cut.variant.id, date: '2026-10-27', now: today.toJSDate() });
    expect(tue.staff.every((s) => s.slots.length === 0)).toBe(true);
  });
});

describe('double booking', () => {
  it('rejects an overlapping booking for the same person, allows back-to-back and other staff', async () => {
    const first = await deskBook(mia, at(mon, '10:00')).expect(201);
    const clash = await deskBook(mia, at(mon, '10:30')).expect(409);
    expect(clash.body.error.code).toBe('SLOT_TAKEN');
    await deskBook(mia, at(mon, '11:00')).expect(201); // starts exactly when the first one ends
    await deskBook(noah, at(mon, '10:30')).expect(201);

    // Cancelling frees the time again.
    await api(cashier.token).patch(`/api/bookings/${first.body.booking.id}`, { status: 'cancelled' }).expect(200);
    await deskBook(mia, at(mon, '09:30')).expect(201);
  });

  it('lets exactly one of several simultaneous requests win the same slot (database constraint)', async () => {
    // The desk path has no availability pre-check, so only the exclusion constraint stands in the way.
    const results = await Promise.all([deskBook(mia, at(mon, '10:00')), deskBook(mia, at(mon, '10:15')), deskBook(mia, at(mon, '10:30')), deskBook(mia, at(mon, '10:45'))]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);

    const online = await Promise.all([1, 2, 3, 4, 5].map((n) => book(noah, at(mon, '09:00'), `Customer ${n}`)));
    expect(online.filter((r) => r.status === 201)).toHaveLength(1);
    expect(online.filter((r) => r.status === 409)).toHaveLength(4);
  });

  it('blocks the same person across stores', async () => {
    const other = await makeStore({ code: 'UP', bookingEnabled: true, timezone: TZ });
    await db.execute(sql`insert into user_stores (user_id, store_id) values (${mia.id}, ${other.id}), (${cashier.id}, ${other.id})`);
    await deskBook(mia, at(mon, '10:00')).expect(201);
    const res = await api(cashier.token).post('/api/bookings', { storeId: other.id, variantId: cut.variant.id, staffId: mia.id, startsAt: at(mon, '10:30'), customerName: 'X' }).expect(409);
    expect(res.body.error.code).toBe('SLOT_TAKEN');
  });

  it('rejects a reschedule onto someone else’s appointment', async () => {
    await deskBook(mia, at(mon, '09:00')).expect(201);
    const b = await deskBook(mia, at(mon, '11:00')).expect(201);
    await api(cashier.token).patch(`/api/bookings/${b.body.booking.id}`, { startsAt: at(mon, '09:30') }).expect(409);
    const moved = await api(cashier.token).patch(`/api/bookings/${b.body.booking.id}`, { startsAt: at(mon, '10:00'), staffId: noah.id }).expect(200);
    expect(moved.body.booking).toMatchObject({ staffId: noah.id, durationMin: 60 });
  });
});

describe('public booking page', () => {
  it('books an offered slot and returns a reference, without exposing other customers', async () => {
    await book(mia, at(mon, '09:00'), 'Private Person').expect(201);
    const res = await book(null, at(mon, '09:00')).expect(201); // "anyone": Mia is busy, so Noah gets it
    expect(res.body.booking).toMatchObject({ staffName: 'Noah', serviceName: 'Haircut' });
    expect(res.body.booking.reference).toMatch(/^BK-[A-Z0-9]{6}$/);

    const info = await pub().get(`/api/public/stores/${store.slug}`).expect(200);
    const slots = await pub().get(`/api/public/stores/${store.slug}/availability?variantId=${cut.variant.id}&date=${mon.toISODate()}`).expect(200);
    expect(JSON.stringify([info.body, slots.body])).not.toContain('Private Person');
  });

  it('refuses times outside working hours, off the grid, in the past, or for untrained staff', async () => {
    expect((await book(mia, at(mon, '11:30')).expect(409)).body.error.code).toBe('SLOT_UNAVAILABLE'); // would end 12:30
    expect((await book(mia, at(mon, '09:10')).expect(409)).body.error.code).toBe('SLOT_UNAVAILABLE');
    await book(mia, at(DateTime.now().setZone(TZ).minus({ days: 7 }).set({ weekday: 1 }), '09:00')).expect(409);
    const color = await makeProduct({ type: 'service', durationMin: 90, name: 'Color' });
    const r = await pub().post(`/api/public/stores/${store.slug}/bookings`).send({ variantId: color.variant.id, staffId: mia.id, startsAt: at(mon, '09:00'), customerName: 'Jane', customerPhone: '2125550100' });
    expect(r.status).toBe(400);
  });

  it('hides stores that do not take online bookings', async () => {
    const closed = await makeStore({ bookingEnabled: false });
    await pub().get(`/api/public/stores/${closed.slug}`).expect(404);
  });
});

describe('checking out a booking at the POS', () => {
  async function openShift(user: User) {
    await api(user.token).post('/api/shifts/open', { storeId: store.id, openingFloatCents: 0 }).expect(201);
  }
  const checkout = (user: User, bookingId: string) =>
    api(user.token).post('/api/sales', {
      storeId: store.id,
      bookingId,
      lines: [{ variantId: cut.variant.id, qty: 1, staffId: mia.id }],
      payments: [{ method: 'card', amountCents: 6500 }],
    });

  it('marks the booking completed and links the sale; it cannot be charged twice', async () => {
    const b = await book(mia, at(mon, '09:00')).expect(201);
    const [row] = (await api(cashier.token).get(`/api/bookings?storeId=${store.id}&from=${at(mon, '00:00')}&to=${at(mon, '23:59')}`).expect(200)).body.bookings;
    expect(row.reference).toBe(b.body.booking.reference);
    await openShift(cashier);

    const sale = await checkout(cashier, row.id).expect(201);
    const after = await api(cashier.token).get(`/api/bookings/${row.id}`).expect(200);
    expect(after.body.booking).toMatchObject({ status: 'completed', saleId: sale.body.sale.id });

    expect((await checkout(cashier, row.id).expect(409)).body.error.code).toBe('BOOKING_NOT_OPEN');
    await api(cashier.token).patch(`/api/bookings/${row.id}`, { status: 'cancelled' }).expect(409);
  });

  it('lets only one of two tills check out the same appointment', async () => {
    const second = await makeUser('cashier', [store.id]);
    await openShift(cashier);
    await openShift(second);
    const b = await deskBook(mia, at(mon, '09:00')).expect(201);
    const results = await Promise.all([checkout(cashier, b.body.booking.id), checkout(second, b.body.booking.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('rejects cancelled bookings and bookings from another store', async () => {
    await openShift(cashier);
    const b = await deskBook(mia, at(mon, '09:00')).expect(201);
    await api(cashier.token).patch(`/api/bookings/${b.body.booking.id}`, { status: 'cancelled' }).expect(200);
    await checkout(cashier, b.body.booking.id).expect(409);

    const other = await makeStore({ code: 'UP', timezone: TZ });
    const owner = await makeUser('owner');
    await db.execute(sql`insert into user_stores (user_id, store_id) values (${mia.id}, ${other.id})`);
    const elsewhere = await api(owner.token).post('/api/bookings', { storeId: other.id, variantId: cut.variant.id, staffId: mia.id, startsAt: at(mon, '11:00'), customerName: 'X' }).expect(201);
    expect((await checkout(cashier, elsewhere.body.booking.id).expect(400)).body.error.code).toBe('BOOKING_NOT_FOUND');
    // …and a manager who does not work at that store cannot see it at all.
    await api(manager.token).get(`/api/bookings/${elsewhere.body.booking.id}`).expect(403);
  });

  it('only front-desk roles can create or change bookings', async () => {
    await api(mia.token).post('/api/bookings', { storeId: store.id, variantId: cut.variant.id, staffId: mia.id, startsAt: at(mon, '09:00'), customerName: 'X' }).expect(403);
    await api(mia.token).get(`/api/bookings?storeId=${store.id}&from=${at(mon, '00:00')}&to=${at(mon, '23:59')}`).expect(200);
  });
});
