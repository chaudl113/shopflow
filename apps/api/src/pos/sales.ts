import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { completeBooking, lockBookingForSale } from '../booking/booking.js';
import { findVariants } from '../catalog/catalog.js';
import { db, type Tx } from '../db/client.js';
import { payments, returnLines, saleLines, saleReturns, sales, stores, users } from '../db/schema.js';
import { applyMovements } from '../inventory/ledger.js';
import { formatNumber, nextNumber } from '../lib/counters.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { priceCart, refundShare, settlePayments, type Discount, type PaymentInput, type PaymentMethod } from '../lib/money.js';
import { requireOpenShift } from './shifts.js';

export interface SaleLineInput {
  variantId: string;
  qty: number;
  discount?: Discount;
  staffId?: string | null;
}

export interface CartInput {
  storeId: string;
  lines: SaleLineInput[];
  orderDiscount?: Discount;
}

export interface SaleInput extends CartInput {
  payments: PaymentInput[];
  customerName?: string;
  clientRef?: string;
  /** Checking out an appointment: the booking is marked completed and linked to this sale. */
  bookingId?: string;
}

/** Prices come from the catalog at the store, never from the client. */
export async function quoteCart(conn: Tx | typeof db, input: CartInput) {
  const [store] = await conn.select().from(stores).where(eq(stores.id, input.storeId));
  if (!store) throw notFound('Store');
  if (store.kind !== 'store') throw badRequest('NOT_A_STORE', 'Warehouses cannot sell');
  if (input.lines.length === 0) throw badRequest('EMPTY_CART', 'Add at least one item');

  const ids = [...new Set(input.lines.map((l) => l.variantId))];
  const found = await findVariants(conn, { storeId: store.id, variantIds: ids });
  const byId = new Map(found.map((v) => [v.id, v]));
  const items = input.lines.map((l) => {
    const v = byId.get(l.variantId);
    if (!v) throw badRequest('UNKNOWN_VARIANT', 'An item in the cart is no longer for sale');
    return { input: l, variant: v };
  });

  const staffIds = [...new Set(input.lines.map((l) => l.staffId).filter((x): x is string => !!x))];
  if (staffIds.length) {
    const rows = await conn.select({ id: users.id }).from(users).where(and(inArray(users.id, staffIds), eq(users.active, true)));
    if (rows.length !== staffIds.length) throw badRequest('UNKNOWN_STAFF', 'Unknown staff member on a service line');
  }

  const priced = priceCart(
    items.map((i) => ({ unitPriceCents: i.variant.priceCents, qty: i.input.qty, discount: i.input.discount })),
    input.orderDiscount,
    store.taxRateBps,
  );
  return { store, items, priced };
}

/**
 * Creates a sale atomically: price, take payment, decrement stock, allocate the receipt number.
 * Order of locks is fixed (shift share-lock -> stock advisory locks -> counter row) so concurrent
 * sales cannot deadlock, and the stock check is serialised per item rather than per store.
 */
