import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/client.js';
import { stores } from '../src/db/schema.js';
import { api, makeProduct, makeStore, makeUser, resetDb, stockOf } from './helpers.js';

afterAll(() => pool.end());

type Store = Awaited<ReturnType<typeof makeStore>>;
type User = Awaited<ReturnType<typeof makeUser>>;

async function receive(token: string, storeId: string, variantId: string, qty: number) {
  await api(token).post('/api/inventory/receive', { storeId, lines: [{ variantId, qty }] }).expect(201);
}
async function openShift(user: User, storeId: string, floatCents = 10000) {
  const res = await api(user.token).post('/api/shifts/open', { storeId, openingFloatCents: floatCents }).expect(201);
  return res.body.summary.shift.id as string;
}
const sell = (user: User, storeId: string, lines: object[], payments: object[], extra: object = {}) =>
  api(user.token).post('/api/sales', { storeId, lines, payments, ...extra });

describe('POS sales', () => {
  let store: Store;
  let manager: User;
  let cashier: User;

  beforeEach(async () => {
    await resetDb();
    store = await makeStore({ code: 'DT', taxRateBps: 888 });
    manager = await makeUser('manager', [store.id]);
    cashier = await makeUser('cashier', [store.id]);
  });

  it('books a sale: server-side prices and tax, payment with change, stock decremented, numbered receipt', async () => {
    const { variant } = await makeProduct({ priceCents: 1999 });
    const service = await makeProduct({ type: 'service', durationMin: 30, priceCents: 3500 });
    const stylist = await makeUser('staff', [store.id], { bookable: true });
    await receive(manager.token, store.id, variant.id, 5);
    await openShift(cashier, store.id);

    const res = await sell(
      cashier,
      store.id,
      [
        { variantId: variant.id, qty: 2, discount: { type: 'percent', bps: 1000 } },
        { variantId: service.variant.id, qty: 1, staffId: stylist.id },
      ],
      [{ method: 'cash', amountCents: 10000 }],
    ).expect(201);

    const sale = res.body.sale;
    // 2 x 19.99 = 39.98, -10 % = 35.98 (4.00 off), + 35.00 = 70.98, tax 8.88 % = 6.30
    expect(sale).toMatchObject({ number: 'S-DT-000001', subtotalCents: 7498, discountCents: 400, taxCents: 630, totalCents: 7728, changeCents: 2272 });
    expect(sale.payments).toEqual([expect.objectContaining({ method: 'cash', amountCents: 7728, tenderedCents: 10000, changeCents: 2272 })]);
    expect(sale.lines[1]).toMatchObject({ isService: true, staffName: stylist.name });
    expect(await stockOf(manager.token, store.id, variant.id)).toBe(3);

    const second = await sell(cashier, store.id, [{ variantId: variant.id, qty: 1 }], [{ method: 'card', amountCents: 2177 }]).expect(201);
    expect(second.body.sale.number).toBe('S-DT-000002');
  });

  it('ignores client-sent prices (there is no price field to trust)', async () => {
    const { variant } = await makeProduct({ priceCents: 5000 });
    await receive(manager.token, store.id, variant.id, 1);
    await openShift(cashier, store.id);
    const res = await sell(cashier, store.id, [{ variantId: variant.id, qty: 1, unitPriceCents: 1 }], [{ method: 'card', amountCents: 5444 }]).expect(201);
    expect(res.body.sale.totalCents).toBe(5444);
  });

  it('refuses to sell more than on hand and writes nothing', async () => {
    const { variant } = await makeProduct({ priceCents: 1000 });
    await receive(manager.token, store.id, variant.id, 1);
    await openShift(cashier, store.id);
    const res = await sell(cashier, store.id, [{ variantId: variant.id, qty: 2 }], [{ method: 'cash', amountCents: 5000 }]).expect(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.error.details[0]).toMatchObject({ onHand: 1, requested: 2 });
    expect(await stockOf(manager.token, store.id, variant.id)).toBe(1);
    const list = await api(cashier.token).get(`/api/sales?storeId=${store.id}`).expect(200);
    expect(list.body.sales).toHaveLength(0);

    // The failed attempt did not burn a receipt number.
    const ok = await sell(cashier, store.id, [{ variantId: variant.id, qty: 1 }], [{ method: 'cash', amountCents: 2000 }]).expect(201);
    expect(ok.body.sale.number).toBe('S-DT-000001');
  });

  it('lets a store opt in to negative stock', async () => {
    await db.update(stores).set({ allowNegativeStock: true }).where(eq(stores.id, store.id));
    const { variant } = await makeProduct({ priceCents: 1000 });
    await openShift(cashier, store.id);
    await sell(cashier, store.id, [{ variantId: variant.id, qty: 2 }], [{ method: 'card', amountCents: 2178 }]).expect(201);
    expect(await stockOf(manager.token, store.id, variant.id)).toBe(-2);
  });

  it('two cashiers racing for the last unit: exactly one sale succeeds', async () => {
    const cashier2 = await makeUser('cashier', [store.id]);
    await openShift(cashier, store.id);
    await openShift(cashier2, store.id);
    for (let round = 0; round < 10; round++) {
      const { variant } = await makeProduct({ priceCents: 1000 });
      await receive(manager.token, store.id, variant.id, 1);
      const line = [{ variantId: variant.id, qty: 1 }];
      const pay = [{ method: 'cash', amountCents: 1089 }];
      const results = await Promise.all([sell(cashier, store.id, line, pay), sell(cashier2, store.id, line, pay)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await stockOf(manager.token, store.id, variant.id)).toBe(0);
    }
  });

  it('is idempotent per clientRef (double-click on Charge books one sale)', async () => {
    const { variant } = await makeProduct({ priceCents: 1000 });
    await receive(manager.token, store.id, variant.id, 5);
    await openShift(cashier, store.id);
    const clientRef = randomUUID();
    const a = await sell(cashier, store.id, [{ variantId: variant.id, qty: 1 }], [{ method: 'card', amountCents: 1089 }], { clientRef }).expect(201);
    const b = await sell(cashier, store.id, [{ variantId: variant.id, qty: 1 }], [{ method: 'card', amountCents: 1089 }], { clientRef }).expect(200);
    expect(b.body.sale.id).toBe(a.body.sale.id);
    expect(await stockOf(manager.token, store.id, variant.id)).toBe(4);
  });

  it('requires an open shift and full payment', async () => {
    const { variant } = await makeProduct({ priceCents: 1000 });
    await receive(manager.token, store.id, variant.id, 5);
    const noShift = await sell(cashier, store.id, [{ variantId: variant.id, qty: 1 }], [{ method: 'cash', amountCents: 1089 }]).expect(409);
    expect(noShift.body.error.code).toBe('NO_OPEN_SHIFT');

    await openShift(cashier, store.id);
    const short = await sell(cashier, store.id, [{ variantId: variant.id, qty: 1 }], [{ method: 'card', amountCents: 1000 }]).expect(400);
    expect(short.body.error.code).toBe('UNDERPAID');
    const cardChange = await sell(cashier, store.id, [{ variantId: variant.id, qty: 1 }], [{ method: 'card', amountCents: 2000 }]).expect(400);
    expect(cardChange.body.error.code).toBe('NO_CHANGE_ON_CARD');
    expect(await stockOf(manager.token, store.id, variant.id)).toBe(5);
  });

  it('staff without a cashier role cannot sell', async () => {
    const staff = await makeUser('staff', [store.id]);
    const { variant } = await makeProduct();
    await sell(staff, store.id, [{ variantId: variant.id, qty: 1 }], []).expect(403);
  });
});

describe('returns', () => {
  let store: Store;
  let manager: User;
  let cashier: User;

  beforeEach(async () => {
    await resetDb();
    store = await makeStore({ code: 'DT', taxRateBps: 0 });
    manager = await makeUser('manager', [store.id]);
    cashier = await makeUser('cashier', [store.id]);
    await openShift(cashier, store.id);
  });

  it('partial returns restock and refund exactly the amount paid across all returns', async () => {
    const { variant } = await makeProduct({ priceCents: 1000 });
    await receive(manager.token, store.id, variant.id, 3);
    // 3 x 10.00 with $0.01 order discount -> line total 29.99, not divisible by 3.
    const sale = (
      await sell(cashier, store.id, [{ variantId: variant.id, qty: 3 }], [{ method: 'cash', amountCents: 2999 }], { orderDiscount: { type: 'amount', cents: 1 } }).expect(201)
    ).body.sale;
    const lineId = sale.lines[0].id;
    expect(await stockOf(manager.token, store.id, variant.id)).toBe(0);

    const refunds: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await api(cashier.token).post(`/api/sales/${sale.id}/returns`, { lines: [{ saleLineId: lineId, qty: 1, restock: true }], refundMethod: 'cash' }).expect(201);
      refunds.push(r.body.return.totalCents);
    }
    expect(refunds.reduce((a, b) => a + b, 0)).toBe(2999);
    expect(await stockOf(manager.token, store.id, variant.id)).toBe(3);

    const more = await api(cashier.token).post(`/api/sales/${sale.id}/returns`, { lines: [{ saleLineId: lineId, qty: 1, restock: true }], refundMethod: 'cash' }).expect(409);
    expect(more.body.error.code).toBe('RETURN_TOO_MANY');
  });

  it('damaged returns are refunded but not put back on the shelf', async () => {
    const { variant } = await makeProduct({ priceCents: 1000 });
    await receive(manager.token, store.id, variant.id, 2);
    const sale = (await sell(cashier, store.id, [{ variantId: variant.id, qty: 2 }], [{ method: 'card', amountCents: 2000 }]).expect(201)).body.sale;
    await api(cashier.token).post(`/api/sales/${sale.id}/returns`, { lines: [{ saleLineId: sale.lines[0].id, qty: 1, restock: false }], refundMethod: 'card', reason: 'Broken seal' }).expect(201);
    expect(await stockOf(manager.token, store.id, variant.id)).toBe(0);
  });

  it('concurrent returns of the same line cannot exceed the quantity sold', async () => {
    const { variant } = await makeProduct({ priceCents: 1000 });
    await receive(manager.token, store.id, variant.id, 1);
    const sale = (await sell(cashier, store.id, [{ variantId: variant.id, qty: 1 }], [{ method: 'cash', amountCents: 1000 }]).expect(201)).body.sale;
    const body = { lines: [{ saleLineId: sale.lines[0].id, qty: 1, restock: true }], refundMethod: 'cash' };
    const results = await Promise.all([api(cashier.token).post(`/api/sales/${sale.id}/returns`, body), api(cashier.token).post(`/api/sales/${sale.id}/returns`, body)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await stockOf(manager.token, store.id, variant.id)).toBe(1);
  });
});
