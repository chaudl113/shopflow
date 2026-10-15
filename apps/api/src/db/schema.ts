import {
  bigserial,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// All money is stored as integer cents. All quantities are integer units.

export const locationKind = pgEnum('location_kind', ['store', 'warehouse']);
export const userRole = pgEnum('user_role', ['owner', 'manager', 'cashier', 'staff']);
export const productType = pgEnum('product_type', ['product', 'service']);
export const movementKind = pgEnum('movement_kind', [
  'receive',
  'sale',
  'return',
  'adjust',
  'transfer_out',
  'transfer_in',
  'transfer_cancel',
]);

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** A store (sells, takes bookings) or a warehouse (holds stock only). */
export const stores = pgTable('stores', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  kind: locationKind('kind').notNull().default('store'),
  address: text('address').notNull().default(''),
  phone: text('phone').notNull().default(''),
  timezone: text('timezone').notNull().default('America/New_York'),
  /** Sales tax in basis points (825 = 8.25 %), applied on the discounted subtotal. */
  taxRateBps: integer('tax_rate_bps').notNull().default(0),
  /** When false (default) any movement that would take on-hand below zero is rejected. */
  allowNegativeStock: boolean('allow_negative_stock').notNull().default(false),
  bookingEnabled: boolean('booking_enabled').notNull().default(false),
  createdAt: createdAt(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: userRole('role').notNull(),
  /** Takes appointments (shows up on the public booking page). */
  bookable: boolean('bookable').notNull().default(false),
  color: text('color').notNull().default('#6366f1'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

/** Which stores a non-owner user works at. Owners implicitly see every store. */
export const userStores = pgTable(
  'user_stores',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.storeId] })],
);

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: productType('type').notNull().default('product'),
  category: text('category').notNull().default('General'),
  description: text('description').notNull().default(''),
  /** Services only: appointment length. */
  durationMin: integer('duration_min'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

export const variants = pgTable(
  'variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
    name: text('name').notNull().default('Default'),
    sku: text('sku').notNull().unique(),
    barcode: text('barcode').unique(),
    /** Default price; a store can override it in store_prices. */
    priceCents: integer('price_cents').notNull(),
    costCents: integer('cost_cents').notNull().default(0),
    reorderLevel: integer('reorder_level').notNull().default(5),
    active: boolean('active').notNull().default(true),
  },
  (t) => [index('variants_product_idx').on(t.productId)],
);

export const storePrices = pgTable(
  'store_prices',
  {
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id').notNull().references(() => variants.id, { onDelete: 'cascade' }),
    priceCents: integer('price_cents').notNull(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.variantId] })],
);

/**
 * The inventory ledger. On-hand at a location is SUM(qty) of its rows; rows are never
 * updated or deleted. Every write goes through inventory/ledger.ts which serialises
 * writers per (store, variant) with a transaction-scoped advisory lock.
 */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    variantId: uuid('variant_id').notNull().references(() => variants.id),
    qty: integer('qty').notNull(),
    kind: movementKind('kind').notNull(),
    unitCostCents: integer('unit_cost_cents'),
    refType: text('ref_type'),
    refId: uuid('ref_id'),
    note: text('note').notNull().default(''),
    userId: uuid('user_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('stock_movements_store_variant_idx').on(t.storeId, t.variantId),
    index('stock_movements_ref_idx').on(t.refType, t.refId),
  ],
);

/** Per-store document counters for human-readable numbers (S-DT-000123). */
export const counters = pgTable(
  'counters',
  {
    scope: text('scope').notNull(),
    kind: text('kind').notNull(),
    value: integer('value').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.scope, t.kind] })],
);