export async function createSale(actorId: string, input: SaleInput, opts: { at?: Date; tx?: Tx } = {}) {
  const run = async (tx: Tx) => {
    if (input.clientRef) {
      const [existing] = await tx.select({ id: sales.id, number: sales.number, cashierId: sales.cashierId }).from(sales).where(eq(sales.clientRef, input.clientRef));
      if (existing) {
        if (existing.cashierId !== actorId) throw conflict('CLIENT_REF_REUSED', 'Duplicate request id');
        return { id: existing.id, number: existing.number, replayed: true };
      }
    }
    const shift = await requireOpenShift(tx, actorId, input.storeId);
    if (input.bookingId) await lockBookingForSale(tx, input.bookingId, input.storeId);
    const { store, items, priced } = await quoteCart(tx, input);
    const settled = settlePayments(priced.totalCents, input.payments);
    const saleId = randomUUID();

    await applyMovements(
      tx,
      items
        .filter((i) => i.variant.type === 'product')
        .map((i) => ({ storeId: store.id, variantId: i.variant.id, qty: -i.input.qty, kind: 'sale' as const, refType: 'sale', refId: saleId, userId: actorId, unitCostCents: i.variant.costCents, createdAt: opts.at })),
    );

    const number = formatNumber('S', store.code, await nextNumber(tx, store.id, 'sale'));
    const at = opts.at ? { createdAt: opts.at } : {};
    await tx.insert(sales).values({
      id: saleId,
      number,
      clientRef: input.clientRef ?? null,
      storeId: store.id,
      shiftId: shift.id,
      cashierId: actorId,
      customerName: input.customerName ?? '',
      subtotalCents: priced.subtotalCents,
      discountCents: priced.discountCents,
      taxCents: priced.taxCents,
      totalCents: priced.totalCents,
      changeCents: settled.changeCents,
      taxRateBps: store.taxRateBps,
      ...at,
    });
    await tx.insert(saleLines).values(
      items.map((i, idx) => {
        const p = priced.lines[idx]!;
        return {
          saleId,
          position: idx,
          variantId: i.variant.id,
          staffId: i.input.staffId ?? null,
          isService: i.variant.type === 'service',
          name: i.variant.label,
          sku: i.variant.sku,
          qty: p.qty,
          unitPriceCents: p.unitPriceCents,
          lineDiscountCents: p.lineDiscountCents,
          orderDiscountCents: p.orderDiscountCents,
          netCents: p.netCents,
          taxCents: p.taxCents,
          totalCents: p.totalCents,
          unitCostCents: i.variant.costCents,
        };
      }),
    );
    if (settled.payments.length) {
      await tx.insert(payments).values(settled.payments.map((p) => ({ ...p, shiftId: shift.id, saleId, ...at })));
    }
    if (input.bookingId) await completeBooking(tx, input.bookingId, saleId);
    return { id: saleId, number, replayed: false };
  };
  return opts.tx ? run(opts.tx) : db.transaction(run);
}

export interface ReturnInput {
  lines: { saleLineId: string; qty: number; restock: boolean }[];
  refundMethod: PaymentMethod;
  reason?: string;
  clientRef?: string;
}

export async function createReturn(actorId: string, saleId: string, input: ReturnInput, opts: { at?: Date } = {}) {
  return db.transaction(async (tx) => {
    if (input.clientRef) {
      const [existing] = await tx.select({ id: saleReturns.id, number: saleReturns.number }).from(saleReturns).where(eq(saleReturns.clientRef, input.clientRef));
      if (existing) return { ...existing, replayed: true };
    }
    // Serialise returns against the same sale so two refunds cannot both pass the "not more than sold" check.
    await tx.execute(sql`select id from sales where id = ${saleId} for update`);
    const [sale] = await tx.select().from(sales).where(eq(sales.id, saleId));
    if (!sale) throw notFound('Sale');
    const shift = await requireOpenShift(tx, actorId, sale.storeId);
    const [store] = await tx.select().from(stores).where(eq(stores.id, sale.storeId));

    const lines = await tx.select().from(saleLines).where(eq(saleLines.saleId, saleId));
    const returned = await returnedQtyByLine(tx, saleId);
    if (input.lines.length === 0) throw badRequest('EMPTY_RETURN', 'Select at least one item to return');
    const seen = new Set<string>();

    const computed = input.lines.map((r) => {
      if (seen.has(r.saleLineId)) throw badRequest('DUPLICATE_LINE', 'Each line can appear once');
      seen.add(r.saleLineId);
      const line = lines.find((l) => l.id === r.saleLineId);
      if (!line) throw badRequest('UNKNOWN_LINE', 'Line does not belong to this sale');
      const already = returned.get(line.id) ?? 0;
      if (r.qty > line.qty - already) throw conflict('RETURN_TOO_MANY', `Only ${line.qty - already} of ${line.name} can still be returned`);
      const netCents = refundShare(line.netCents, line.qty, already, r.qty);
      const taxCents = refundShare(line.taxCents, line.qty, already, r.qty);
      return { line, qty: r.qty, restock: r.restock && !line.isService, netCents, taxCents, totalCents: netCents + taxCents };
    });

    const returnId = randomUUID();
    await applyMovements(
      tx,
      computed
        .filter((c) => c.restock)
        .map((c) => ({ storeId: sale.storeId, variantId: c.line.variantId, qty: c.qty, kind: 'return' as const, refType: 'return', refId: returnId, userId: actorId, unitCostCents: c.line.unitCostCents, createdAt: opts.at })),
    );

    const number = formatNumber('R', store!.code, await nextNumber(tx, store!.id, 'return'));
    const total = computed.reduce((s, c) => s + c.totalCents, 0);
    const at = opts.at ? { createdAt: opts.at } : {};
    await tx.insert(saleReturns).values({
      id: returnId,
      number,
      clientRef: input.clientRef ?? null,
      saleId,
      storeId: sale.storeId,
      shiftId: shift.id,
      userId: actorId,
      reason: input.reason ?? '',
      netCents: computed.reduce((s, c) => s + c.netCents, 0),
      taxCents: computed.reduce((s, c) => s + c.taxCents, 0),
      totalCents: total,
      ...at,
    });
    await tx.insert(returnLines).values(
      computed.map((c) => ({ returnId, saleLineId: c.line.id, qty: c.qty, restock: c.restock, netCents: c.netCents, taxCents: c.taxCents, totalCents: c.totalCents })),
    );
    if (total > 0) {
      await tx.insert(payments).values({ shiftId: shift.id, returnId, saleId, method: input.refundMethod, amountCents: -total, tenderedCents: -total, ...at });
    }
    return { id: returnId, number, totalCents: total, replayed: false };
  });
}

