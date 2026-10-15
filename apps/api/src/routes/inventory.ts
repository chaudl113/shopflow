import { sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { assertStoreAccess, authUser, requireRole } from '../auth.js';
import { findVariants } from '../catalog/catalog.js';
import { db } from '../db/client.js';
import { applyMovements, lockStock, onHand } from '../inventory/ledger.js';
import { parse } from '../lib/errors.js';
import { cents, qty, uuid } from '../lib/zod.js';

export const inventoryRouter = Router();

inventoryRouter.get('/levels', async (req, res) => {
  const q = parse(z.object({ storeId: uuid, q: z.string().trim().max(80).optional() }), req.query);
  assertStoreAccess(authUser(req), q.storeId);
  const rows = await findVariants(db, { storeId: q.storeId, type: 'product', q: q.q });
  // Stock already shipped to / from this location but not yet received.
  const transit = await db.execute(sql`
    select tl.variant_id as "variantId",
           coalesce(sum(tl.qty_sent) filter (where t.to_store_id = ${q.storeId}), 0)::int as inbound,
           coalesce(sum(tl.qty_sent) filter (where t.from_store_id = ${q.storeId}), 0)::int as outbound
      from transfer_lines tl join transfers t on t.id = tl.transfer_id
     where t.status = 'in_transit' and (t.to_store_id = ${q.storeId} or t.from_store_id = ${q.storeId})
     group by tl.variant_id`);
  const transitBy = new Map((transit.rows as { variantId: string; inbound: number; outbound: number }[]).map((r) => [r.variantId, r]));
  res.json({
    levels: rows.map((r) => ({
      variantId: r.id,
      label: r.label,
      sku: r.sku,
      category: r.category,
      onHand: r.onHand ?? 0,
      inbound: transitBy.get(r.id)?.inbound ?? 0,
      outbound: transitBy.get(r.id)?.outbound ?? 0,
      reorderLevel: r.reorderLevel,
      low: (r.onHand ?? 0) <= r.reorderLevel,
      costCents: r.costCents,
      priceCents: r.priceCents,
    })),
  });
});

/** Ledger rows for one item at one store, newest first, with the running balance after each row. */
inventoryRouter.get('/movements', async (req, res) => {
  const q = parse(z.object({ storeId: uuid, variantId: uuid, limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
  assertStoreAccess(authUser(req), q.storeId);
  const rows = await db.execute(sql`
    select * from (
      select m.id, m.kind, m.qty, m.note, m.ref_type as "refType", m.ref_id as "refId", m.created_at as "createdAt",
             m.unit_cost_cents as "unitCostCents", u.name as "userName",
             sum(m.qty) over (order by m.id) as balance
        from stock_movements m left join users u on u.id = m.user_id
       where m.store_id = ${q.storeId} and m.variant_id = ${q.variantId}
    ) t order by id desc limit ${q.limit}`);
  res.json({ movements: rows.rows });
});

const receiveBody = z.object({
  storeId: uuid,
  note: z.string().max(200).default(''),
  lines: z.array(z.object({ variantId: uuid, qty, unitCostCents: cents.optional() })).min(1).max(200),
});

inventoryRouter.post('/receive', requireRole('owner', 'manager'), async (req, res) => {
  const user = authUser(req);
  const body = parse(receiveBody, req.body);
  assertStoreAccess(user, body.storeId);
  await db.transaction((tx) =>
    applyMovements(
      tx,
      body.lines.map((l) => ({ storeId: body.storeId, variantId: l.variantId, qty: l.qty, kind: 'receive', unitCostCents: l.unitCostCents, note: body.note, userId: user.id })),
    ),
  );
  res.status(201).json({ ok: true });
});

const stocktakeBody = z.object({
  storeId: uuid,
  note: z.string().max(200).default('Stock count'),
  lines: z.array(z.object({ variantId: uuid, countedQty: z.number().int().min(0).max(1_000_000) })).min(1).max(500),
});

/**
 * Stock count: the adjustment is computed from the ledger *under the lock*, so a sale that
 * lands between "count shown on screen" and "submit" is not silently erased.
 */
inventoryRouter.post('/stocktake', requireRole('owner', 'manager'), async (req, res) => {
  const user = authUser(req);
  const body = parse(stocktakeBody, req.body);
  assertStoreAccess(user, body.storeId);
  const adjustments = await db.transaction(async (tx) => {
    const keys = body.lines.map((l) => ({ storeId: body.storeId, variantId: l.variantId }));
    await lockStock(tx, keys);
    const current = await onHand(tx, keys);
    const result = body.lines.map((l) => {
      const before = current.get(`${body.storeId}:${l.variantId}`) ?? 0;
      return { variantId: l.variantId, before, counted: l.countedQty, delta: l.countedQty - before };
    });
    await applyMovements(
      tx,
      result.filter((r) => r.delta !== 0).map((r) => ({ storeId: body.storeId, variantId: r.variantId, qty: r.delta, kind: 'adjust', note: body.note, userId: user.id })),
    );
    return result;
  });
  res.status(201).json({ adjustments });
});
