import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '@/lib/api';
import type { VariantView } from '@/lib/types';

export type Discount = { type: 'percent'; bps: number } | { type: 'amount'; cents: number } | null;

export interface CartLine {
  key: number;
  variant: VariantView;
  qty: number;
  discount: Discount;
  staffId: string | null;
}

export interface Quote {
  subtotalCents: number;
  discountCents: number;
  netCents: number;
  taxCents: number;
  totalCents: number;
  lines: { grossCents: number; lineDiscountCents: number; orderDiscountCents: number; netCents: number; totalCents: number }[];
}

const newRef = () => crypto.randomUUID();

export const useCart = defineStore('cart', () => {
  const lines = ref<CartLine[]>([]);
  const orderDiscount = ref<Discount>(null);
  const customerName = ref('');
  const bookingId = ref<string | null>(null);
  /** Idempotency key for the charge; regenerated only when a new cart starts. */
  const clientRef = ref(newRef());
  const quote = ref<Quote | null>(null);
  const quoteError = ref<string | null>(null);
  let seq = 0;

  const itemCount = computed(() => lines.value.reduce((s, l) => s + l.qty, 0));

  /** Products merge into one line; services stay separate so each can have its own staff member. */
  function add(variant: VariantView, opts: { staffId?: string | null; qty?: number } = {}) {
    const existing = variant.type === 'product' ? lines.value.find((l) => l.variant.id === variant.id) : undefined;
    if (existing) existing.qty += opts.qty ?? 1;
    else lines.value.push({ key: ++seq, variant, qty: opts.qty ?? 1, discount: null, staffId: opts.staffId ?? null });
  }

  function setQty(key: number, qty: number) {
    const line = lines.value.find((l) => l.key === key);
    if (!line) return;
    if (qty <= 0) remove(key);
    else line.qty = Math.floor(qty);
  }

  function remove(key: number) {
    lines.value = lines.value.filter((l) => l.key !== key);
  }

  function clear() {
    lines.value = [];
    orderDiscount.value = null;
    customerName.value = '';
    bookingId.value = null;
    quote.value = null;
    clientRef.value = newRef();
  }

  const payload = (storeId: string) => ({
    storeId,
    lines: lines.value.map((l) => ({ variantId: l.variant.id, qty: l.qty, discount: l.discount, staffId: l.staffId })),
    orderDiscount: orderDiscount.value,
  });

  async function refreshQuote(storeId: string) {
    if (!lines.value.length) {
      quote.value = null;
      return;
    }
    try {
      quote.value = await api.post<Quote>('/sales/quote', payload(storeId));
      quoteError.value = null;
    } catch (e) {
      quoteError.value = (e as Error).message;
    }
  }

  return { lines, orderDiscount, customerName, bookingId, clientRef, quote, quoteError, itemCount, add, setQty, remove, clear, payload, refreshQuote };
});
