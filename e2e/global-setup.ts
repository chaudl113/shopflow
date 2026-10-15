import { execSync } from 'node:child_process';

// Every run starts from the same deterministic demo dataset. Set E2E_SKIP_SEED=1 to keep current data.
export default function globalSetup() {
  if (process.env.E2E_SKIP_SEED) return;
  execSync('node scripts/ensure-db.mjs && npm run seed', { stdio: 'inherit' });
}
