import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DbOrTx, Tx } from '../db/client.js';
import { products, stockMovements, stores, variants } from '../db/schema.js';
import { badRequest, conflict } from '../lib/errors.js';

export type MovementKind = (typeof stockMovements.$inferInsert)['kind'];

export interface MovementInput {
  storeId: string;
  variantId: string;
  qty: number;
  kind: MovementKind;
  unitCostCents?: number | null;
  refType?: string;
  refId?: string;
  note?: string;
  userId?: string;
}

const keyOf = (storeId: string, variantId: string) => `${storeId}:${variantId}`;

/**
 * Serialises every writer touching the same (store, variant) until the surrounding
 * transaction ends. Keys are locked in sorted order so two transactions that touch
 * overlapping items can never deadlock each other.
 */
export async function lockStock(tx: Tx, keys: { storeId: string; variantId: string }[]) {
  const sorted = [...new Set(keys.map((k) => keyOf(k.storeId, k.variantId)))].sort();
  for (const k of sorted) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'stock:' + k}, 0))`);
  }
}

/** On-hand = SUM of ledger rows. Returns a map keyed by `storeId:variantId` (missing keys = 0). */
export async function onHand(tx: DbOrTx, keys: { storeId: string; variantId: string }[]) {
  const result = new Map<string, number>();
  if (keys.length === 0) return result;
  const storeIds = [...new Set(keys.map((k) => k.storeId))];
  const variantIds = [...new Set(keys.map((k) => k.variantId))];
  const rows = await tx
    .select({
      storeId: stockMovements.storeId,
      variantId: stockMovements.variantId,
      qty: sql<number>`coalesce(sum(${stockMovements.qty}), 0)::int`,
    })
    .from(stockMovements)
    .where(and(inArray(stockMovements.storeId, storeIds), inArray(stockMovements.variantId, variantIds)))
    .groupBy(stockMovements.storeId, stockMovements.variantId);
  for (const r of rows) result.set(keyOf(r.storeId, r.variantId), r.qty);
  return result;
}

/**
 * The only way stock changes. Locks the affected (store, variant) pairs, checks that the
 * net change does not take any of them below zero (unless the store allows negative
 * stock), then appends the movements. Must run inside a transaction so the lock, the
 * check and the insert are atomic with the business document that caused them.
 */
export async function applyMovements(tx: Tx, moves: MovementInput[]) {
  if (moves.length === 0) return;
  if (moves.some((m) => !Number.isInteger(m.qty) || m.qty === 0)) throw badRequest('BAD_QTY', 'Quantities must be non-zero integers');

  const variantIds = [...new Set(moves.map((m) => m.variantId))];
  const variantRows = await tx
    .select({ id: variants.id, sku: variants.sku, name: variants.name, productName: products.name, type: products.type })
    .from(variants)
    .innerJoin(products, eq(products.id, variants.productId))
    .where(inArray(variants.id, variantIds));
  const variantById = new Map(variantRows.map((v) => [v.id, v]));
  for (const id of variantIds) {
    const v = variantById.get(id);
    if (!v) throw badRequest('UNKNOWN_VARIANT', `Unknown variant ${id}`);
    if (v.type === 'service') throw badRequest('NOT_STOCKED', `${v.productName} is a service and has no stock`);
  }

  await lockStock(tx, moves);

  const net = new Map<string, { storeId: string; variantId: string; delta: number }>();
  for (const m of moves) {
    const k = keyOf(m.storeId, m.variantId);
    const cur = net.get(k) ?? { storeId: m.storeId, variantId: m.variantId, delta: 0 };
    cur.delta += m.qty;
    net.set(k, cur);
  }

  const decreasing = [...net.values()].filter((n) => n.delta < 0);
  if (decreasing.length > 0) {
    const storeIds = [...new Set(decreasing.map((d) => d.storeId))];
    const storeRows = await tx
      .select({ id: stores.id, allowNegativeStock: stores.allowNegativeStock })
      .from(stores)
      .where(inArray(stores.id, storeIds));
    const allowNegative = new Map(storeRows.map((s) => [s.id, s.allowNegativeStock]));
    const balances = await onHand(tx, decreasing);
    const shortages = decreasing
      .filter((d) => !allowNegative.get(d.storeId))
      .map((d) => ({ ...d, onHand: balances.get(keyOf(d.storeId, d.variantId)) ?? 0 }))
      .filter((d) => d.onHand + d.delta < 0)
      .map((d) => {
        const v = variantById.get(d.variantId)!;
        return { storeId: d.storeId, variantId: d.variantId, sku: v.sku, name: `${v.productName} ${v.name}`.trim(), onHand: d.onHand, requested: -d.delta };
      });
    if (shortages.length > 0) {
      const first = shortages[0]!;
      throw conflict('INSUFFICIENT_STOCK', `Not enough stock for ${first.name} (on hand ${first.onHand}, requested ${first.requested})`, shortages);
    }
  }

  await tx.insert(stockMovements).values(
    moves.map((m) => ({
      storeId: m.storeId,
      variantId: m.variantId,
      qty: m.qty,
      kind: m.kind,
      unitCostCents: m.unitCostCents ?? null,
      refType: m.refType ?? null,
      refId: m.refId ?? null,
      note: m.note ?? '',
      userId: m.userId ?? null,
    })),
  );
}
