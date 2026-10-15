/**
 * `npm run demo:reset` — nightly reset of the public demo. Wipes everything visitors created,
 * reloads the demo dataset (four weeks of history up to yesterday) and replays today up to now.
 * Holds the demo lock so the running app's simulator never sees a half-seeded database.
 */
import { pool } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { seed } from '../db/seed.js';
import { simulateDemoDay, withDemoLock } from './simulate.js';

const started = Date.now();
try {
  await runMigrations();
  const today = await withDemoLock(
    async () => {
      await seed();
      return simulateDemoDay(new Date(), { locked: true });
    },
    { wait: true },
  );
  console.log(`[demo:reset] done in ${((Date.now() - started) / 1000).toFixed(1)}s; today so far: ${JSON.stringify(today)}`);
} catch (e) {
  console.error('[demo:reset] failed', e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
