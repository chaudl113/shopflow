// Makes `npm test` self-sufficient: if Postgres on the test URL is not reachable,
// start the compose `db` service and wait until it accepts connections.
import { execSync } from 'node:child_process';
import net from 'node:net';

const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://shopflow:shopflow@localhost:5442/shopflow_test');
const port = Number(url.port || 5432);

const reachable = () =>
  new Promise((resolve) => {
    const s = net.connect({ host: url.hostname, port }, () => { s.end(); resolve(true); });
    s.on('error', () => resolve(false));
  });

if (!(await reachable())) {
  console.log(`[ensure-db] Postgres not reachable on ${url.hostname}:${port}, starting docker compose db...`);
  execSync('docker compose up -d --wait db', { stdio: 'inherit' });
}
for (let i = 0; i < 60; i++) {
  if (await reachable()) process.exit(0);
  await new Promise((r) => setTimeout(r, 500));
}
console.error('[ensure-db] Postgres did not become reachable');
process.exit(1);
