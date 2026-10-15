import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db/client.js';
import { api, makeProduct, makeStore, makeUser, resetDb, stockOf } from './helpers.js';

afterAll(() => pool.end());

describe('inventory ledger', () => {
  let store: Awaited<ReturnType<typeof makeStore>>;
  let manager: Awaited<ReturnType<typeof makeUser>>;

  beforeEach(async () => {
    await resetDb();
    store = await makeStore();
    manager = await makeUser('manager', [store.id]);
  });

  it('on-hand is the sum of movements, and the ledger shows a running balance', async () => {
    const { variant } = await makeProduct();
    await api(manager.token).post('/api/inventory/receive', { storeId: store.id, lines: [{ variantId: variant.id, qty: 10, unitCostCents: 450 }] }).expect(201);
    await api(manager.token).post('/api/inventory/receive', { storeId: store.id, lines: [{ variantId: variant.id, qty: 5 }] }).expect(201);
    expect(await stockOf(manager.token, store.id, variant.id)).toBe(15);

    const res = await api(manager.token).get(`/api/inventory/movements?storeId=${store.id}&variantId=${variant.id}`).expect(200);
    expect(res.body.movements.map((m: { qty: number; balance: number }) => [m.qty, m.balance])).toEqual([
      [5, 15],
      [10, 10],
    ]);
  });

  it('stock count writes only the difference as an adjustment', async () => {
    const { variant } = await makeProduct();
    await api(manager.token).post('/api/inventory/receive', { storeId: store.id, lines: [{ variantId: variant.id, qty: 12 }] }).expect(201);
    const res = await api(manager.token).post('/api/inventory/stocktake', { storeId: store.id, lines: [{ variantId: variant.id, countedQty: 9 }] }).expect(201);
    expect(res.body.adjustments[0]).toMatchObject({ before: 12, counted: 9, delta: -3 });
    expect(await stockOf(manager.token, store.id, variant.id)).toBe(9);

    // Counting the same number again writes nothing.
    await api(manager.token).post('/api/inventory/stocktake', { storeId: store.id, lines: [{ variantId: variant.id, countedQty: 9 }] }).expect(201);
    const moves = await api(manager.token).get(`/api/inventory/movements?storeId=${store.id}&variantId=${variant.id}`);
    expect(moves.body.movements).toHaveLength(2);
  });

  it('stock is tracked per store', async () => {
    const other = await makeStore();
    const owner = await makeUser('owner');
    const { variant } = await makeProduct();
    await api(owner.token).post('/api/inventory/receive', { storeId: store.id, lines: [{ variantId: variant.id, qty: 4 }] }).expect(201);
    expect(await stockOf(owner.token, store.id, variant.id)).toBe(4);
    expect(await stockOf(owner.token, other.id, variant.id)).toBe(0);
  });

  it('services cannot hold stock', async () => {
    const { variant } = await makeProduct({ type: 'service', durationMin: 30 });
    const res = await api(manager.token).post('/api/inventory/receive', { storeId: store.id, lines: [{ variantId: variant.id, qty: 1 }] }).expect(400);
    expect(res.body.error.code).toBe('NOT_STOCKED');
  });

  it('enforces roles and store assignment', async () => {
    const { variant } = await makeProduct();
    const cashier = await makeUser('cashier', [store.id]);
    await api(cashier.token).post('/api/inventory/receive', { storeId: store.id, lines: [{ variantId: variant.id, qty: 1 }] }).expect(403);
    const otherStore = await makeStore();
    await api(manager.token).post('/api/inventory/receive', { storeId: otherStore.id, lines: [{ variantId: variant.id, qty: 1 }] }).expect(403);
    await api(manager.token).get(`/api/inventory/levels?storeId=${otherStore.id}`).expect(403);
  });
});

describe('catalog', () => {
  beforeEach(resetDb);

  it('uses the store price override when present, and finds items by barcode or SKU', async () => {
    const a = await makeStore();
    const b = await makeStore();
    const owner = await makeUser('owner');
    const { variant } = await makeProduct({ priceCents: 1999, barcode: '0012345678905' });
    await api(owner.token).put(`/api/stores/${b.id}/prices/${variant.id}`, { priceCents: 1799 }).expect(200);

    const atA = await api(owner.token).get(`/api/products/lookup?storeId=${a.id}&code=0012345678905`).expect(200);
    const atB = await api(owner.token).get(`/api/products/lookup?storeId=${b.id}&code=${variant.sku.toLowerCase()}`).expect(200);
    expect(atA.body.variant.priceCents).toBe(1999);
    expect(atB.body.variant.priceCents).toBe(1799);

    await api(owner.token).put(`/api/stores/${b.id}/prices/${variant.id}`, { priceCents: null }).expect(200);
    const reset = await api(owner.token).get(`/api/products/lookup?storeId=${b.id}&code=0012345678905`).expect(200);
    expect(reset.body.variant.priceCents).toBe(1999);
  });

  it('creates a product with variants and deactivates variants removed on update', async () => {
    const owner = await makeUser('owner');
    const created = await api(owner.token)
      .post('/api/products', {
        name: 'Argan Shampoo',
        category: 'Hair care',
        variants: [
          { name: '250 ml', sku: 'ARG-250', priceCents: 1500 },
          { name: '500 ml', sku: 'ARG-500', priceCents: 2600, barcode: '4006381333931' },
        ],
      })
      .expect(201);
    const list = await api(owner.token).get('/api/products?q=argan').expect(200);
    const product = list.body.products[0];
    expect(product.variants.map((v: { sku: string }) => v.sku)).toEqual(['ARG-250', 'ARG-500']);

    const keep = product.variants.find((v: { sku: string }) => v.sku === 'ARG-500');
    await api(owner.token)
      .put(`/api/products/${created.body.id}`, { name: 'Argan Shampoo', category: 'Hair care', variants: [{ ...keep, priceCents: 2700 }] })
      .expect(200);
    const after = await api(owner.token).get('/api/products?q=argan').expect(200);
    expect(after.body.products[0].variants).toHaveLength(1);
    expect(after.body.products[0].variants[0].priceCents).toBe(2700);
  });

  it('rejects duplicate SKUs', async () => {
    const owner = await makeUser('owner');
    await api(owner.token).post('/api/products', { name: 'A', variants: [{ sku: 'DUP-1', priceCents: 100 }] }).expect(201);
    const res = await api(owner.token).post('/api/products', { name: 'B', variants: [{ sku: 'DUP-1', priceCents: 100 }] }).expect(409);
    expect(res.body.error.code).toBe('DUPLICATE');
  });
});
