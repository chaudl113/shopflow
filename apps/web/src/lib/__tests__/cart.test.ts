import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import type { VariantView } from '@/lib/types';
import { quickCash, tenderStatus } from '@/lib/tender';
import { useCart } from '@/stores/cart';

const variant = (over: Partial<VariantView> = {}): VariantView => ({
  id: 'v1', productId: 'p1', productName: 'Shampoo', name: 'Default', label: 'Shampoo', sku: 'SH', barcode: null,
  type: 'product', category: 'Hair', durationMin: null, priceCents: 1000, defaultPriceCents: 1000, storePriceCents: null,
  costCents: 0, reorderLevel: 0, active: true, onHand: 5, ...over,
});

describe('cart store', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('merges repeated scans of the same product into one line', () => {
    const cart = useCart();
    cart.add(variant());
    cart.add(variant());
    expect(cart.lines).toHaveLength(1);
    expect(cart.itemCount).toBe(2);
  });

  it('keeps each service on its own line (one stylist per line)', () => {
    const cart = useCart();
    const cut = variant({ id: 's1', type: 'service' });
    cart.add(cut, { staffId: 'a' });
    cart.add(cut, { staffId: 'b' });
    expect(cart.lines.map((l) => l.staffId)).toEqual(['a', 'b']);
  });

  it('removes a line when quantity goes to zero', () => {
    const cart = useCart();
    cart.add(variant());
    cart.setQty(cart.lines[0]!.key, 0);
    expect(cart.lines).toHaveLength(0);
  });

  it('starts a new idempotency key only for a new cart', () => {
    const cart = useCart();
    const first = cart.clientRef;
    cart.add(variant());
    expect(cart.clientRef).toBe(first);
    cart.clear();
    expect(cart.clientRef).not.toBe(first);
  });
});

describe('tender', () => {
  it('computes due and change, and rejects change on card', () => {
    expect(tenderStatus(2500, [{ method: 'cash', amountCents: 4000 }])).toMatchObject({ dueCents: 0, changeCents: 1500, valid: true });
    expect(tenderStatus(2500, [{ method: 'card', amountCents: 1000 }])).toMatchObject({ dueCents: 1500, valid: false });
    expect(tenderStatus(2500, [{ method: 'card', amountCents: 3000 }]).valid).toBe(false);
    expect(tenderStatus(2500, [{ method: 'card', amountCents: 1000 }, { method: 'cash', amountCents: 2000 }])).toMatchObject({ changeCents: 500, valid: true });
  });

  it('suggests exact cash and the next round bills', () => {
    expect(quickCash(2350)).toEqual([2350, 2500, 3000, 4000, 5000]);
    expect(quickCash(0)).toEqual([]);
  });
});
