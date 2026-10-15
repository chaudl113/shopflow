import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { z } from 'zod';
import { availability, createBooking, getBookings, teamSchedule } from '../booking/booking.js';
import { findVariants } from '../catalog/catalog.js';
import { db } from '../db/client.js';
import { stores } from '../db/schema.js';
import { notFound, parse } from '../lib/errors.js';
import { uuid } from '../lib/zod.js';

/** Unauthenticated endpoints behind the public booking page. They expose no customer data. */
export const publicRouter = Router();

const readLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });
// Per client IP (see TRUST_PROXY); stricter in the public demo.
const bookLimiter = rateLimit({ windowMs: 10 * 60_000, limit: config.demoPublic ? 10 : 20, standardHeaders: true, legacyHeaders: false });

async function storeBySlug(slug: unknown) {
  const s = parse(z.string().min(1).max(60), slug);
  const [store] = await db
    .select()
    .from(stores)
    .where(and(eq(stores.slug, s), eq(stores.kind, 'store'), eq(stores.bookingEnabled, true)));
  if (!store) throw notFound('Store');
  return store;
}

publicRouter.get('/stores/:slug', readLimiter, async (req, res) => {
  const store = await storeBySlug(req.params.slug);
  const team = await teamSchedule(store.id);
  const offered = new Set(team.filter((t) => t.hours.length).flatMap((t) => t.productIds));
  const services = (await findVariants(db, { storeId: store.id, type: 'service' }))
    .filter((v) => v.durationMin && offered.has(v.productId))
    .map((v) => ({ id: v.id, productId: v.productId, name: v.label, category: v.category, durationMin: v.durationMin, priceCents: v.priceCents }));
  res.json({
    store: { name: store.name, slug: store.slug, address: store.address, phone: store.phone, timezone: store.timezone },
    services,
    staff: team.filter((t) => t.hours.length).map((t) => ({ id: t.id, name: t.name, color: t.color, productIds: t.productIds })),
  });
});

publicRouter.get('/stores/:slug/availability', readLimiter, async (req, res) => {
  const store = await storeBySlug(req.params.slug);
  const q = parse(z.object({ variantId: uuid, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), staffId: uuid.optional() }), req.query);
  const a = await availability(db, { ...q, storeId: store.id });
  res.json({ date: a.date, timezone: a.timezone, durationMin: a.durationMin, staff: a.staff.map(({ id, name, color, slots }) => ({ id, name, color, slots })) });
});

publicRouter.post('/stores/:slug/bookings', bookLimiter, async (req, res) => {
  const store = await storeBySlug(req.params.slug);
  const body = parse(
    z.object({
      variantId: uuid,
      staffId: uuid.nullable().optional(),
      startsAt: z.iso.datetime({ offset: true }),
      customerName: z.string().trim().min(2).max(80),
      customerPhone: z.string().trim().min(7).max(30).regex(/^[\d\s()+.-]+$/, 'Enter a valid phone number'),
      customerEmail: z.email().max(120).optional().or(z.literal('')),
      note: z.string().trim().max(300).optional(),
    }),
    req.body,
  );
  const row = await createBooking({ ...body, storeId: store.id, source: 'online' }, { enforceHours: true });
  const [b] = await getBookings({ ids: [row.id] });
  res.status(201).json({
    booking: { reference: b!.reference, startsAt: b!.startsAt, endsAt: b!.endsAt, serviceName: b!.serviceName, staffName: b!.staffName, storeName: store.name, timezone: store.timezone },
  });
});
