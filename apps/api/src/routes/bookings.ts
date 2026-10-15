import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { assertStoreAccess, authUser, requireRole } from '../auth.js';
import { availability, createBooking, getBookings, setStaffSchedule, teamSchedule, updateBooking } from '../booking/booking.js';
import { db } from '../db/client.js';
import { bookings } from '../db/schema.js';
import { notFound, parse } from '../lib/errors.js';
import { uuid } from '../lib/zod.js';

export const bookingsRouter = Router();
const desk = requireRole('owner', 'manager', 'cashier');

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const instant = z.iso.datetime({ offset: true });

bookingsRouter.get('/', async (req, res) => {
  const q = parse(z.object({ storeId: uuid, from: instant, to: instant }), req.query);
  assertStoreAccess(authUser(req), q.storeId);
  res.json({ bookings: await getBookings({ storeId: q.storeId, from: new Date(q.from), to: new Date(q.to) }) });
});

bookingsRouter.get('/availability', async (req, res) => {
  const q = parse(z.object({ storeId: uuid, variantId: uuid, date: isoDate, staffId: uuid.optional(), excludeBookingId: uuid.optional() }), req.query);
  assertStoreAccess(authUser(req), q.storeId);
  const { service: _s, ...rest } = await availability(db, q);
  res.json(rest);
});

bookingsRouter.get('/team', async (req, res) => {
  const q = parse(z.object({ storeId: uuid }), req.query);
  assertStoreAccess(authUser(req), q.storeId);
  res.json({ team: await teamSchedule(q.storeId) });
});

const hoursRange = z.object({ weekday: z.number().int().min(1).max(7), startMin: z.number().int().min(0).max(1439), endMin: z.number().int().min(1).max(1440) }).refine((h) => h.startMin < h.endMin, 'End must be after start');

bookingsRouter.put('/team/:userId', requireRole('owner', 'manager'), async (req, res) => {
  const userId = parse(uuid, req.params.userId);
  const body = parse(z.object({ storeId: uuid, hours: z.array(hoursRange).max(28), productIds: z.array(uuid).max(200).optional() }), req.body);
  assertStoreAccess(authUser(req), body.storeId);
  await setStaffSchedule(body.storeId, userId, body);
  res.json({ team: await teamSchedule(body.storeId) });
});

const customer = {
  customerName: z.string().trim().min(1).max(80),
  customerPhone: z.string().trim().max(30).optional(),
  note: z.string().trim().max(300).optional(),
};

bookingsRouter.post('/', desk, async (req, res) => {
  const user = authUser(req);
  const body = parse(z.object({ storeId: uuid, variantId: uuid, staffId: uuid, startsAt: instant, ...customer }), req.body);
  assertStoreAccess(user, body.storeId);
  const row = await createBooking({ ...body, source: 'staff' }, { actorId: user.id, enforceHours: false });
  res.status(201).json({ booking: (await getBookings({ ids: [row.id] }))[0] });
});

async function loadForAccess(req: Parameters<Parameters<typeof bookingsRouter.get>[1]>[0]) {
  const id = parse(uuid, req.params.id);
  const [b] = await db.select({ storeId: bookings.storeId }).from(bookings).where(eq(bookings.id, id));
  if (!b) throw notFound('Booking');
  assertStoreAccess(authUser(req), b.storeId);
  return id;
}

bookingsRouter.get('/:id', async (req, res) => {
  const id = await loadForAccess(req);
  res.json({ booking: (await getBookings({ ids: [id] }))[0] });
});

bookingsRouter.patch('/:id', desk, async (req, res) => {
  const id = await loadForAccess(req);
  const body = parse(
    z.object({
      startsAt: instant.optional(),
      staffId: uuid.optional(),
      variantId: uuid.optional(),
      status: z.enum(['booked', 'cancelled', 'no_show']).optional(),
      customerName: customer.customerName.optional(),
      customerPhone: customer.customerPhone,
      note: customer.note,
    }),
    req.body,
  );
  res.json({ booking: await updateBooking(id, body) });
});
