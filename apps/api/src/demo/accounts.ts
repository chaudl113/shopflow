/** Seeded demo accounts. In public demo mode they sign in with one click and cannot be changed. */
export const DEMO_LOGINS = {
  owner: 'owner@shopflow.demo',
  manager: 'manager@shopflow.demo',
  cashier: 'cashier@shopflow.demo',
  stylist: 'mia@shopflow.demo',
} as const;
export type DemoRole = keyof typeof DEMO_LOGINS;

export const isDemoAccount = (email: string) => email.toLowerCase().endsWith('@shopflow.demo');
