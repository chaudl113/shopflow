const required = (name: string, fallback?: string): string => {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
};

const isProd = process.env.NODE_ENV === 'production';

/** Express "trust proxy": a hop count ("2" behind Cloudflare + a reverse proxy), or true/false. */
function trustProxy(v = '1'): number | boolean {
  if (v === 'true') return true;
  if (v === 'false') return false;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`TRUST_PROXY must be a hop count, got "${v}"`);
  return n;
}

export const config = {
  databaseUrl: required('DATABASE_URL', 'postgres://shopflow:shopflow@localhost:5442/shopflow'),
  // A dev fallback keeps `npm run dev` friction-free; production must set a real secret.
  jwtSecret: required('JWT_SECRET', isProd ? undefined : 'dev-only-secret-not-for-production'),
  port: Number(process.env.API_PORT ?? 3201),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5201',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS ?? 10),
  trustProxy: trustProxy(process.env.TRUST_PROXY),
  /** Directory of the built web app; when set, the API also serves the SPA (single-container deploy). */
  webDist: process.env.WEB_DIST || null,
  /** Public demo: one-click demo sign-in, demo accounts locked, simulated trading for "today". */
  demoPublic: process.env.DEMO_PUBLIC === '1',
};
