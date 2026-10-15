/**
 * Pure money math for the POS. Integer cents only; every split uses the largest-remainder
 * method so parts always add back up to the whole (no lost or invented cents).
 */
import { badRequest } from './errors.js';

export type Discount = { type: 'percent'; bps: number } | { type: 'amount'; cents: number } | null | undefined;

export interface PriceLineInput {
  unitPriceCents: number;
  qty: number;
  discount?: Discount;
}

export interface PricedLine {
  unitPriceCents: number;
  qty: number;
  grossCents: number;
  lineDiscountCents: number;
  orderDiscountCents: number;
  /** After both discounts, before tax. */
  netCents: number;
  taxCents: number;
  /** What the customer pays for this line (net + tax). */
  totalCents: number;
}

export interface PricedCart {
  lines: PricedLine[];
  subtotalCents: number;
  discountCents: number;
  netCents: number;
  taxCents: number;
  totalCents: number;
}

/** a * bps / 10000, rounded half up (inputs are non-negative). */
const ofBps = (cents: number, bps: number) => Math.floor((cents * bps + 5000) / 10000);

const discountOn = (base: number, d: Discount) => {
  if (!d) return 0;
  const raw = d.type === 'percent' ? ofBps(base, Math.min(Math.max(d.bps, 0), 10000)) : Math.max(d.cents, 0);
  return Math.min(raw, base);
};

/** Split `total` in proportion to `weights` (largest remainder, ties to the earliest index). */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total === 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const parts = exact.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, frac: e - Math.floor(e) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    parts[i]! += 1;
    left -= 1;
  }
  return parts;
}

export function priceCart(input: PriceLineInput[], orderDiscount: Discount, taxRateBps: number): PricedCart {
  for (const l of input) {
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw badRequest('BAD_QTY', 'Quantity must be a positive whole number');
    if (!Number.isInteger(l.unitPriceCents) || l.unitPriceCents < 0) throw badRequest('BAD_PRICE', 'Price must be a non-negative amount in cents');
  }
  const afterLine = input.map((l) => {
    const grossCents = l.unitPriceCents * l.qty;
    const lineDiscountCents = discountOn(grossCents, l.discount);
    return { ...l, grossCents, lineDiscountCents, base: grossCents - lineDiscountCents };
  });
  const baseTotal = afterLine.reduce((s, l) => s + l.base, 0);
  const orderDiscountTotal = discountOn(baseTotal, orderDiscount);
  const orderShares = allocate(orderDiscountTotal, afterLine.map((l) => l.base));
  const nets = afterLine.map((l, i) => l.base - orderShares[i]!);
  const netCents = nets.reduce((a, b) => a + b, 0);
  const taxCents = ofBps(netCents, taxRateBps);
  const taxShares = allocate(taxCents, nets);

  const lines = afterLine.map<PricedLine>((l, i) => ({
    unitPriceCents: l.unitPriceCents,
    qty: l.qty,
    grossCents: l.grossCents,
    lineDiscountCents: l.lineDiscountCents,
    orderDiscountCents: orderShares[i]!,
    netCents: nets[i]!,
    taxCents: taxShares[i]!,
    totalCents: nets[i]! + taxShares[i]!,
  }));
  const subtotalCents = lines.reduce((s, l) => s + l.grossCents, 0);
  return { lines, subtotalCents, discountCents: subtotalCents - netCents, netCents, taxCents, totalCents: netCents + taxCents };
}

/**
 * Refund for returning `returning` units of a line that sold `soldQty` units for `lineAmount`,
 * when `alreadyReturned` units were refunded before. Cumulative rounding guarantees that the
 * refunds of all units together equal the original line amount exactly.
 */
export function refundShare(lineAmount: number, soldQty: number, alreadyReturned: number, returning: number): number {
  if (returning <= 0 || alreadyReturned < 0 || alreadyReturned + returning > soldQty) {
    throw badRequest('RETURN_QTY', 'Cannot return more units than were sold');
  }
  const upTo = (n: number) => Math.floor((lineAmount * n * 2 + soldQty) / (soldQty * 2)); // round half up
  return upTo(alreadyReturned + returning) - upTo(alreadyReturned);
}

export type PaymentMethod = 'cash' | 'card' | 'other';
export interface PaymentInput {
  method: PaymentMethod;
  amountCents: number;
  reference?: string | null;
}
export interface SettledPayment {
  method: PaymentMethod;
  /** Amount applied to the sale (cash net of change). */
  amountCents: number;
  tenderedCents: number;
  changeCents: number;
  reference: string | null;
}

/** Validates tenders against the total. Only cash can be over-tendered; the excess is change. */
export function settlePayments(totalCents: number, input: PaymentInput[]): { payments: SettledPayment[]; changeCents: number } {
  const tendered = input.reduce((s, p) => s + p.amountCents, 0);
  if (input.some((p) => !Number.isInteger(p.amountCents) || p.amountCents <= 0)) throw badRequest('BAD_PAYMENT', 'Payment amounts must be positive');
  if (tendered < totalCents) throw badRequest('UNDERPAID', `Payment is short by ${totalCents - tendered} cents`);
  const over = tendered - totalCents;
  const cashTendered = input.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amountCents, 0);
  if (over > cashTendered) throw badRequest('NO_CHANGE_ON_CARD', 'Only cash can be over-tendered (change is given in cash)');

  let changeLeft = over;
  const payments = input.map<SettledPayment>((p) => {
    let change = 0;
    if (p.method === 'cash' && changeLeft > 0) {
      change = Math.min(changeLeft, p.amountCents);
      changeLeft -= change;
    }
    return { method: p.method, amountCents: p.amountCents - change, tenderedCents: p.amountCents, changeCents: change, reference: p.reference ?? null };
  });
  return { payments, changeCents: over };
}
