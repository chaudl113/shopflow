import { and, asc, eq, inArray } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { assertStoreAccess, authUser, requireRole } from '../auth.js';
import { db } from '../db/client.js';
import { storePrices, stores } from '../db/schema.js';
import { notFound, parse } from '../lib/errors.js';
import { cents, uuid } from '../lib/zod.js';

export const storesRouter = Router();

storesRouter.get('/', async (req, res) => {
  const user = authUser(req);
  const rows =
    user.role === 'owner'
      ? await db.select().from(stores).orderBy(asc(stores.name))
      : user.storeIds.length
        ? await db.select().from(stores).where(inArray(stores.id, user.storeIds)).orderBy(asc(stores.name))
        : [];
  res.json({ stores: rows });
});

/** Minimal list of every location (transfer destinations). */
storesRouter.get('/directory', async (_req, res) => {
  const rows = await db.select({ id: stores.id, name: stores.name, code: stores.code, kind: stores.kind }).from(stores).orderBy(asc(stores.name));
  res.json({ stores: rows });
});

const storeBody = z.object({
  code: z.string().trim().min(2).max(6).toUpperCase(),
  slug: z.string().trim().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().trim().min(2).max(80),
  kind: z.enum(['store', 'warehouse']).default('store'),
  address: z.string().max(200).default(''),
  phone: z.string().max(40).default(''),
  timezone: z.string().default('America/New_York'),
  taxRateBps: z.number().int().min(0).max(3000).default(0),
  allowNegativeStock: z.boolean().default(false),
  bookingEnabled: z.boolean().default(false),
});

storesRouter.post('/', requireRole('owner'), async (req, res) => {
  const body = parse(storeBody, req.body);
  const [row] = await db.insert(stores).values(body).returning();
  res.status(201).json({ store: row });
});

storesRouter.patch('/:id', requireRole('owner'), async (req, res) => {
  const id = parse(uuid, req.params.id);
  const body = parse(storeBody.partial(), req.body);
  const [row] = await db.update(stores).set(body).where(eq(stores.id, id)).returning();
  if (!row) throw notFound('Store');
  res.json({ store: row });
});

/** Store price override; `priceCents: null` falls back to the variant default price. */
storesRouter.put('/:id/prices/:variantId', requireRole('owner', 'manager'), async (req, res) => {
  const storeId = parse(uuid, req.params.id);
  const variantId = parse(uuid, req.params.variantId);
  assertStoreAccess(authUser(req), storeId);
  const { priceCents } = parse(z.object({ priceCents: cents.nullable() }), req.body);
  if (priceCents === null) {
    await db.delete(storePrices).where(and(eq(storePrices.storeId, storeId), eq(storePrices.variantId, variantId)));
  } else {
    await db
      .insert(storePrices)
      .values({ storeId, variantId, priceCents })
      .onConflictDoUpdate({ target: [storePrices.storeId, storePrices.variantId], set: { priceCents } });
  }
  res.json({ ok: true });
});
