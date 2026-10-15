import { describe, expect, it } from 'vitest';
import { allocate, priceCart, refundShare, settlePayments } from './money.js';

describe('allocate (largest remainder)', () => {
  it('splits exactly, with no cent lost or invented', () => {
    expect(allocate(100, [1000, 1000, 1000])).toEqual([34, 33, 33]);
    expect(allocate(1, [1, 1])).toEqual([1, 0]);
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
    expect(allocate(500, [0, 0])).toEqual([0, 0]);
    const parts = allocate(997, [1999, 3, 450, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(997);
  });
});

describe('priceCart', () => {
  it('applies a percent line discount with half-up rounding', () => {
    const c = priceCart([{ unitPriceCents: 1999, qty: 3, discount: { type: 'percent', bps: 1000 } }], null, 0);
    expect(c.lines[0]).toMatchObject({ grossCents: 5997, lineDiscountCents: 600, netCents: 5397 });
    expect(c.totalCents).toBe(5397);
  });

  it('caps an amount discount at the line value', () => {
    const c = priceCart([{ unitPriceCents: 500, qty: 1, discount: { type: 'amount', cents: 900 } }], null, 0);
    expect(c.lines[0]!.netCents).toBe(0);
    expect(c.discountCents).toBe(500);
  });

  it('spreads the order discount across lines so line nets add up to the order', () => {
    const c = priceCart(
      [
        { unitPriceCents: 1000, qty: 1 },
        { unitPriceCents: 1000, qty: 1 },
        { unitPriceCents: 1000, qty: 1 },
      ],
      { type: 'amount', cents: 100 },
      0,
    );
    expect(c.lines.map((l) => l.orderDiscountCents)).toEqual([34, 33, 33]);
    expect(c.netCents).toBe(2900);
    expect(c.lines.reduce((s, l) => s + l.netCents, 0)).toBe(c.netCents);
  });

  it('computes tax once on the order and allocates it to lines', () => {
    // 8.88 % of 33.33 = 2.9597 -> 2.96
    const c = priceCart(
      [
        { unitPriceCents: 1111, qty: 1 },
        { unitPriceCents: 1111, qty: 2 },
      ],
      null,
      888,
    );
    expect(c.netCents).toBe(3333);
    expect(c.taxCents).toBe(296);
    expect(c.lines.reduce((s, l) => s + l.taxCents, 0)).toBe(296);
    expect(c.totalCents).toBe(3629);
    expect(c.lines.reduce((s, l) => s + l.totalCents, 0)).toBe(3629);
  });

  it('rejects non-positive quantities and negative prices', () => {
    expect(() => priceCart([{ unitPriceCents: 100, qty: 0 }], null, 0)).toThrow();
    expect(() => priceCart([{ unitPriceCents: -1, qty: 1 }], null, 0)).toThrow();
  });
});

describe('refundShare', () => {
  it('refunds partial returns so that all returns together equal the line total exactly', () => {
    const total = 1000;
    const first = refundShare(total, 3, 0, 1);
    const second = refundShare(total, 3, 1, 1);
    const third = refundShare(total, 3, 2, 1);
    expect([first, second, third]).toEqual([333, 334, 333]);
    expect(first + second + third).toBe(total);
    expect(refundShare(total, 3, 0, 3)).toBe(1000);
  });

  it('refuses to refund more units than were sold', () => {
    expect(() => refundShare(1000, 3, 2, 2)).toThrow();
  });
});

describe('settlePayments', () => {
  it('gives change from cash only', () => {
    const s = settlePayments(2500, [
      { method: 'card', amountCents: 1000 },
      { method: 'cash', amountCents: 2000 },
    ]);
    expect(s.changeCents).toBe(500);
    expect(s.payments).toEqual([
      { method: 'card', amountCents: 1000, tenderedCents: 1000, changeCents: 0, reference: null },
      { method: 'cash', amountCents: 1500, tenderedCents: 2000, changeCents: 500, reference: null },
    ]);
  });

  it('rejects underpayment', () => {
    expect(() => settlePayments(2500, [{ method: 'card', amountCents: 2000 }])).toThrow(/short/i);
  });

  it('rejects overpaying with a card', () => {
    expect(() => settlePayments(2500, [{ method: 'card', amountCents: 3000 }])).toThrow(/change/i);
  });

  it('accepts a zero-total sale with no payment', () => {
    expect(settlePayments(0, []).payments).toEqual([]);
  });
});
