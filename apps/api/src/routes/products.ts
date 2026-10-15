import { eq, inArray, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { assertStoreAccess, authUser, requireRole } from '../auth.js';
import { findVariants } from '../catalog/catalog.js';
import { db } from '../db/client.js';
import { products, variants } from '../db/schema.js';
import { badRequest, notFound, parse } from '../lib/errors.js';
import { cents, uuid } from '../lib/zod.js';

export const productsRouter = Router();

const listQuery = z.object({
  storeId: uuid.optional(),
  q: z.string().trim().max(80).optional(),
  type: z.enum(['product', 'service']).optional(),
  includeInactive: z.coerce.boolean().optional(),
});

productsRouter.get('/', async (req, res) => {
  const q = parse(listQuery, req.query);
  if (q.storeId) assertStoreAccess(authUser(req), q.storeId);
  const rows = await findVariants(db, q);
  const productIds = [...new Set(rows.map((r) => r.productId))];
  const meta = productIds.length ? await db.select().from(products).where(inArray(products.id, productIds)) : [];
  const metaById = new Map(meta.map((p) => [p.id, p]));
  const grouped = productIds.map((id) => ({ ...metaById.get(id)!, variants: rows.filter((r) => r.productId === id) }));
  res.json({ products: grouped });
});

/** Flat variant search (POS grid, pickers). */
productsRouter.get('/variants', async (req, res) => {
  const q = parse(listQuery.extend({ storeId: uuid }), req.query);
  assertStoreAccess(authUser(req), q.storeId);
  res.json({ variants: await findVariants(db, q) });
});

/** Exact barcode or SKU match, used by the POS scanner (camera or keyboard wedge). */
productsRouter.get('/lookup', async (req, res) => {
  const q = parse(z.object({ storeId: uuid, code: z.string().trim().min(1).max(64) }), req.query);
  assertStoreAccess(authUser(req), q.storeId);
  const [v] = await findVariants(db, { storeId: q.storeId, code: q.code });
  if (!v) throw notFound(`No product with barcode/SKU "${q.code}"`);
  res.json({ variant: v });
});

const variantBody = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1).max(60).default('Default'),
  sku: z.string().trim().min(1).max(40),
  barcode: z.string().trim().max(64).nullable().optional().transform((v) => (v ? v : null)),
  priceCents: cents,
  costCents: cents.default(0),
  reorderLevel: z.number().int().min(0).max(100_000).default(5),
  active: z.boolean().default(true),
});

const productBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    type: z.enum(['product', 'service']).default('product'),
    category: z.string().trim().min(1).max(60).default('General'),
    description: z.string().max(2000).default(''),
    durationMin: z.number().int().min(5).max(480).nullable().optional(),
    active: z.boolean().default(true),
    variants: z.array(variantBody).min(1).max(100),
  })
  .refine((p) => p.type !== 'service' || !!p.durationMin, { message: 'Services need a duration', path: ['durationMin'] });

productsRouter.post('/', requireRole('owner', 'manager'), async (req, res) => {
  const body = parse(productBody, req.body);
  const id = await db.transaction(async (tx) => {
    const [p] = await tx
      .insert(products)
      .values({ name: body.name, type: body.type, category: body.category, description: body.description, durationMin: body.type === 'service' ? body.durationMin : null, active: body.active })
      .returning({ id: products.id });
    await tx.insert(variants).values(body.variants.map(({ id: _ignored, ...v }) => ({ ...v, productId: p!.id })));
    return p!.id;
  });
  res.status(201).json({ id });
});

/** Variants omitted from the payload are deactivated, never deleted (the ledger references them). */
productsRouter.put('/:id', requireRole('owner', 'manager'), async (req, res) => {
  const id = parse(uuid, req.params.id);
  const body = parse(productBody, req.body);
  await db.transaction(async (tx) => {
    const [p] = await tx
      .update(products)
      .set({ name: body.name, category: body.category, description: body.description, durationMin: body.type === 'service' ? body.durationMin : null, active: body.active })
      .where(eq(products.id, id))
      .returning({ type: products.type });
    if (!p) throw notFound('Product');
    if (p.type !== body.type) throw badRequest('TYPE_LOCKED', 'Product type cannot be changed after creation');
    const existing = await tx.select({ id: variants.id }).from(variants).where(eq(variants.productId, id));
    const existingIds = new Set(existing.map((e) => e.id));
    const keep = new Set<string>();
    for (const { id: vid, ...v } of body.variants) {
      if (vid) {
        if (!existingIds.has(vid)) throw badRequest('UNKNOWN_VARIANT', 'Variant does not belong to this product');
        keep.add(vid);
        await tx.update(variants).set(v).where(eq(variants.id, vid));
      } else {
        await tx.insert(variants).values({ ...v, productId: id });
      }
    }
    const drop = [...existingIds].filter((x) => !keep.has(x));
    if (drop.length) await tx.update(variants).set({ active: false }).where(inArray(variants.id, drop));
  });
  res.json({ ok: true });
});

productsRouter.get('/categories', async (_req, res) => {
  const rows = await db.execute(sql`select distinct category from products where active order by category`);
  res.json({ categories: rows.rows.map((r) => (r as { category: string }).category) });
});
