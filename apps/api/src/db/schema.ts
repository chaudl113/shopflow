import { sql } from 'drizzle-orm';
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
  uniqueIndex,
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

export const shiftStatus = pgEnum('shift_status', ['open', 'closed']);
export const paymentMethod = pgEnum('payment_method', ['cash', 'card', 'other']);
export const transferStatus = pgEnum('transfer_status', ['in_transit', 'received', 'cancelled']);
export const cashMovementKind = pgEnum('cash_movement_kind', ['pay_in', 'pay_out']);
export const bookingStatus = pgEnum('booking_status', ['booked', 'completed', 'cancelled', 'no_show']);
export const bookingSource = pgEnum('booking_source', ['online', 'staff']);

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

/** A cashier's drawer session. At most one open shift per user (partial unique index). */
export const shifts = pgTable(
  'shifts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    status: shiftStatus('status').notNull().default('open'),
    openingFloatCents: integer('opening_float_cents').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: uuid('closed_by').references(() => users.id),
    expectedCashCents: integer('expected_cash_cents'),
    countedCashCents: integer('counted_cash_cents'),
    differenceCents: integer('difference_cents'),
    closingNote: text('closing_note').notNull().default(''),
  },
  (t) => [
    uniqueIndex('shifts_one_open_per_user').on(t.userId).where(sql`status = 'open'`),
    index('shifts_store_idx').on(t.storeId, t.openedAt),
  ],
);

export const cashMovements = pgTable('cash_movements', {
  id: uuid('id').primaryKey().defaultRandom(),
  shiftId: uuid('shift_id').notNull().references(() => shifts.id),
  kind: cashMovementKind('kind').notNull(),
  amountCents: integer('amount_cents').notNull(),
  reason: text('reason').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id),
  createdAt: createdAt(),
});

export const sales = pgTable(
  'sales',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull().unique(),
    /** Client-generated id that makes "Charge" safe to retry (double click, flaky network). */
    clientRef: uuid('client_ref').unique(),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    shiftId: uuid('shift_id').notNull().references(() => shifts.id),
    cashierId: uuid('cashier_id').notNull().references(() => users.id),
    customerName: text('customer_name').notNull().default(''),
    subtotalCents: integer('subtotal_cents').notNull(),
    discountCents: integer('discount_cents').notNull(),
    taxCents: integer('tax_cents').notNull(),
    totalCents: integer('total_cents').notNull(),
    changeCents: integer('change_cents').notNull().default(0),
    taxRateBps: integer('tax_rate_bps').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sales_store_created_idx').on(t.storeId, t.createdAt)],
);

export const saleLines = pgTable(
  'sale_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    saleId: uuid('sale_id').notNull().references(() => sales.id),
    position: integer('position').notNull(),
    variantId: uuid('variant_id').notNull().references(() => variants.id),
    /** Who performed a service (commission/revenue by staff). */
    staffId: uuid('staff_id').references(() => users.id),
    isService: boolean('is_service').notNull(),
    name: text('name').notNull(),
    sku: text('sku').notNull(),
    qty: integer('qty').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    lineDiscountCents: integer('line_discount_cents').notNull(),
    orderDiscountCents: integer('order_discount_cents').notNull(),
    netCents: integer('net_cents').notNull(),
    taxCents: integer('tax_cents').notNull(),
    totalCents: integer('total_cents').notNull(),
    unitCostCents: integer('unit_cost_cents').notNull().default(0),
  },
  (t) => [index('sale_lines_sale_idx').on(t.saleId)],
);

export const saleReturns = pgTable(
  'sale_returns',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull().unique(),
    clientRef: uuid('client_ref').unique(),
    saleId: uuid('sale_id').notNull().references(() => sales.id),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    shiftId: uuid('shift_id').notNull().references(() => shifts.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    reason: text('reason').notNull().default(''),
    netCents: integer('net_cents').notNull(),
    taxCents: integer('tax_cents').notNull(),
    totalCents: integer('total_cents').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sale_returns_sale_idx').on(t.saleId)],
);

export const returnLines = pgTable(
  'return_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    returnId: uuid('return_id').notNull().references(() => saleReturns.id),
    saleLineId: uuid('sale_line_id').notNull().references(() => saleLines.id),
    qty: integer('qty').notNull(),
    restock: boolean('restock').notNull(),
    netCents: integer('net_cents').notNull(),
    taxCents: integer('tax_cents').notNull(),
    totalCents: integer('total_cents').notNull(),
  },
  (t) => [index('return_lines_sale_line_idx').on(t.saleLineId)],
);

