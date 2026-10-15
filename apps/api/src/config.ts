const required = (name: string, fallback?: string): string => {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
};

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  databaseUrl: required('DATABASE_URL', 'postgres://shopflow:shopflow@localhost:5442/shopflow'),
  // A dev fallback keeps `npm run dev` friction-free; production must set a real secret.
  jwtSecret: required('JWT_SECRET', isProd ? undefined : 'dev-only-secret-not-for-production'),
  port: Number(process.env.API_PORT ?? 3201),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5201',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS ?? 10),
};
