import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/client.js';
import { saleLines } from '../src/db/schema.js';
import { createReturn, createSale } from '../src/pos/sales.js';
import { openShift } from '../src/pos/shifts.js';
import { api, makeProduct, makeStore, makeUser, resetDb } from './helpers.js';

afterAll(() => pool.end());

type User = Awaited<ReturnType<typeof makeUser>>;
let owner: User;
let cashier: User;
let stylist: User;
let dt: Awaited<ReturnType<typeof makeStore>>;
let up: Awaited<ReturnType<typeof makeStore>>;
let shampoo: Awaited<ReturnType<typeof makeProduct>>;
let cut: Awaited<ReturnType<typeof makeProduct>>;

const card = (amountCents: number) => [{ method: 'card' as const, amountCents }];

beforeEach(async () => {
  await resetDb();
  // No tax keeps the arithmetic in the assertions obvious; tax handling is covered in money/pos tests.
  dt = await makeStore({ code: 'DT', timezone: 'America/New_York' });
  up = await makeStore({ code: 'UP', timezone: 'America/New_York' });
  owner = await makeUser('owner');
  cashier = await makeUser('cashier', [dt.id, up.id], { name: 'Chloe' });
  stylist = await makeUser('staff', [dt.id], { name: 'Mia', bookable: true });
  shampoo = await makeProduct({ name: 'Shampoo', priceCents: 2000 });
  cut = await makeProduct({ name: 'Haircut', type: 'service', durationMin: 60, priceCents: 6000 });
  // Sales record the variant's standard cost at the time of sale.
  await db.execute(sql`update variants set cost_cents = 800 where id = ${shampoo.variant.id}`);
  await api(owner.token).post('/api/inventory/receive', { storeId: dt.id, lines: [{ variantId: shampoo.variant.id, qty: 10, unitCostCents: 800 }] }).expect(201);
  await api(owner.token).post('/api/inventory/receive', { storeId: up.id, lines: [{ variantId: shampoo.variant.id, qty: 10, unitCostCents: 800 }] }).expect(201);
});

const report = (token: string, qs: string) => api(token).get(`/api/reports/sales?${qs}`);

