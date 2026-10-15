import { desc, eq, or } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { assertStoreAccess, authUser, requireRole } from '../auth.js';
import { db } from '../db/client.js';
import { transfers } from '../db/schema.js';
import { notFound, parse } from '../lib/errors.js';
import { qty, uuid } from '../lib/zod.js';
import { cancelTransfer, getTransfers, receiveTransfer, sendTransfer } from '../transfers/transfers.js';

export const transfersRouter = Router();
const managers = requireRole('owner', 'manager');

transfersRouter.get('/', async (req, res) => {
  const q = parse(z.object({ storeId: uuid }), req.query);
  assertStoreAccess(authUser(req), q.storeId);
  const ids = await db
    .select({ id: transfers.id })
    .from(transfers)
    .where(or(eq(transfers.fromStoreId, q.storeId), eq(transfers.toStoreId, q.storeId)))
    .orderBy(desc(transfers.sentAt))
    .limit(100);
  res.json({ transfers: await getTransfers(ids.map((i) => i.id)) });
});

async function load(id: string) {
  const [t] = await getTransfers([id]);
  if (!t) throw notFound('Transfer');
  return t;
}

transfersRouter.post('/', managers, async (req, res) => {
  const user = authUser(req);
  const body = parse(
    z.object({ fromStoreId: uuid, toStoreId: uuid, note: z.string().max(200).optional(), lines: z.array(z.object({ variantId: uuid, qty })).min(1).max(200) }),
    req.body,
  );
  assertStoreAccess(user, body.fromStoreId);
  const id = await sendTransfer(user.id, body);
  res.status(201).json({ transfer: await load(id) });
});

transfersRouter.post('/:id/receive', managers, async (req, res) => {
  const user = authUser(req);
  const id = parse(uuid, req.params.id);
  const body = parse(z.object({ lines: z.array(z.object({ lineId: uuid, qtyReceived: z.number().int().min(0) })).optional(), note: z.string().max(200).optional() }), req.body);
  const t = await load(id);
  assertStoreAccess(user, t.toStoreId);
  await receiveTransfer(user.id, id, body);
  res.json({ transfer: await load(id) });
});

transfersRouter.post('/:id/cancel', managers, async (req, res) => {
  const user = authUser(req);
  const id = parse(uuid, req.params.id);
  const t = await load(id);
  assertStoreAccess(user, t.fromStoreId);
  await cancelTransfer(user.id, id);
  res.json({ transfer: await load(id) });
});
