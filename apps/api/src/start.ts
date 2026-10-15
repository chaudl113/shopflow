/**
 * Container entry point: apply migrations, load the demo dataset into an empty database
 * (SEED_DEMO=if-empty), then serve. A restart never wipes data that is already there.
 */
import { sql } from 'drizzle-orm';
import { db } from './db/client.js';
import { runMigrations } from './db/migrate.js';

await runMigrations();
console.log('migrations applied');

if (process.env.SEED_DEMO === 'if-empty') {
  const { rows } = await db.execute(sql`select count(*)::int as n from users`);
  if ((rows[0] as { n: number }).n === 0) {
    const { seed } = await import('./db/seed.js');
    console.log('empty database, loading demo data...');
    await seed();
    console.log('demo data loaded (owner@shopflow.demo / demo1234)');
  }
}

await import('./server.js');
