import { randomUUID } from 'node:crypto';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { products, stores, transferLines, transfers, variants } from '../db/schema.js';
import { applyMovements } from '../inventory/ledger.js';
import { formatNumber, nextNumber } from '../lib/counters.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';

export interface SendInput {
  fromStoreId: string;
  toStoreId: string;
  lines: { variantId: string; qty: number }[];
  note?: string;
}

export async function sendTransfer(actorId: string, input: SendInput, opts: { at?: Date } = {}) {
  if (input.fromStoreId === input.toStoreId) throw badRequest('SAME_LOCATION', 'Source and destination must differ');
  const merged = new Map<string, number>();
  for (const l of input.lines) merged.set(l.variantId, (merged.get(l.variantId) ?? 0) + l.qty);

  return db.transaction(async (tx) => {
    const [from] = await tx.select().from(stores).where(eq(stores.id, input.fromStoreId));
    const [to] = await tx.select().from(stores).where(eq(stores.id, input.toStoreId));
    if (!from || !to) throw notFound('Store');
    const id = randomUUID();
    await applyMovements(
      tx,
      [...merged].map(([variantId, qty]) => ({ storeId: from.id, variantId, qty: -qty, kind: 'transfer_out' as const, refType: 'transfer', refId: id, userId: actorId, note: `To ${to.name}`, createdAt: opts.at })),
    );
    const number = formatNumber('T', from.code, await nextNumber(tx, from.id, 'transfer'));
    await tx.insert(transfers).values({ id, number, fromStoreId: from.id, toStoreId: to.id, note: input.note ?? '', sentBy: actorId, ...(opts.at ? { sentAt: opts.at } : {}) });
    await tx.insert(transferLines).values([...merged].map(([variantId, qtySent]) => ({ transferId: id, variantId, qtySent })));
    return id;
  });
}

/** Row lock on the transfer makes receive/cancel mutually exclusive and one-shot. */
async function lockInTransit(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], id: string) {
  await tx.execute(sql`select id from transfers where id = ${id} for update`);
  const [t] = await tx.select().from(transfers).where(eq(transfers.id, id));
  if (!t) throw notFound('Transfer');
  if (t.status !== 'in_transit') throw conflict('TRANSFER_NOT_IN_TRANSIT', `Transfer ${t.number} is already ${t.status.replace('_', ' ')}`);
  return t;
}

export async function receiveTransfer(actorId: string, id: string, input: { lines?: { lineId: string; qtyReceived: number }[]; note?: string }, opts: { at?: Date } = {}) {
  return db.transaction(async (tx) => {
    const t = await lockInTransit(tx, id);
    const lines = await tx.select().from(transferLines).where(eq(transferLines.transferId, id));
    const override = new Map((input.lines ?? []).map((l) => [l.lineId, l.qtyReceived]));
    for (const lineId of override.keys()) if (!lines.some((l) => l.id === lineId)) throw badRequest('UNKNOWN_LINE', 'Line does not belong to this transfer');

    const received = lines.map((l) => {
      const q = override.get(l.id) ?? l.qtySent;
      if (q < 0 || q > l.qtySent) throw badRequest('RECEIVE_QTY', `Received quantity must be between 0 and ${l.qtySent}`);
      return { line: l, qty: q };
    });
    await applyMovements(
      tx,
      received.filter((r) => r.qty > 0).map((r) => ({ storeId: t.toStoreId, variantId: r.line.variantId, qty: r.qty, kind: 'transfer_in' as const, refType: 'transfer', refId: id, userId: actorId, note: t.number, createdAt: opts.at })),
    );
    for (const r of received) await tx.update(transferLines).set({ qtyReceived: r.qty }).where(eq(transferLines.id, r.line.id));
    await tx.update(transfers).set({ status: 'received', receivedBy: actorId, receivedAt: opts.at ?? new Date(), receiveNote: input.note ?? '' }).where(eq(transfers.id, id));
  });
}

export async function cancelTransfer(actorId: string, id: string) {
  return db.transaction(async (tx) => {
    const t = await lockInTransit(tx, id);
    const lines = await tx.select().from(transferLines).where(eq(transferLines.transferId, id));
    await applyMovements(
      tx,
      lines.map((l) => ({ storeId: t.fromStoreId, variantId: l.variantId, qty: l.qtySent, kind: 'transfer_cancel' as const, refType: 'transfer', refId: id, userId: actorId, note: `${t.number} cancelled` })),
    );
    await tx.update(transfers).set({ status: 'cancelled', cancelledBy: actorId, cancelledAt: new Date() }).where(eq(transfers.id, id));
  });
}

export async function getTransfers(ids: string[]) {
  if (!ids.length) return [];
  const rows = await db.execute(sql`
    select t.*, f.name as "fromName", d.name as "toName", us.name as "sentByName", ur.name as "receivedByName"
      from transfers t
      join stores f on f.id = t.from_store_id
      join stores d on d.id = t.to_store_id
      join users us on us.id = t.sent_by
      left join users ur on ur.id = t.received_by
     where t.id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
     order by t.sent_at desc`);
  const lines = await db
    .select({ id: transferLines.id, transferId: transferLines.transferId, variantId: transferLines.variantId, qtySent: transferLines.qtySent, qtyReceived: transferLines.qtyReceived, sku: variants.sku, variantName: variants.name, productName: products.name })
    .from(transferLines)
    .innerJoin(variants, eq(variants.id, transferLines.variantId))
    .innerJoin(products, eq(products.id, variants.productId))
    .where(inArray(transferLines.transferId, ids))
    .orderBy(asc(products.name));
  return (rows.rows as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    number: r.number,
    status: r.status,
    fromStoreId: r.from_store_id as string,
    toStoreId: r.to_store_id as string,
    fromName: r.fromName,
    toName: r.toName,
    note: r.note,
    receiveNote: r.receive_note,
    sentAt: r.sent_at,
    sentByName: r.sentByName,
    receivedAt: r.received_at,
    receivedByName: r.receivedByName,
    cancelledAt: r.cancelled_at,
    lines: lines
      .filter((l) => l.transferId === r.id)
      .map((l) => ({ id: l.id, variantId: l.variantId, sku: l.sku, label: l.variantName === 'Default' ? l.productName : `${l.productName} – ${l.variantName}`, qtySent: l.qtySent, qtyReceived: l.qtyReceived })),
  }));
}

