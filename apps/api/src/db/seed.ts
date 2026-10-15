/**
 * Demo data. Everything here is fictional. Running the seed wipes and recreates the demo dataset.
 * Stock and history are created through the same domain functions the API uses, so the ledger
 * the reviewer sees is exactly what real usage would produce.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, getTableName, is, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { DateTime } from 'luxon';
import { hashPassword } from '../auth.js';
import { createBooking, setStaffSchedule, updateBooking } from '../booking/booking.js';
import { applyMovements } from '../inventory/ledger.js';
import { ADD_ONS, CUSTOMERS, RETAIL_MIX, RETURN_REASONS, mulberry32, ringUp, weighted, type DemoLine } from '../demo/plan.js';
import { createReturn } from '../pos/sales.js';
import { closeShift, openShift, shiftSummary } from '../pos/shifts.js';
import { getTransfers, receiveTransfer, sendTransfer } from '../transfers/transfers.js';
import { db, pool } from './client.js';
import { runMigrations } from './migrate.js';
import * as schema from './schema.js';
import { products, saleLines, storePrices, stores, userStores, users, variants } from './schema.js';

export const DEMO_PASSWORD = 'demo1234';

type VariantSeed = { name?: string; sku: string; barcode?: string; price: number; cost?: number; reorder?: number };
type ProductSeed = { name: string; category: string; type?: 'product' | 'service'; durationMin?: number; variants: VariantSeed[] };

const catalog: ProductSeed[] = [
  { name: 'Argan Repair Shampoo', category: 'Hair care', variants: [
    { name: '250 ml', sku: 'ARG-SH-250', barcode: '0850001000017', price: 18, cost: 7, reorder: 6 },
    { name: '500 ml', sku: 'ARG-SH-500', barcode: '0850001000024', price: 29, cost: 11, reorder: 4 },
  ] },
  { name: 'Silk Conditioner', category: 'Hair care', variants: [{ sku: 'SILK-CO', barcode: '0850001000031', price: 21, cost: 8, reorder: 6 }] },
  { name: 'Matte Styling Clay', category: 'Styling', variants: [{ sku: 'CLAY-MT', barcode: '0850001000048', price: 16, cost: 5, reorder: 5 }] },
  { name: 'Heat Shield Spray', category: 'Styling', variants: [{ sku: 'HEAT-SP', barcode: '0850001000055', price: 19.5, cost: 6.5, reorder: 5 }] },
  { name: 'Ionic Hair Dryer', category: 'Tools', variants: [
    { name: 'Black', sku: 'DRY-ION-BK', barcode: '0850001000062', price: 129, cost: 58, reorder: 2 },
    { name: 'Pearl', sku: 'DRY-ION-PL', barcode: '0850001000079', price: 129, cost: 58, reorder: 2 },
  ] },
  { name: 'Ceramic Round Brush', category: 'Tools', variants: [
    { name: 'Small', sku: 'BR-RND-S', price: 22, cost: 7, reorder: 3 },
    { name: 'Medium', sku: 'BR-RND-M', price: 24, cost: 8, reorder: 3 },
    { name: 'Large', sku: 'BR-RND-L', price: 26, cost: 9, reorder: 3 },
  ] },
  { name: 'Gel Nail Polish', category: 'Nails', variants: [
    { name: 'Coral', sku: 'NAIL-CRL', barcode: '0850001000086', price: 12, cost: 3, reorder: 8 },
    { name: 'Ruby', sku: 'NAIL-RBY', barcode: '0850001000093', price: 12, cost: 3, reorder: 8 },
    { name: 'Nude', sku: 'NAIL-NUD', barcode: '0850001000109', price: 12, cost: 3, reorder: 8 },
  ] },
  { name: 'Vitamin C Face Serum', category: 'Skin care', variants: [{ sku: 'SER-VITC', barcode: '0850001000116', price: 38, cost: 12, reorder: 4 }] },
  { name: 'Hydrating Sheet Mask', category: 'Skin care', variants: [{ sku: 'MASK-HYD', barcode: '0850001000123', price: 6, cost: 1.5, reorder: 10 }] },
  { name: "Women's Haircut", category: 'Hair services', type: 'service', durationMin: 60, variants: [{ sku: 'SV-CUT-W', price: 65 }] },
  { name: "Men's Haircut", category: 'Hair services', type: 'service', durationMin: 30, variants: [{ sku: 'SV-CUT-M', price: 35 }] },
  { name: 'Blow-dry & Style', category: 'Hair services', type: 'service', durationMin: 45, variants: [{ sku: 'SV-BLOW', price: 45 }] },
  { name: 'Full Color', category: 'Hair services', type: 'service', durationMin: 120, variants: [{ sku: 'SV-COLOR', price: 140 }] },
  { name: 'Gel Manicure', category: 'Nail services', type: 'service', durationMin: 45, variants: [{ sku: 'SV-MANI', price: 38 }] },
  { name: 'Signature Facial', category: 'Skin services', type: 'service', durationMin: 60, variants: [{ sku: 'SV-FACIAL', price: 85 }] },
];

const cents = (d: number) => Math.round(d * 100);

const HISTORY_DAYS = 28;

/** ShopFlow's own tables. The database may be shared, so the wipe never touches anything else. */
const OWN_TABLES = Object.values(schema)
  .filter((t) => is(t, PgTable))
  .map((t) => `"${getTableName(t)}"`);

