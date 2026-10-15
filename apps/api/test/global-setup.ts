import pg from 'pg';

/** Fresh schema for every run: drop everything in the test database, then apply migrations. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://shopflow:shopflow@localhost:5442/shopflow_test';
  if (!/_test\b/.test(new URL(url).pathname)) throw new Error(`Refusing to reset non-test database ${url}`);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  await client.end();
  process.env.DATABASE_URL = url;
  const { runMigrations } = await import('../src/db/migrate.js');
  const { pool } = await import('../src/db/client.js');
  await runMigrations();
  await pool.end();
}
