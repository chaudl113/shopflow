import { sql } from 'drizzle-orm';
import { afterAll, expect, it } from 'vitest';
import { db, pool } from '../src/db/client.js';
import { seed } from '../src/db/seed.js';

afterAll(async () => {
  await db.execute(sql`drop table if exists other_app_notes`);
  await pool.end();
});

// `npm run demo:reset` reseeds on a schedule; on a shared database it must leave other tables alone.
it('reseeding wipes only ShopFlow tables', { timeout: 60_000 }, async () => {
  await db.execute(sql`create table if not exists other_app_notes (id int primary key, body text)`);
  await db.execute(sql`insert into other_app_notes values (1, 'keep me') on conflict do nothing`);

  await seed();

  const notes = await db.execute(sql`select body from other_app_notes`);
  expect(notes.rows).toEqual([{ body: 'keep me' }]);
  const users = await db.execute(sql`select count(*)::int as n from users where email like '%@shopflow.demo'`);
  expect((users.rows[0] as { n: number }).n).toBeGreaterThanOrEqual(5);
});
