import { randomInt } from 'node:crypto';
import { and, asc, eq, gt, inArray, lt, ne, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { findVariants, type VariantView } from '../catalog/catalog.js';
import { db, type DbOrTx, type Tx } from '../db/client.js';
import { bookings, products, staffHours, staffServices, stores, userStores, users, variants } from '../db/schema.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';

/** Start times are offered on a 15-minute grid. */
export const SLOT_STEP_MIN = 15;
const LIVE = ['booked', 'completed'] as const;

export type BookingStatus = (typeof bookings.$inferSelect)['status'];

export interface StaffSlots {
  id: string;
  name: string;
  color: string;
  /** UTC ISO start times that fit the service and do not clash with anything. */
  slots: string[];
  bookedMinutes: number;
}

async function loadStore(conn: DbOrTx, storeId: string) {
  const [store] = await conn.select().from(stores).where(eq(stores.id, storeId));
  if (!store) throw notFound('Store');
  if (store.kind !== 'store') throw badRequest('NOT_A_STORE', 'Warehouses do not take bookings');
  return store;
}

export async function loadService(conn: DbOrTx, storeId: string, variantId: string): Promise<VariantView & { durationMin: number }> {
  const [v] = await findVariants(conn, { storeId, variantIds: [variantId], type: 'service' });
  if (!v || !v.durationMin) throw badRequest('NOT_A_SERVICE', 'Choose a bookable service');
  return v as VariantView & { durationMin: number };
}

/** Active, bookable people who work at the store and are trained for the service. */
export async function eligibleStaff(conn: DbOrTx, storeId: string, productId: string) {
  return conn
    .select({ id: users.id, name: users.name, color: users.color })
    .from(users)
    .innerJoin(userStores, and(eq(userStores.userId, users.id), eq(userStores.storeId, storeId)))
    .innerJoin(staffServices, and(eq(staffServices.userId, users.id), eq(staffServices.productId, productId)))
    .where(and(eq(users.bookable, true), eq(users.active, true)))
    .orderBy(asc(users.name));
}

/** `minutes` after local midnight as a wall-clock time, so 09:00 stays 09:00 on DST days. */
function atMinute(day: DateTime, minutes: number) {
  if (minutes >= 1440) return day.plus({ days: 1 }).startOf('day');
  return day.set({ hour: Math.floor(minutes / 60), minute: minutes % 60, second: 0, millisecond: 0 });
}

export interface AvailabilityQuery {
  storeId: string;
  variantId: string;
  /** Local date in the store's timezone, YYYY-MM-DD. */
  date: string;
  staffId?: string;
  /** Ignore this booking when looking for clashes (used when rescheduling it). */
  excludeBookingId?: string;
  now?: Date;
}

export async function availability(conn: DbOrTx, q: AvailabilityQuery) {
  const store = await loadStore(conn, q.storeId);
  const service = await loadService(conn, q.storeId, q.variantId);
  let staff = await eligibleStaff(conn, q.storeId, service.productId);
  if (q.staffId) {
    staff = staff.filter((s) => s.id === q.staffId);
    if (!staff.length) throw badRequest('STAFF_CANNOT_PERFORM', 'That team member does not offer this service here');
  }
  const day = DateTime.fromISO(q.date, { zone: store.timezone }).startOf('day');
  if (!day.isValid) throw badRequest('BAD_DATE', 'Invalid date');
  const dayEnd = day.plus({ days: 1 });
  const ids = staff.map((s) => s.id);
  const now = DateTime.fromJSDate(q.now ?? new Date());

  const [hours, busy] = ids.length
    ? await Promise.all([
        conn
          .select()
          .from(staffHours)
          .where(and(eq(staffHours.storeId, q.storeId), inArray(staffHours.userId, ids), eq(staffHours.weekday, day.weekday)))
          .orderBy(asc(staffHours.startMin)),
        // Clashes count in every store: the same person cannot be in two places.
        conn
          .select({ staffId: bookings.staffId, startsAt: bookings.startsAt, endsAt: bookings.endsAt })
          .from(bookings)
          .where(
            and(
              inArray(bookings.staffId, ids),
              inArray(bookings.status, [...LIVE]),
              lt(bookings.startsAt, dayEnd.toJSDate()),
              gt(bookings.endsAt, day.toJSDate()),
              q.excludeBookingId ? ne(bookings.id, q.excludeBookingId) : undefined,
            ),
          ),
      ])
    : [[], []];

  const result: StaffSlots[] = staff.map((s) => {
    const mine = busy.filter((b) => b.staffId === s.id);
    const slots: string[] = [];
    for (const h of hours.filter((x) => x.userId === s.id)) {
      const end = atMinute(day, h.endMin);
      for (let t = atMinute(day, h.startMin); t.plus({ minutes: service.durationMin }) <= end; t = t.plus({ minutes: SLOT_STEP_MIN })) {
        if (t <= now) continue;
        const tEnd = t.plus({ minutes: service.durationMin });
        if (mine.some((b) => b.startsAt < tEnd.toJSDate() && b.endsAt > t.toJSDate())) continue;
        slots.push(t.toUTC().toISO()!);
      }
    }
    const bookedMinutes = mine.reduce((m, b) => m + (b.endsAt.getTime() - b.startsAt.getTime()) / 60_000, 0);
    return { ...s, slots, bookedMinutes };
  });

  return { date: day.toISODate()!, timezone: store.timezone, durationMin: service.durationMin, service, staff: result };
}

const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function makeReference() {
  return 'BK-' + Array.from({ length: 6 }, () => REF_ALPHABET[randomInt(REF_ALPHABET.length)]).join('');
}

export interface BookingInput {
  storeId: string;
  variantId: string;
  /** Omit to let the system pick the least busy free person. */
  staffId?: string | null;
  startsAt: string | Date;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  note?: string;
  source: 'online' | 'staff';
}

/**
 * Online bookings must land on an offered slot (working hours, 15-minute grid, in the future).
 * The front desk may book outside hours, e.g. squeezing in a walk-in. Either way the database
 * exclusion constraint is the final word on overlaps.
 */
export async function createBooking(input: BookingInput, opts: { actorId?: string | null; enforceHours: boolean; now?: Date }) {
  return db.transaction(async (tx) => {
    const store = await loadStore(tx, input.storeId);
    if (input.source === 'online' && !store.bookingEnabled) throw notFound('Store');
    const service = await loadService(tx, input.storeId, input.variantId);
    const start = DateTime.fromJSDate(new Date(input.startsAt)).setZone(store.timezone);
    if (!start.isValid) throw badRequest('BAD_DATE', 'Invalid start time');
    let staffId = input.staffId ?? null;

    if (opts.enforceHours || !staffId) {
      const avail = await availability(tx, { storeId: store.id, variantId: service.id, date: start.toISODate()!, staffId: staffId ?? undefined, now: opts.now });
      const iso = start.toUTC().toISO()!;
      const free = avail.staff.filter((s) => s.slots.includes(iso)).sort((a, b) => a.bookedMinutes - b.bookedMinutes);
      if (!free.length) throw conflict('SLOT_UNAVAILABLE', 'That time is not available. Please pick another slot.');
      staffId = free[0]!.id;
    } else {
      const staff = await eligibleStaff(tx, store.id, service.productId);
      if (!staff.some((s) => s.id === staffId)) throw badRequest('STAFF_CANNOT_PERFORM', 'That team member does not offer this service here');
    }

    const [row] = await tx
      .insert(bookings)
      .values({
        reference: makeReference(),
        storeId: store.id,
        staffId: staffId!,
        variantId: service.id,
        startsAt: start.toJSDate(),
        endsAt: start.plus({ minutes: service.durationMin }).toJSDate(),
        source: input.source,
        customerName: input.customerName,
        customerPhone: input.customerPhone ?? '',
        customerEmail: input.customerEmail ?? '',
        note: input.note ?? '',
        quotedPriceCents: service.priceCents,
        createdBy: opts.actorId ?? null,
      })
      .returning();
    return row!;
  });
}

export interface BookingPatch {
  startsAt?: string;
  staffId?: string;
  variantId?: string;
  status?: 'booked' | 'cancelled' | 'no_show';
  customerName?: string;
  customerPhone?: string;
  note?: string;
}

export async function updateBooking(id: string, patch: BookingPatch) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from bookings where id = ${id} for update`);
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, id));
    if (!b) throw notFound('Booking');
    if (b.status === 'completed') throw conflict('BOOKING_COMPLETED', 'This booking was already checked out');

    const values: Partial<typeof bookings.$inferInsert> = {};
    if (patch.customerName !== undefined) values.customerName = patch.customerName;
    if (patch.customerPhone !== undefined) values.customerPhone = patch.customerPhone;
    if (patch.note !== undefined) values.note = patch.note;
    if (patch.status && patch.status !== b.status) {
      values.status = patch.status;
      values.cancelledAt = patch.status === 'cancelled' ? new Date() : null;
    }
    if (patch.startsAt || patch.staffId || patch.variantId) {
      const service = await loadService(tx, b.storeId, patch.variantId ?? b.variantId);
      const staffId = patch.staffId ?? b.staffId;
      const staff = await eligibleStaff(tx, b.storeId, service.productId);
      if (!staff.some((s) => s.id === staffId)) throw badRequest('STAFF_CANNOT_PERFORM', 'That team member does not offer this service here');
      const start = patch.startsAt ? new Date(patch.startsAt) : b.startsAt;
      Object.assign(values, {
        staffId,
        variantId: service.id,
        startsAt: start,
        endsAt: new Date(start.getTime() + service.durationMin * 60_000),
        quotedPriceCents: service.priceCents,
      });
    }
    if (Object.keys(values).length) await tx.update(bookings).set(values).where(eq(bookings.id, id));
    return (await getBookings({ ids: [id] }, tx))[0]!;
  });
}

export interface BookingView {
  id: string;
  reference: string;
  storeId: string;
  staffId: string;
  staffName: string;
  staffColor: string;
  variantId: string;
  serviceName: string;
  durationMin: number;
  startsAt: Date;
  endsAt: Date;
  status: BookingStatus;
  source: 'online' | 'staff';
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  note: string;
  quotedPriceCents: number;
  saleId: string | null;
  createdAt: Date;
}

export async function getBookings(f: { storeId?: string; from?: Date; to?: Date; ids?: string[]; status?: BookingStatus[] }, conn: DbOrTx = db): Promise<BookingView[]> {
  if (f.ids && !f.ids.length) return [];
  return conn
    .select({
      id: bookings.id,
      reference: bookings.reference,
      storeId: bookings.storeId,
      staffId: bookings.staffId,
      staffName: users.name,
      staffColor: users.color,
      variantId: bookings.variantId,
      serviceName: products.name,
      durationMin: sql<number>`(extract(epoch from ${bookings.endsAt} - ${bookings.startsAt}) / 60)::int`,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      status: bookings.status,
      source: bookings.source,
      customerName: bookings.customerName,
      customerPhone: bookings.customerPhone,
      customerEmail: bookings.customerEmail,
      note: bookings.note,
      quotedPriceCents: bookings.quotedPriceCents,
      saleId: bookings.saleId,
      createdAt: bookings.createdAt,
    })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.staffId))
    .innerJoin(variants, eq(variants.id, bookings.variantId))
    .innerJoin(products, eq(products.id, variants.productId))
    .where(
      and(
        f.storeId ? eq(bookings.storeId, f.storeId) : undefined,
        f.from ? gt(bookings.endsAt, f.from) : undefined,
        f.to ? lt(bookings.startsAt, f.to) : undefined,
        f.ids ? inArray(bookings.id, f.ids) : undefined,
        f.status ? inArray(bookings.status, f.status) : undefined,
      ),
    )
    .orderBy(asc(bookings.startsAt));
}

/**
 * Called inside the sale transaction, right after the shift lock: the row lock means two tills
 * cannot both check out the same appointment.
 */
export async function lockBookingForSale(tx: Tx, bookingId: string, storeId: string) {
  await tx.execute(sql`select id from bookings where id = ${bookingId} for update`);
  const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!b || b.storeId !== storeId) throw badRequest('BOOKING_NOT_FOUND', 'Booking not found at this store');
  if (b.status !== 'booked') throw conflict('BOOKING_NOT_OPEN', `This booking is ${b.status.replace('_', ' ')}`);
  return b;
}

export async function completeBooking(tx: Tx, bookingId: string, saleId: string) {
  await tx.update(bookings).set({ status: 'completed', saleId }).where(eq(bookings.id, bookingId));
}

/** Who works at the store, their weekly hours and which services they perform. */
export async function teamSchedule(storeId: string) {
  const people = await db
    .select({ id: users.id, name: users.name, color: users.color, role: users.role })
    .from(users)
    .innerJoin(userStores, and(eq(userStores.userId, users.id), eq(userStores.storeId, storeId)))
    .where(and(eq(users.bookable, true), eq(users.active, true)))
    .orderBy(asc(users.name));
  const ids = people.map((p) => p.id);
  if (!ids.length) return [];
  const [hours, skills] = await Promise.all([
    db.select().from(staffHours).where(and(eq(staffHours.storeId, storeId), inArray(staffHours.userId, ids))).orderBy(asc(staffHours.weekday), asc(staffHours.startMin)),
    db.select().from(staffServices).where(inArray(staffServices.userId, ids)),
  ]);
  return people.map((p) => ({
    ...p,
    hours: hours.filter((h) => h.userId === p.id).map(({ weekday, startMin, endMin }) => ({ weekday, startMin, endMin })),
    productIds: skills.filter((s) => s.userId === p.id).map((s) => s.productId),
  }));
}

export interface HoursRange {
  weekday: number;
  startMin: number;
  endMin: number;
}

export async function setStaffSchedule(storeId: string, userId: string, input: { hours: HoursRange[]; productIds?: string[] }) {
  const sorted = [...input.hours].sort((a, b) => a.weekday - b.weekday || a.startMin - b.startMin);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (prev.weekday === cur.weekday && cur.startMin < prev.endMin) throw badRequest('HOURS_OVERLAP', 'Working hours on the same day overlap');
  }
  await db.transaction(async (tx) => {
    const [member] = await tx.select().from(userStores).where(and(eq(userStores.userId, userId), eq(userStores.storeId, storeId)));
    if (!member) throw badRequest('NOT_A_MEMBER', 'That person does not work at this store');
    await tx.delete(staffHours).where(and(eq(staffHours.storeId, storeId), eq(staffHours.userId, userId)));
    if (sorted.length) await tx.insert(staffHours).values(sorted.map((h) => ({ ...h, storeId, userId })));
    if (input.productIds) {
      await tx.delete(staffServices).where(eq(staffServices.userId, userId));
      if (input.productIds.length) await tx.insert(staffServices).values(input.productIds.map((productId) => ({ userId, productId })));
    }
  });
}
