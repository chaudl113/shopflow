import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db/client.js';
import { api, makeProduct, makeStore, makeUser, resetDb, stockOf } from './helpers.js';

afterAll(() => pool.end());

describe('stock transfers (send -> in transit -> receive)', () => {
  let warehouse: Awaited<ReturnType<typeof makeStore>>;
  let store: Awaited<ReturnType<typeof makeStore>>;
  let owner: Awaited<ReturnType<typeof makeUser>>;
  let variantId: string;

  beforeEach(async () => {
    await resetDb();
    warehouse = await makeStore({ code: 'WH', kind: 'warehouse' });
    store = await makeStore({ code: 'DT' });
    owner = await makeUser('owner');
    variantId = (await makeProduct()).variant.id;
    await api(owner.token).post('/api/inventory/receive', { storeId: warehouse.id, lines: [{ variantId, qty: 10 }] }).expect(201);
  });

  const send = (token: string, qty: number) =>
    api(token).post('/api/transfers', { fromStoreId: warehouse.id, toStoreId: store.id, lines: [{ variantId, qty }], note: 'Weekly restock' });
  const inbound = async (storeId: string) => {
    const res = await api(owner.token).get(`/api/inventory/levels?storeId=${storeId}`).expect(200);
    return res.body.levels.find((l: { variantId: string }) => l.variantId === variantId)?.inbound;
  };

  it('stock leaves the source on send, is in transit, and arrives on receive', async () => {
    const sent = await send(owner.token, 6).expect(201);
    expect(sent.body.transfer).toMatchObject({ status: 'in_transit', number: 'T-WH-000001' });
    expect(await stockOf(owner.token, warehouse.id, variantId)).toBe(4);
    expect(await stockOf(owner.token, store.id, variantId)).toBe(0);
    expect(await inbound(store.id)).toBe(6);

    const received = await api(owner.token).post(`/api/transfers/${sent.body.transfer.id}/receive`, {}).expect(200);
    expect(received.body.transfer.status).toBe('received');
    expect(await stockOf(owner.token, store.id, variantId)).toBe(6);
    expect(await inbound(store.id)).toBe(0);
  });

  it('cannot send more than the source has', async () => {
    const res = await send(owner.token, 11).expect(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(await stockOf(owner.token, warehouse.id, variantId)).toBe(10);
  });

  it('partial receipt books what arrived and records the shortfall', async () => {
    const sent = await send(owner.token, 10).expect(201);
    const lineId = sent.body.transfer.lines[0].id;
    const res = await api(owner.token).post(`/api/transfers/${sent.body.transfer.id}/receive`, { lines: [{ lineId, qtyReceived: 8 }], note: '2 crushed in transit' }).expect(200);
    expect(res.body.transfer.lines[0]).toMatchObject({ qtySent: 10, qtyReceived: 8 });
    expect(await stockOf(owner.token, store.id, variantId)).toBe(8);
    expect(await stockOf(owner.token, warehouse.id, variantId)).toBe(0);

    const over = await send(owner.token, 1).expect(409); // warehouse is empty now
    expect(over.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('cannot receive more than was sent', async () => {
    const sent = await send(owner.token, 3).expect(201);
    const lineId = sent.body.transfer.lines[0].id;
    await api(owner.token).post(`/api/transfers/${sent.body.transfer.id}/receive`, { lines: [{ lineId, qtyReceived: 4 }] }).expect(400);
  });

  it('receiving twice at the same moment books the stock once', async () => {
    const sent = await send(owner.token, 5).expect(201);
    const url = `/api/transfers/${sent.body.transfer.id}/receive`;
    const results = await Promise.all([api(owner.token).post(url, {}), api(owner.token).post(url, {})]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await stockOf(owner.token, store.id, variantId)).toBe(5);
  });

  it('cancelling an in-transit transfer puts the stock back at the source', async () => {
    const sent = await send(owner.token, 7).expect(201);
    await api(owner.token).post(`/api/transfers/${sent.body.transfer.id}/cancel`, {}).expect(200);
    expect(await stockOf(owner.token, warehouse.id, variantId)).toBe(10);
    const res = await api(owner.token).post(`/api/transfers/${sent.body.transfer.id}/receive`, {}).expect(409);
    expect(res.body.error.code).toBe('TRANSFER_NOT_IN_TRANSIT');
  });

  it('only staff of the destination can receive', async () => {
    const whManager = await makeUser('manager', [warehouse.id]);
    const sent = await send(whManager.token, 2).expect(201);
    await api(whManager.token).post(`/api/transfers/${sent.body.transfer.id}/receive`, {}).expect(403);
    const dtManager = await makeUser('manager', [store.id]);
    await api(dtManager.token).post(`/api/transfers/${sent.body.transfer.id}/receive`, {}).expect(200);
  });

  it('rejects a transfer to the same location', async () => {
    await api(owner.token).post('/api/transfers', { fromStoreId: store.id, toStoreId: store.id, lines: [{ variantId, qty: 1 }] }).expect(400);
  });
});