describe('sales report', () => {
  it('buckets by the store’s local day, credits services to the stylist and retail to the cashier', async () => {
    await openShift(cashier.id, dt.id, 0, new Date('2026-10-09T13:00:00Z'));
    // 11:30 pm New York on Oct 9 is already Oct 10 in UTC: it must count on the 9th.
    await createSale(cashier.id, { storeId: dt.id, lines: [{ variantId: cut.variant.id, qty: 1, staffId: stylist.id }, { variantId: shampoo.variant.id, qty: 2 }], payments: card(10000) }, { at: new Date('2026-10-10T03:30:00Z') });
    await createSale(cashier.id, { storeId: dt.id, lines: [{ variantId: shampoo.variant.id, qty: 1 }], payments: card(2000) }, { at: new Date('2026-10-10T15:00:00Z') });

    const res = await report(owner.token, `storeId=${dt.id}&from=2026-10-09&to=2026-10-11`).expect(200);
    expect(res.body.byDay).toEqual([
      { day: '2026-10-09', netSalesCents: 10000, servicesCents: 6000, retailCents: 4000, salesCount: 1 },
      { day: '2026-10-10', netSalesCents: 2000, servicesCents: 0, retailCents: 2000, salesCount: 1 },
      { day: '2026-10-11', netSalesCents: 0, servicesCents: 0, retailCents: 0, salesCount: 0 },
    ]);
    expect(res.body.totals).toMatchObject({ netSalesCents: 12000, servicesCents: 6000, retailCents: 6000, salesCount: 2, itemsSold: 3, costCents: 2400, grossMarginCents: 9600, avgTicketCents: 6000 });
    expect(res.body.byStaff).toEqual([
      expect.objectContaining({ name: 'Chloe', servicesCents: 0, retailCents: 6000 }),
      expect.objectContaining({ name: 'Mia', servicesCents: 6000, retailCents: 0, services: 1 }),
    ]);
    expect(res.body.topSellers.map((t: { name: string; qty: number }) => [t.name, t.qty])).toEqual([
      ['Haircut', 1],
      ['Shampoo', 3],
    ]);
  });

  it('subtracts refunds on the day of the refund, not the day of the sale', async () => {
    await openShift(cashier.id, dt.id, 0, new Date('2026-10-01T13:00:00Z'));
    const sale = await createSale(cashier.id, { storeId: dt.id, lines: [{ variantId: shampoo.variant.id, qty: 3 }], payments: card(6000) }, { at: new Date('2026-10-01T15:00:00Z') });
    const [line] = await db.select().from(saleLines).where(eq(saleLines.saleId, sale.id));
    await createReturn(cashier.id, sale.id, { lines: [{ saleLineId: line!.id, qty: 1, restock: true }], refundMethod: 'card' }, { at: new Date('2026-10-03T15:00:00Z') });

    const res = await report(owner.token, `storeId=${dt.id}&from=2026-10-01&to=2026-10-03`).expect(200);
    expect(res.body.byDay.map((d: { netSalesCents: number }) => d.netSalesCents)).toEqual([6000, 0, -2000]);
    expect(res.body.totals).toMatchObject({ netSalesCents: 4000, refundsCents: 2000, itemsSold: 2, costCents: 1600 });
    expect(res.body.topSellers[0]).toMatchObject({ name: 'Shampoo', qty: 2, netSalesCents: 4000 });
    expect(res.body.payments).toEqual([{ method: 'card', amountCents: 4000 }]);

    // Looking only at the sale day, the refund does not rewrite history.
    const day1 = await report(owner.token, `storeId=${dt.id}&from=2026-10-01&to=2026-10-01`).expect(200);
    expect(day1.body.totals.netSalesCents).toBe(6000);
  });

  it('compares stores for the owner and limits managers to their own stores', async () => {
    await openShift(cashier.id, dt.id, 0, new Date('2026-10-05T13:00:00Z'));
    await createSale(cashier.id, { storeId: dt.id, lines: [{ variantId: shampoo.variant.id, qty: 1 }], payments: card(2000) }, { at: new Date('2026-10-05T15:00:00Z') });
    const upCashier = await makeUser('cashier', [up.id]);
    await openShift(upCashier.id, up.id, 0, new Date('2026-10-05T13:00:00Z'));
    await createSale(upCashier.id, { storeId: up.id, lines: [{ variantId: shampoo.variant.id, qty: 4 }], payments: card(8000) }, { at: new Date('2026-10-05T16:00:00Z') });

    const all = await report(owner.token, 'from=2026-10-05&to=2026-10-05').expect(200);
    expect(all.body.byStore.map((s: { code: string; netSalesCents: number }) => [s.code, s.netSalesCents])).toEqual([
      ['UP', 8000],
      ['DT', 2000],
    ]);

    const manager = await makeUser('manager', [dt.id]);
    const mine = await report(manager.token, 'from=2026-10-05&to=2026-10-05').expect(200);
    expect(mine.body.totals.netSalesCents).toBe(2000);
    await report(manager.token, `storeId=${up.id}&from=2026-10-05&to=2026-10-05`).expect(403);
    await report(cashier.token, 'from=2026-10-05&to=2026-10-05').expect(403);
  });
});

describe('low stock', () => {
  it('lists items at or below their reorder level with incoming transfers', async () => {
    const wh = await makeStore({ code: 'WH', kind: 'warehouse' });
    const { variant } = await makeProduct({ name: 'Clay' });
    await db.execute(sql`update variants set reorder_level = 5 where id = ${variant.id}`);
    await db.execute(sql`update variants set reorder_level = 3 where id = ${shampoo.variant.id}`);
    await api(owner.token).post('/api/inventory/receive', { storeId: dt.id, lines: [{ variantId: variant.id, qty: 5 }] }).expect(201);
    await api(owner.token).post('/api/inventory/receive', { storeId: wh.id, lines: [{ variantId: variant.id, qty: 20 }] }).expect(201);
    await api(owner.token).post('/api/transfers', { fromStoreId: wh.id, toStoreId: dt.id, lines: [{ variantId: variant.id, qty: 6 }] }).expect(201);

    const res = await api(owner.token).get(`/api/reports/low-stock?storeId=${dt.id}`).expect(200);
    // Clay: 5 on hand = reorder level 5 → listed, 6 on the way. Shampoo: 10 > 3 → not listed.
    expect(res.body.items).toEqual([expect.objectContaining({ label: 'Clay', onHand: 5, reorderLevel: 5, inboundQty: 6 })]);
  });
});