async function returnedQtyByLine(conn: Tx | typeof db, saleId: string) {
  const rows = await conn.execute(sql`
    select rl.sale_line_id as id, sum(rl.qty)::int as qty
      from return_lines rl join sale_lines sl on sl.id = rl.sale_line_id
     where sl.sale_id = ${saleId} group by rl.sale_line_id`);
  return new Map((rows.rows as { id: string; qty: number }[]).map((r) => [r.id, r.qty]));
}

export async function getSale(saleId: string, viewer: { role: string; storeIds: string[] }) {
  const [row] = await db
    .select({ sale: sales, store: stores, cashierName: users.name })
    .from(sales)
    .innerJoin(stores, eq(stores.id, sales.storeId))
    .innerJoin(users, eq(users.id, sales.cashierId))
    .where(eq(sales.id, saleId));
  if (!row) throw notFound('Sale');
  if (viewer.role !== 'owner' && !viewer.storeIds.includes(row.sale.storeId)) throw forbidden();

  const lines = await db.execute(sql`
    select sl.*, u.name as "staffName" from sale_lines sl left join users u on u.id = sl.staff_id
     where sl.sale_id = ${saleId} order by sl.position`);
  const returned = await returnedQtyByLine(db, saleId);
  const pays = await db.select().from(payments).where(eq(payments.saleId, saleId)).orderBy(payments.createdAt);
  const rets = await db.select().from(saleReturns).where(eq(saleReturns.saleId, saleId)).orderBy(saleReturns.createdAt);

  return {
    ...row.sale,
    cashierName: row.cashierName,
    store: { id: row.store.id, name: row.store.name, code: row.store.code, address: row.store.address, phone: row.store.phone, timezone: row.store.timezone },
    lines: (lines.rows as Record<string, unknown>[]).map((l) => ({
      id: l.id,
      variantId: l.variant_id,
      name: l.name,
      sku: l.sku,
      qty: l.qty,
      isService: l.is_service,
      staffId: l.staff_id,
      staffName: l.staffName,
      unitPriceCents: l.unit_price_cents,
      lineDiscountCents: l.line_discount_cents,
      orderDiscountCents: l.order_discount_cents,
      netCents: l.net_cents,
      taxCents: l.tax_cents,
      totalCents: l.total_cents,
      returnedQty: returned.get(l.id as string) ?? 0,
    })),
    payments: pays,
    returns: rets,
  };
}
