import { sql } from 'drizzle-orm';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { signToken } from '../src/auth.js';
import { db } from '../src/db/client.js';
import { products, stores, userStores, users, variants } from '../src/db/schema.js';

export const app = createApp();

export async function resetDb() {
  const res = await db.execute(sql`select tablename from pg_tables where schemaname = 'public'`);
  const tables = res.rows.map((r) => `"${(r as { tablename: string }).tablename}"`);
  if (tables.length) await db.execute(sql.raw(`truncate ${tables.join(', ')} restart identity cascade`));
}

type Role = 'owner' | 'manager' | 'cashier' | 'staff';

export async function makeUser(role: Role, storeIds: string[] = [], extra: Partial<typeof users.$inferInsert> = {}) {
  const n = Math.random().toString(36).slice(2, 8);
  const [u] = await db
    .insert(users)
    .values({ email: `${role}-${n}@test.local`, name: `${role} ${n}`, passwordHash: 'x', role, ...extra })
    .returning();
  if (storeIds.length) await db.insert(userStores).values(storeIds.map((storeId) => ({ userId: u!.id, storeId })));
  return { ...u!, token: signToken(u!.id) };
}

export async function makeStore(overrides: Partial<typeof stores.$inferInsert> = {}) {
  const n = Math.random().toString(36).slice(2, 6).toUpperCase();
  const [s] = await db
    .insert(stores)
    .values({ code: `S${n}`, slug: `store-${n.toLowerCase()}`, name: `Store ${n}`, ...overrides })
    .returning();
  return s!;
}

export async function makeProduct(opts: { name?: string; priceCents?: number; type?: 'product' | 'service'; durationMin?: number; barcode?: string } = {}) {
  const n = Math.random().toString(36).slice(2, 8);
  const [p] = await db
    .insert(products)
    .values({ name: opts.name ?? `Product ${n}`, type: opts.type ?? 'product', durationMin: opts.durationMin ?? null })
    .returning();
  const [v] = await db
    .insert(variants)
    .values({ productId: p!.id, sku: `SKU-${n}`, barcode: opts.barcode ?? null, priceCents: opts.priceCents ?? 1000 })
    .returning();
  return { product: p!, variant: v! };
}

export const api = (token: string) => ({
  get: (url: string) => request(app).get(url).set('Authorization', `Bearer ${token}`),
  post: (url: string, body?: object) => request(app).post(url).set('Authorization', `Bearer ${token}`).send(body ?? {}),
  put: (url: string, body?: object) => request(app).put(url).set('Authorization', `Bearer ${token}`).send(body ?? {}),
  patch: (url: string, body?: object) => request(app).patch(url).set('Authorization', `Bearer ${token}`).send(body ?? {}),
});

export async function stockOf(token: string, storeId: string, variantId: string) {
  const res = await api(token).get(`/api/inventory/levels?storeId=${storeId}`);
  return (res.body.levels as { variantId: string; onHand: number }[]).find((l) => l.variantId === variantId)?.onHand ?? 0;
}
