/** Building blocks shared by the seed (four weeks of history) and the live demo simulator (today). */
import { createHash } from 'node:crypto';
import { db } from '../db/client.js';
import { createSale, quoteCart } from '../pos/sales.js';

export const CUSTOMERS = ['Emma Wilson', 'Sofia Martinez', 'Grace Lee', 'Liam Johnson', 'Olivia Brown', 'Ethan Davis', 'Ava Thompson', 'Lucas Garcia', 'Zoe Clark', 'Henry Lewis', 'Chloe Walker', 'Jack Hall', 'Lily Allen', 'Mason Young', 'Nora King', 'Leo Wright', 'Ruby Scott', 'Owen Green', 'Isla Baker', 'Caleb Adams'];
export const RETURN_REASONS = ['Wrong shade', 'Changed mind', 'Damaged packaging', 'Gift duplicate'];
/** Relative popularity of retail items in walk-in sales. */
export const RETAIL_MIX: [string, number][] = [
  ['NAIL-CRL', 9], ['NAIL-RBY', 7], ['NAIL-NUD', 10], ['MASK-HYD', 12], ['ARG-SH-250', 8], ['ARG-SH-500', 4], ['SILK-CO', 6],
  ['CLAY-MT', 5], ['HEAT-SP', 4], ['SER-VITC', 3], ['BR-RND-S', 1], ['BR-RND-M', 2], ['BR-RND-L', 1], ['DRY-ION-BK', 0.6], ['DRY-ION-PL', 0.5],
];
export const ADD_ONS = ['HEAT-SP', 'ARG-SH-250', 'SER-VITC', 'NAIL-NUD', 'MASK-HYD'] as const;

/** Small seeded PRNG so every run produces the same demo data. */
export function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const randFor = (key: string) => mulberry32(createHash('sha1').update(key).digest().readUInt32BE(0));

/** Stable UUID for a text key, so replaying the same simulated event is a no-op (sales.client_ref). */
export function uuidFrom(key: string) {
  const h = createHash('sha1').update(`shopflow-demo:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

export function weighted(rand: () => number, items: [string, number][]) {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [k, w] of items) if ((r -= w) <= 0) return k;
  return items[items.length - 1]![0];
}

export type DemoLine = { variantId: string; qty: number; staffId?: string };

/** Rings up a sale the way a cashier would: about 62 % card, 33 % cash with a round amount handed over, 5 % other. */
export async function ringUp(
  rand: () => number,
  userId: string,
  input: { storeId: string; lines: DemoLine[]; customerName: string; bookingId?: string; clientRef?: string },
  at: Date,
) {
  const { priced } = await quoteCart(db, { storeId: input.storeId, lines: input.lines });
  const r = rand();
  const method = r < 0.62 ? ('card' as const) : r < 0.95 ? ('cash' as const) : ('other' as const);
  const note = rand() < 0.5 ? 500 : 2000;
  const tendered = method === 'cash' ? Math.ceil(priced.totalCents / note) * note : priced.totalCents;
  const res = await createSale(userId, { ...input, payments: [{ method, amountCents: Math.max(tendered, priced.totalCents) }] }, { at });
  return { ...res, method };
}
