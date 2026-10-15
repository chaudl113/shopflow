import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db/client.js';
import { api, makeProduct, makeStore, makeUser, resetDb } from './helpers.js';

afterAll(() => pool.end());

describe('cash shifts', () => {
  let store: Awaited<ReturnType<typeof makeStore>>;
  let manager: Awaited<ReturnType<typeof makeUser>>;
  let cashier: Awaited<ReturnType<typeof makeUser>>;

  beforeEach(async () => {
    await resetDb();
    store = await makeStore({ taxRateBps: 0 });
    manager = await makeUser('manager', [store.id]);
    cashier = await makeUser('cashier', [store.id]);
  });

  it('expected cash = float + cash sales - cash refunds + pay-ins - pay-outs; difference = counted - expected', async () => {
    const { variant } = await makeProduct({ priceCents: 2500 });
    await api(manager.token).post('/api/inventory/receive', { storeId: store.id, lines: [{ variantId: variant.id, qty: 10 }] }).expect(201);
    const shiftId = (await api(cashier.token).post('/api/shifts/open', { storeId: store.id, openingFloatCents: 10000 }).expect(201)).body.summary.shift.id;

    // Cash sale 25.00 paid with 40.00 -> drawer +25.00 (change does not stay in the drawer)
    const cashSale = (await api(cashier.token).post('/api/sales', { storeId: store.id, lines: [{ variantId: variant.id, qty: 1 }], payments: [{ method: 'cash', amountCents: 4000 }] }).expect(201)).body.sale;
    // Split: 50.00 = 30.00 card + 20.00 cash
    await api(cashier.token).post('/api/sales', { storeId: store.id, lines: [{ variantId: variant.id, qty: 2 }], payments: [{ method: 'card', amountCents: 3000 }, { method: 'cash', amountCents: 2000 }] }).expect(201);
    // Cash refund 25.00
    await api(cashier.token).post(`/api/sales/${cashSale.id}/returns`, { lines: [{ saleLineId: cashSale.lines[0].id, qty: 1 }], refundMethod: 'cash' }).expect(201);
    await api(cashier.token).post(`/api/shifts/${shiftId}/cash`, { kind: 'pay_out', amountCents: 1200, reason: 'Milk for the coffee machine' }).expect(201);
    await api(cashier.token).post(`/api/shifts/${shiftId}/cash`, { kind: 'pay_in', amountCents: 500, reason: 'Change top-up' }).expect(201);

    const live = (await api(cashier.token).get(`/api/shifts/current?storeId=${store.id}`).expect(200)).body.summary;
    // 100.00 + 25.00 + 20.00 - 25.00 - 12.00 + 5.00 = 113.00
    expect(live.expectedCashCents).toBe(11300);
    expect(live.byMethod.card.inCents).toBe(3000);
    expect(live).toMatchObject({ salesCount: 2, returnsCount: 1, salesTotalCents: 7500, refundsTotalCents: 2500 });

    const closed = (await api(cashier.token).post(`/api/shifts/${shiftId}/close`, { countedCashCents: 11050, note: 'Short, recounted twice' }).expect(200)).body.summary;
    expect(closed.shift).toMatchObject({ status: 'closed', expectedCashCents: 11300, countedCashCents: 11050, differenceCents: -250 });
  });

  it('a user can have only one open shift, and a closed shift cannot take sales', async () => {
    const shiftId = (await api(cashier.token).post('/api/shifts/open', { storeId: store.id, openingFloatCents: 0 }).expect(201)).body.summary.shift.id;
    const again = await api(cashier.token).post('/api/shifts/open', { storeId: store.id, openingFloatCents: 0 }).expect(409);
    expect(again.body.error.code).toBe('SHIFT_ALREADY_OPEN');

    await api(cashier.token).post(`/api/shifts/${shiftId}/close`, { countedCashCents: 0 }).expect(200);
    const twice = await api(cashier.token).post(`/api/shifts/${shiftId}/close`, { countedCashCents: 0 }).expect(409);
    expect(twice.body.error.code).toBe('SHIFT_CLOSED');

    const { variant } = await makeProduct({ type: 'service', durationMin: 30 });
    const res = await api(cashier.token).post('/api/sales', { storeId: store.id, lines: [{ variantId: variant.id, qty: 1 }], payments: [{ method: 'card', amountCents: 1000 }] }).expect(409);
    expect(res.body.error.code).toBe('NO_OPEN_SHIFT');
  });

  it('a cashier cannot close a colleague’s drawer, a manager can', async () => {
    const other = await makeUser('cashier', [store.id]);
    const shiftId = (await api(other.token).post('/api/shifts/open', { storeId: store.id, openingFloatCents: 5000 }).expect(201)).body.summary.shift.id;
    await api(cashier.token).post(`/api/shifts/${shiftId}/close`, { countedCashCents: 5000 }).expect(403);
    const res = await api(manager.token).post(`/api/shifts/${shiftId}/close`, { countedCashCents: 5000 }).expect(200);
    expect(res.body.summary.shift.differenceCents).toBe(0);
  });
});