export async function seed() {
  await db.execute(sql.raw(`truncate ${OWN_TABLES.join(', ')} restart identity`));

  const [downtown, uptown, warehouse] = await db
    .insert(stores)
    .values([
      { code: 'DT', slug: 'downtown', name: 'Lumen Downtown', address: '214 Mercer St, New York, NY', phone: '(212) 555-0147', taxRateBps: 888, bookingEnabled: true },
      { code: 'UP', slug: 'uptown', name: 'Lumen Uptown', address: '1880 Broadway, New York, NY', phone: '(212) 555-0190', taxRateBps: 888, bookingEnabled: true },
      { code: 'WH', slug: 'warehouse', name: 'Central Warehouse', kind: 'warehouse', address: '45-10 Court Sq, Long Island City, NY', allowNegativeStock: false },
    ])
    .returning();
  if (!downtown || !uptown || !warehouse) throw new Error('store seed failed');

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const people = [
    { email: 'owner@shopflow.demo', name: 'Olivia Hart', role: 'owner' as const, stores: [] as string[] },
    { email: 'manager@shopflow.demo', name: 'Marcus Lee', role: 'manager' as const, stores: [downtown.id, warehouse.id] },
    { email: 'cashier@shopflow.demo', name: 'Chloe Park', role: 'cashier' as const, stores: [downtown.id] },
    { email: 'sam@shopflow.demo', name: 'Sam Rivera', role: 'cashier' as const, stores: [uptown.id] },
    { email: 'mia@shopflow.demo', name: 'Mia Torres', role: 'staff' as const, bookable: true, color: '#e11d48', stores: [downtown.id] },
    { email: 'noah@shopflow.demo', name: 'Noah Kim', role: 'staff' as const, bookable: true, color: '#0891b2', stores: [downtown.id, uptown.id] },
    { email: 'ava@shopflow.demo', name: 'Ava Patel', role: 'staff' as const, bookable: true, color: '#7c3aed', stores: [uptown.id] },
  ];
  const userRows = await db
    .insert(users)
    .values(people.map(({ stores: _s, ...p }) => ({ ...p, passwordHash })))
    .returning();
  const byEmail = new Map(userRows.map((u) => [u.email, u]));
  await db.insert(userStores).values(people.flatMap((p) => p.stores.map((storeId) => ({ userId: byEmail.get(p.email)!.id, storeId }))));

  const variantBySku = new Map<string, typeof variants.$inferSelect>();
  const productByName = new Map<string, typeof products.$inferSelect>();
  for (const p of catalog) {
    const [row] = await db.insert(products).values({ name: p.name, category: p.category, type: p.type ?? 'product', durationMin: p.durationMin ?? null }).returning();
    productByName.set(p.name, row!);
    const vs = await db
      .insert(variants)
      .values(p.variants.map((v) => ({ productId: row!.id, name: v.name ?? 'Default', sku: v.sku, barcode: v.barcode ?? null, priceCents: cents(v.price), costCents: cents(v.cost ?? 0), reorderLevel: v.reorder ?? 0 })))
      .returning();
    for (const v of vs) variantBySku.set(v.sku, v);
  }
  // Uptown charges a little more for two retail items.
  await db.insert(storePrices).values([
    { storeId: uptown.id, variantId: variantBySku.get('ARG-SH-500')!.id, priceCents: 3200 },
    { storeId: uptown.id, variantId: variantBySku.get('SER-VITC')!.id, priceCents: 4200 },
  ]);

  const owner = byEmail.get('owner@shopflow.demo')!;
  const manager = byEmail.get('manager@shopflow.demo')!;
  const stockPlan: Record<string, [number, number, number]> = {
    // sku: [warehouse, downtown, uptown]
    'ARG-SH-250': [60, 14, 9],
    'ARG-SH-500': [40, 8, 5],
    'SILK-CO': [50, 12, 3],
    'CLAY-MT': [36, 9, 7],
    'HEAT-SP': [30, 6, 6],
    'DRY-ION-BK': [10, 3, 1],
    'DRY-ION-PL': [8, 2, 2],
    'BR-RND-S': [20, 5, 4],
    'BR-RND-M': [20, 1, 4],
    'BR-RND-L': [20, 4, 3],
    'NAIL-CRL': [80, 16, 12],
    'NAIL-RBY': [80, 4, 12],
    'NAIL-NUD': [80, 18, 15],
    'SER-VITC': [24, 6, 5],
    'MASK-HYD': [200, 30, 24],
  };
  // Team schedules: weekly hours per store and the services each person performs.
  const svc = (...names: string[]) => names.map((n) => productByName.get(n)!.id);
  const H = (from: number, to: number, days: number[]) => days.map((weekday) => ({ weekday, startMin: from * 60, endMin: to * 60 }));
  const mia = byEmail.get('mia@shopflow.demo')!;
  const noah = byEmail.get('noah@shopflow.demo')!;
  const ava = byEmail.get('ava@shopflow.demo')!;
  await setStaffSchedule(downtown.id, mia.id, { hours: [...H(9, 17, [1, 2, 3, 4, 5, 6]), ...H(10, 16, [7])], productIds: svc("Women's Haircut", "Men's Haircut", 'Blow-dry & Style', 'Full Color') });
  await setStaffSchedule(downtown.id, noah.id, { hours: H(10, 18, [1, 3, 5, 7]), productIds: svc("Men's Haircut", "Women's Haircut", 'Blow-dry & Style', 'Signature Facial') });
  await setStaffSchedule(uptown.id, noah.id, { hours: H(10, 18, [2, 4, 6]) });
  await setStaffSchedule(uptown.id, ava.id, { hours: [...H(9, 17, [1, 2, 3, 4, 5, 6]), ...H(10, 16, [7])], productIds: svc('Gel Manicure', 'Signature Facial', 'Blow-dry & Style') });

  const rand = mulberry32(20261015);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
  const variantOf = (productName: string) => [...variantBySku.values()].find((v) => v.productId === productByName.get(productName)!.id)!;
  const appointments: Record<string, { offsetMin: number; service: string }[]> = {
    [mia.id]: [{ offsetMin: 60, service: "Women's Haircut" }, { offsetMin: 150, service: 'Blow-dry & Style' }, { offsetMin: 300, service: 'Full Color' }],
    [noah.id]: [{ offsetMin: 0, service: "Men's Haircut" }, { offsetMin: 90, service: 'Signature Facial' }, { offsetMin: 270, service: "Women's Haircut" }],
    [ava.id]: [{ offsetMin: 30, service: 'Gel Manicure' }, { offsetMin: 180, service: 'Signature Facial' }],
  };
  const sites = [
    { store: downtown, people: [mia, noah], tills: [byEmail.get('cashier@shopflow.demo')!, manager], walkIns: [4, 9] as const },
    { store: uptown, people: [noah, ava], tills: [byEmail.get('sam@shopflow.demo')!], walkIns: [3, 7] as const },
  ];
  const hoursOf = async (storeId: string, userId: string, weekday: number) =>
    (await db.execute(sql`select start_min from staff_hours where store_id = ${storeId} and user_id = ${userId} and weekday = ${weekday} order by start_min limit 1`)).rows[0] as
      | { start_min: number }
      | undefined;

  // ---- Pass 1: plan four weeks of trading (pure, seeded random) so opening stock can cover it.
  type Line = { sku: string; qty: number };
  type Visit =
    | { kind: 'walkin'; at: DateTime; lines: Line[]; refund: boolean }
    | { kind: 'booking'; at: DateTime; staffId: string; service: string; outcome: 'paid' | 'no_show' | 'cancelled'; online: boolean; addOn: Line | null };
  const days: { site: (typeof sites)[number]; day: DateTime; till: (typeof sites)[number]['tills'][number]; visits: Visit[] }[] = [];
  const used = new Map<string, number>(); // storeId:sku -> units sold over the period
  const use = (storeId: string, l: Line) => used.set(`${storeId}:${l.sku}`, (used.get(`${storeId}:${l.sku}`) ?? 0) + l.qty);
  for (let d = HISTORY_DAYS; d >= 1; d--) {
    for (const site of sites) {
      const day = DateTime.now().setZone(site.store.timezone).startOf('day').minus({ days: d });
      const visits: Visit[] = [];
      for (const person of site.people) {
        const h = await hoursOf(site.store.id, person.id, day.weekday);
        if (!h) continue;
        for (const slot of appointments[person.id]!) {
          if (rand() < 0.25) continue;
          const r = rand();
          const addOn = rand() < 0.35 ? { sku: pick(ADD_ONS), qty: 1 } : null;
          visits.push({
            kind: 'booking',
            at: day.set({ hour: Math.floor((h.start_min + slot.offsetMin) / 60), minute: (h.start_min + slot.offsetMin) % 60 }),
            staffId: person.id,
            service: slot.service,
            outcome: r < 0.07 ? 'no_show' : r < 0.12 ? 'cancelled' : 'paid',
            online: rand() < 0.4,
            addOn,
          });
        }
      }
      const [lo, hi] = site.walkIns;
      const count = Math.round((lo + rand() * (hi - lo)) * (day.weekday >= 6 ? 1.3 : 1));
      for (let i = 0; i < count; i++) {
        const lines: Line[] = [];
        const n = rand() < 0.7 ? 1 : rand() < 0.8 ? 2 : 3;
        for (let k = 0; k < n; k++) {
          const sku = weighted(rand, RETAIL_MIX);
          const existing = lines.find((l) => l.sku === sku);
          if (existing) existing.qty++;
          else lines.push({ sku, qty: rand() < 0.15 ? 2 : 1 });
        }
        visits.push({ kind: 'walkin', at: day.set({ hour: 10 + Math.floor(rand() * 8), minute: Math.floor(rand() * 4) * 15 + Math.floor(rand() * 10) }), lines, refund: rand() < 0.04 });
      }
      for (const v of visits) {
        if (v.kind === 'walkin') v.lines.forEach((l) => use(site.store.id, l));
        else if (v.outcome === 'paid' && v.addOn) use(site.store.id, v.addOn);
      }
      visits.sort((a, b) => a.at.toMillis() - b.at.toMillis());
      days.push({ site, day, till: d % 7 === 0 && site.tills[1] ? site.tills[1] : site.tills[0]!, visits });
    }
  }

  // Opening stock (five weeks ago) = today's target level + what the simulated weeks will sell.
  const openingAt = DateTime.now().minus({ days: HISTORY_DAYS + 7 }).toJSDate();
  await db.transaction(async (tx) => {
    for (const [sku, [wh, dt, up]] of Object.entries(stockPlan)) {
      const v = variantBySku.get(sku)!;
      const base = { variantId: v.id, kind: 'receive' as const, unitCostCents: v.costCents, note: 'Opening stock (demo)', userId: owner.id, createdAt: openingAt };
      await applyMovements(tx, [
        { ...base, storeId: warehouse.id, qty: wh },
        { ...base, storeId: downtown.id, qty: dt + (used.get(`${downtown.id}:${sku}`) ?? 0) },
        { ...base, storeId: uptown.id, qty: up + (used.get(`${uptown.id}:${sku}`) ?? 0) },
      ]);
    }
  });

  // ---- Pass 2: replay the plan through the real POS, booking and shift code.
  let n = 0;
  const customer = () => CUSTOMERS[n++ % CUSTOMERS.length]!;
  const phone = () => `(212) 555-0${String(100 + (n % 900)).padStart(3, '0')}`;
  for (const { site, day, till, visits } of days) {
    const storeId = site.store.id;
    const shift = await openShift(till.id, storeId, 15000, day.set({ hour: 9, minute: 30 }).toJSDate());
    for (const v of visits) {
      if (v.kind === 'booking') {
        const service = variantOf(v.service);
        const name = customer();
        const b = await createBooking(
          { storeId, variantId: service.id, staffId: v.staffId, startsAt: v.at.toJSDate(), customerName: name, customerPhone: phone(), source: v.online ? 'online' : 'staff' },
          { actorId: v.online ? null : till.id, enforceHours: false },
        );
        if (v.outcome !== 'paid') {
          await updateBooking(b.id, { status: v.outcome });
          continue;
        }
        const lines = [{ variantId: service.id, qty: 1, staffId: v.staffId }, ...(v.addOn ? [{ variantId: variantBySku.get(v.addOn.sku)!.id, qty: v.addOn.qty }] : [])];
        await sell(till.id, storeId, lines, name, b.id, b.endsAt);
      } else {
        const lines = v.lines.map((l) => ({ variantId: variantBySku.get(l.sku)!.id, qty: l.qty }));
        const sale = await sell(till.id, storeId, lines, rand() < 0.3 ? customer() : '', undefined, v.at.toJSDate());
        if (v.refund) {
          const [line] = await db.select().from(saleLines).where(eq(saleLines.saleId, sale.id));
          const at = DateTime.min(v.at.plus({ hours: 2 }), day.set({ hour: 18, minute: 45 }));
          await createReturn(till.id, sale.id, { lines: [{ saleLineId: line!.id, qty: 1, restock: rand() < 0.7 }], refundMethod: sale.method, reason: pick(RETURN_REASONS) }, { at: at.toJSDate() });
        }
      }
    }
    const { expectedCashCents } = await shiftSummary(db, shift.id);
    const variance = rand() < 0.85 ? 0 : pick([-500, -100, -25, 200]);
    await closeShift(shift.id, till.id, expectedCashCents + variance, variance ? pick(['Recounted twice', 'Change given wrong once', 'Coins in the wrong slot']) : '', day.set({ hour: 19 }).toJSDate());
  }

  function sell(userId: string, storeId: string, lines: DemoLine[], customerName: string, bookingId: string | undefined, at: Date) {
    return ringUp(rand, userId, { storeId, lines, customerName, bookingId }, at);
  }

  // Transfers: one completed with a shortfall, one still on the truck to Downtown.
  const daysAgo = (d: number, h = 10) => new Date(Date.now() - d * 86_400_000 + (h - 12) * 3_600_000);
  const t1 = await sendTransfer(owner.id, { fromStoreId: warehouse.id, toStoreId: uptown.id, note: 'Weekly restock (demo)', lines: [
    { variantId: variantBySku.get('SILK-CO')!.id, qty: 12 },
    { variantId: variantBySku.get('NAIL-RBY')!.id, qty: 10 },
  ] }, { at: daysAgo(3) });
  const [t1Detail] = await getTransfers([t1]);
  await receiveTransfer(owner.id, t1, { lines: [{ lineId: t1Detail!.lines.find((l) => l.sku === 'NAIL-RBY')!.id, qtyReceived: 9 }], note: 'One bottle broken in transit' }, { at: daysAgo(2) });
  await sendTransfer(manager.id, { fromStoreId: warehouse.id, toStoreId: downtown.id, note: 'Restock low items (demo)', lines: [
    { variantId: variantBySku.get('BR-RND-M')!.id, qty: 6 },
    { variantId: variantBySku.get('NAIL-RBY')!.id, qty: 12 },
    { variantId: variantBySku.get('DRY-ION-PL')!.id, qty: 3 },
  ] }, { at: daysAgo(0, 9) });

  // The coming week: appointments from today on, laid out from each person's start time.
  for (let d = 0; d < 7; d++) {
    for (const { store, people } of sites) {
      const day = DateTime.now().setZone(store.timezone).startOf('day').plus({ days: d });
      for (const person of people) {
        const h = await hoursOf(store.id, person.id, day.weekday);
        if (!h) continue;
        for (const [i, slot] of appointments[person.id]!.entries()) {
          if ((d + i) % 4 === 3) continue; // leave gaps so the week does not look fully booked
          const online = n % 3 === 0;
          await createBooking(
            {
              storeId: store.id,
              variantId: variantOf(slot.service).id,
              staffId: person.id,
              startsAt: day.set({ hour: Math.floor((h.start_min + slot.offsetMin) / 60), minute: (h.start_min + slot.offsetMin) % 60 }).toJSDate(),
              customerName: customer(),
              customerPhone: phone(),
              source: online ? 'online' : 'staff',
              note: n % 5 === 0 ? 'Prefers a quiet chair' : '',
            },
            { actorId: online ? null : manager.id, enforceHours: false },
          );
        }
      }
    }
  }

  return { downtown, uptown, warehouse, byEmail, variantBySku, productByName, daysAgo };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigrations()
    .then(seed)
    .then(() => console.log(`Demo data seeded. Sign in with owner@shopflow.demo / ${DEMO_PASSWORD}`))
    .finally(() => pool.end());
}
