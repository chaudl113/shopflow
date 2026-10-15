import { DateTime } from 'luxon';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { assertStoreAccess, authUser, requireRole } from '../auth.js';
import { db } from '../db/client.js';
import { stores } from '../db/schema.js';
import { badRequest, parse } from '../lib/errors.js';
import { uuid } from '../lib/zod.js';
import { lowStock, salesReport } from '../reports/reports.js';

export const reportsRouter = Router();
reportsRouter.use(requireRole('owner', 'manager'));

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** One store if asked for, otherwise every store the user can see. */
async function scope(req: Request, storeId?: string) {
  const user = authUser(req);
  if (storeId) {
    assertStoreAccess(user, storeId);
    return [storeId];
  }
  if (user.role === 'owner') return (await db.select({ id: stores.id }).from(stores)).map((s) => s.id);
  return user.storeIds;
}

reportsRouter.get('/sales', async (req, res) => {
  const q = parse(z.object({ storeId: uuid.optional(), from: isoDate, to: isoDate }), req.query);
  const from = DateTime.fromISO(q.from);
  const to = DateTime.fromISO(q.to);
  if (!from.isValid || !to.isValid || to < from) throw badRequest('BAD_RANGE', 'Invalid date range');
  if (to.diff(from, 'days').days > 366) throw badRequest('BAD_RANGE', 'Ranges are limited to one year');
  res.json(await salesReport({ storeIds: await scope(req, q.storeId), from: q.from, to: q.to }));
});

reportsRouter.get('/low-stock', async (req, res) => {
  const q = parse(z.object({ storeId: uuid.optional() }), req.query);
  res.json({ items: await lowStock(await scope(req, q.storeId)) });
});
