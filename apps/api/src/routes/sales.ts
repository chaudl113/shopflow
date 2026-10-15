import { desc, eq, ilike, and, type SQL } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { assertStoreAccess, authUser, requireRole } from '../auth.js';
import { db } from '../db/client.js';
import { sales, users } from '../db/schema.js';
import { notFound, parse } from '../lib/errors.js';
import { cents, qty, uuid } from '../lib/zod.js';
import { createReturn, createSale, getSale, quoteCart } from '../pos/sales.js';

export const salesRouter = Router();
const sellers = requireRole('owner', 'manager', 'cashier');

const discount = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('percent'), bps: z.number().int().min(0).max(10000) }),
    z.object({ type: z.literal('amount'), cents }),
  ])
  .nullable()
  .optional();

const cartBody = z.object({
  storeId: uuid,
  lines: z.array(z.object({ variantId: uuid, qty, discount, staffId: uuid.nullable().optional() })).min(1).max(200),
  orderDiscount: discount,
});

/** Live totals for the POS screen, computed by the same code that books the sale. */
salesRouter.post('/quote', sellers, async (req, res) => {
  const body = parse(cartBody, req.body);
  assertStoreAccess(authUser(req), body.storeId);
  const { priced, items } = await quoteCart(db, body);
  res.json({ ...priced, lines: priced.lines.map((l, i) => ({ ...l, variantId: items[i]!.variant.id, label: items[i]!.variant.label })) });
});

const saleBody = cartBody.extend({
  payments: z.array(z.object({ method: z.enum(['cash', 'card', 'other']), amountCents: cents, reference: z.string().max(80).nullable().optional() })).max(5),
  customerName: z.string().trim().max(80).optional(),
  clientRef: uuid.optional(),
});

salesRouter.post('/', sellers, async (req, res) => {
  const user = authUser(req);
  const body = parse(saleBody, req.body);
  assertStoreAccess(user, body.storeId);
  const result = await createSale(user.id, body);
  res.status(result.replayed ? 200 : 201).json({ sale: await getSale(result.id, user) });
});

salesRouter.get('/', async (req, res) => {
  const user = authUser(req);
  const q = parse(z.object({ storeId: uuid, q: z.string().trim().max(40).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
  assertStoreAccess(user, q.storeId);
  const where: SQL[] = [eq(sales.storeId, q.storeId)];
  if (q.q) where.push(ilike(sales.number, `%${q.q}%`));
  const rows = await db
    .select({
      id: sales.id,
      number: sales.number,
      createdAt: sales.createdAt,
      totalCents: sales.totalCents,
      customerName: sales.customerName,
      cashierName: users.name,
    })
    .from(sales)
    .innerJoin(users, eq(users.id, sales.cashierId))
    .where(and(...where))
    .orderBy(desc(sales.createdAt))
    .limit(q.limit);
  res.json({ sales: rows });
});

salesRouter.get('/:id', async (req, res) => {
  const id = parse(uuid, req.params.id);
  res.json({ sale: await getSale(id, authUser(req)) });
});

const returnBody = z.object({
  lines: z.array(z.object({ saleLineId: uuid, qty, restock: z.boolean().default(true) })).min(1).max(200),
  refundMethod: z.enum(['cash', 'card', 'other']),
  reason: z.string().trim().max(200).optional(),
  clientRef: uuid.optional(),
});

salesRouter.post('/:id/returns', sellers, async (req, res) => {
  const user = authUser(req);
  const id = parse(uuid, req.params.id);
  const body = parse(returnBody, req.body);
  const [sale] = await db.select({ storeId: sales.storeId }).from(sales).where(eq(sales.id, id));
  if (!sale) throw notFound('Sale');
  assertStoreAccess(user, sale.storeId);
  const result = await createReturn(user.id, id, body);
  res.status(result.replayed ? 200 : 201).json({ return: result, sale: await getSale(id, user) });
});