/** Money in (sale) is positive, money out (refund) is negative. Drawer cash = sum of cash rows. */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shiftId: uuid('shift_id').notNull().references(() => shifts.id),
    saleId: uuid('sale_id').references(() => sales.id),
    returnId: uuid('return_id').references(() => saleReturns.id),
    method: paymentMethod('method').notNull(),
    amountCents: integer('amount_cents').notNull(),
    tenderedCents: integer('tendered_cents').notNull(),
    changeCents: integer('change_cents').notNull().default(0),
    reference: text('reference'),
    createdAt: createdAt(),
  },
  (t) => [index('payments_shift_idx').on(t.shiftId), index('payments_sale_idx').on(t.saleId)],
);

/** Two-step transfer: stock leaves the source on send and lands at the destination on receive. */
export const transfers = pgTable(
  'transfers',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull().unique(),
    fromStoreId: uuid('from_store_id').notNull().references(() => stores.id),
    toStoreId: uuid('to_store_id').notNull().references(() => stores.id),
    status: transferStatus('status').notNull().default('in_transit'),
    note: text('note').notNull().default(''),
    receiveNote: text('receive_note').notNull().default(''),
    sentBy: uuid('sent_by').notNull().references(() => users.id),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    receivedBy: uuid('received_by').references(() => users.id),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    cancelledBy: uuid('cancelled_by').references(() => users.id),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (t) => [index('transfers_to_status_idx').on(t.toStoreId, t.status), index('transfers_from_idx').on(t.fromStoreId)],
);

export const transferLines = pgTable(
  'transfer_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transferId: uuid('transfer_id').notNull().references(() => transfers.id),
    variantId: uuid('variant_id').notNull().references(() => variants.id),
    qtySent: integer('qty_sent').notNull(),
    qtyReceived: integer('qty_received'),
  },
  (t) => [index('transfer_lines_transfer_idx').on(t.transferId)],
);

/**
 * Weekly working hours per store. Minutes after local midnight in the store's timezone, so a
 * 09:00 start stays 09:00 across daylight-saving changes. Several rows per day = split shifts.
 */
export const staffHours = pgTable(
  'staff_hours',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** ISO weekday: 1 = Monday … 7 = Sunday. */
    weekday: integer('weekday').notNull(),
    startMin: integer('start_min').notNull(),
    endMin: integer('end_min').notNull(),
  },
  (t) => [index('staff_hours_store_user_idx').on(t.storeId, t.userId)],
);

/** Services a team member is trained to perform. */
export const staffServices = pgTable(
  'staff_services',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.productId] })],
);

/**
 * Appointments. Double booking is impossible at the database level: an exclusion constraint
 * (see migration 0003) rejects any two live bookings of the same person whose time ranges overlap,
 * even when both requests arrive at the same moment.
 */
export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Short code the customer quotes at the desk. */
    reference: text('reference').notNull().unique(),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    staffId: uuid('staff_id').notNull().references(() => users.id),
    variantId: uuid('variant_id').notNull().references(() => variants.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: bookingStatus('status').notNull().default('booked'),
    source: bookingSource('source').notNull(),
    customerName: text('customer_name').notNull(),
    customerPhone: text('customer_phone').notNull().default(''),
    customerEmail: text('customer_email').notNull().default(''),
    note: text('note').notNull().default(''),
    /** Price shown when the booking was made; the POS still charges the current catalog price. */
    quotedPriceCents: integer('quoted_price_cents').notNull(),
    saleId: uuid('sale_id').unique().references(() => sales.id),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (t) => [index('bookings_store_starts_idx').on(t.storeId, t.startsAt), index('bookings_staff_starts_idx').on(t.staffId, t.startsAt)],
);
