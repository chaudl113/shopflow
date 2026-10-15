<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import BarcodeScanner from '@/components/BarcodeScanner.vue';
import Modal from '@/components/Modal.vue';
import OpenShiftForm from '@/components/OpenShiftForm.vue';
import PayModal from '@/components/PayModal.vue';
import { api, ApiError } from '@/lib/api';
import { money, parseMoney } from '@/lib/format';
import type { Method } from '@/lib/tender';
import type { TeamMember, VariantView } from '@/lib/types';
import { useCart, type CartLine, type Discount } from '@/stores/cart';
import { useSession } from '@/stores/session';
import { useShift } from '@/stores/shift';
import { useToast } from '@/stores/toast';

const session = useSession();
const shift = useShift();
const cart = useCart();
const toast = useToast();
const storeId = session.storeId!;

const catalog = ref<VariantView[]>([]);
const staff = ref<TeamMember[]>([]);
const category = ref('All');
const search = ref('');
const scanInput = ref<HTMLInputElement | null>(null);
const scanning = ref(false);
const paying = ref(false);
const busy = ref(false);
const completed = ref<{ id: string; number: string; totalCents: number; changeCents: number } | null>(null);
const cartOpen = ref(false);

const categories = computed(() => ['All', ...new Set(catalog.value.map((v) => v.category))]);
const shown = computed(() => {
  const q = search.value.trim().toLowerCase();
  return catalog.value.filter((v) => (category.value === 'All' || v.category === category.value) && (!q || v.label.toLowerCase().includes(q) || v.sku.toLowerCase().includes(q)));
});
const isWarehouse = computed(() => session.currentStore?.kind === 'warehouse');

onMounted(async () => {
  if (isWarehouse.value) return;
  await shift.load(storeId);
  const [v, u] = await Promise.all([
    api.get<{ variants: VariantView[] }>('/products/variants', { storeId }),
    api.get<{ users: TeamMember[] }>('/users'),
  ]);
  catalog.value = v.variants;
  staff.value = u.users.filter((x) => x.bookable && x.active && x.storeIds.includes(storeId));
  await cart.refreshQuote(storeId);
  focusScan();
});

let quoteTimer: ReturnType<typeof setTimeout>;
watch(
  () => [cart.lines.map((l) => [l.variant.id, l.qty, l.discount, l.staffId]), cart.orderDiscount],
  () => {
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(() => cart.refreshQuote(storeId), 120);
  },
  { deep: true },
);

function focusScan() {
  nextTick(() => scanInput.value?.focus());
}

function addVariant(v: VariantView) {
  if (v.type === 'product' && v.onHand !== null && v.onHand <= 0 && !session.currentStore?.allowNegativeStock) {
    toast.error(`${v.label} is out of stock here`);
    return;
  }
  cart.add(v, { staffId: v.type === 'service' && staff.value.length === 1 ? staff.value[0]!.id : null });
}

async function onScan(code: string) {
  code = code.trim();
  if (!code) return;
  try {
    const res = await api.get<{ variant: VariantView }>('/products/lookup', { storeId, code });
    addVariant(res.variant);
  } catch (e) {
    toast.error(e instanceof ApiError && e.status === 404 ? `No item with code ${code}` : e);
  }
}
function onScanEnter(e: Event) {
  const input = e.target as HTMLInputElement;
  onScan(input.value);
  input.value = '';
}
function onCameraDetected(code: string) {
  scanning.value = false;
  onScan(code);
}

// Line editing
const editing = ref<CartLine | null>(null);
const editDiscountType = ref<'percent' | 'amount'>('percent');
const editDiscountValue = ref('');
function editLine(l: CartLine) {
  editing.value = l;
  editDiscountType.value = l.discount?.type ?? 'percent';
  editDiscountValue.value = !l.discount ? '' : l.discount.type === 'percent' ? String(l.discount.bps / 100) : (l.discount.cents / 100).toFixed(2);
}
function toDiscount(type: 'percent' | 'amount', value: string): Discount {
  if (!value.trim()) return null;
  if (type === 'percent') {
    const pct = Number(value);
    return Number.isFinite(pct) && pct > 0 ? { type: 'percent', bps: Math.round(Math.min(pct, 100) * 100) } : null;
  }
  const cents = parseMoney(value);
  return cents ? { type: 'amount', cents } : null;
}
function saveLine() {
  if (!editing.value) return;
  editing.value.discount = toDiscount(editDiscountType.value, editDiscountValue.value);
  editing.value = null;
}

// Order discount
const orderDiscOpen = ref(false);
const orderDiscType = ref<'percent' | 'amount'>('percent');
const orderDiscValue = ref('');
function saveOrderDiscount() {
  cart.orderDiscount = toDiscount(orderDiscType.value, orderDiscValue.value);
  orderDiscOpen.value = false;
}

async function pay(tenders: { method: Method; amountCents: number }[]) {
  busy.value = true;
  try {
    const res = await api.post<{ sale: { id: string; number: string; totalCents: number; changeCents: number } }>('/sales', {
      ...cart.payload(storeId),
      payments: tenders,
      customerName: cart.customerName || undefined,
      bookingId: cart.bookingId ?? undefined,
      clientRef: cart.clientRef,
    });
    completed.value = res.sale;
    paying.value = false;
    cartOpen.value = false;
    cart.clear();
    // Refresh stock badges and the drawer total.
    catalog.value = (await api.get<{ variants: VariantView[] }>('/products/variants', { storeId })).variants;
    shift.load(storeId);
  } catch (e) {
    toast.error(e);
  } finally {
    busy.value = false;
  }
}

function printReceipt(id: string) {
  window.open(`/receipt/${id}?print=1`, '_blank', 'width=420,height=720');
}
function newSale() {
  completed.value = null;
  focusScan();
}
const lineQuote = (i: number) => cart.quote?.lines[i];
</script>

<template>
  <div v-if="isWarehouse" class="card p-8 text-center text-slate-500">Warehouses do not sell. Switch to a store to use the POS.</div>
  <div v-else-if="!shift.loaded" class="py-20 text-center text-slate-400">Loading…</div>
  <OpenShiftForm v-else-if="!shift.current" class="mt-10" />

  <div v-else class="grid gap-4 lg:grid-cols-[1fr_380px]">
    <!-- Catalog -->
    <section class="min-w-0">
      <div class="mb-3 flex gap-2">
        <input
          ref="scanInput"
          class="input flex-1 font-mono"
          placeholder="Scan or type barcode / SKU and press Enter"
          aria-label="Scan barcode"
          autocomplete="off"
          @keydown.enter.prevent="onScanEnter"
        />
        <button class="btn-secondary" title="Scan with camera" @click="scanning = true">📷 <span class="hidden sm:inline">Camera</span></button>
      </div>
      <div class="mb-3 flex gap-2 overflow-x-auto pb-1">
        <button
          v-for="c in categories"
          :key="c"
          class="btn shrink-0 border px-3 py-1.5"
          :class="category === c ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600'"
          @click="category = c"
        >
          {{ c }}
        </button>
        <input v-model="search" class="input ml-auto w-40 shrink-0 py-1.5" placeholder="Filter…" aria-label="Filter products" />
      </div>
      <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
        <button
          v-for="v in shown"
          :key="v.id"
          class="card flex h-28 flex-col justify-between p-3 text-left transition hover:border-indigo-300 hover:shadow active:scale-[0.98]"
          :class="v.type === 'product' && (v.onHand ?? 0) <= 0 ? 'opacity-50' : ''"
          :data-testid="`tile-${v.sku}`"
          @click="addVariant(v)"
        >
          <div class="line-clamp-2 text-sm font-medium leading-snug">{{ v.label }}</div>
          <div class="flex items-end justify-between">
            <span class="font-semibold tabular-nums">{{ money(v.priceCents) }}</span>
            <span v-if="v.type === 'service'" class="badge bg-violet-50 text-violet-700">{{ v.durationMin }}m</span>
            <span v-else class="badge" :class="(v.onHand ?? 0) <= v.reorderLevel ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'">{{ v.onHand }} left</span>
          </div>
        </button>
      </div>
    </section>

    <!-- Cart -->
    <aside
      class="card fixed inset-x-0 bottom-0 z-20 flex max-h-[85vh] flex-col rounded-b-none lg:sticky lg:top-20 lg:z-0 lg:max-h-[calc(100vh-7rem)] lg:rounded-b-xl"
      :class="cartOpen ? '' : 'max-lg:translate-y-[calc(100%-4.5rem)]'"
      aria-label="Cart"
    >
      <button class="flex items-center justify-between border-b border-slate-200 px-4 py-3 lg:pointer-events-none" @click="cartOpen = !cartOpen">
        <span class="font-semibold">Cart <span class="text-slate-400">· {{ cart.itemCount }} items</span></span>
        <span class="text-lg font-semibold tabular-nums lg:hidden">{{ money(cart.quote?.totalCents ?? 0) }}</span>
      </button>
      <div class="flex-1 overflow-y-auto">
        <p v-if="!cart.lines.length" class="px-4 py-10 text-center text-sm text-slate-400">Scan an item or tap a product to start a sale.</p>
        <ul class="divide-y divide-slate-100">
          <li v-for="(l, i) in cart.lines" :key="l.key" class="px-4 py-2.5" data-testid="cart-line">
            <div class="flex items-start justify-between gap-2">
              <button class="min-w-0 text-left" @click="editLine(l)">
                <div class="truncate text-sm font-medium">{{ l.variant.label }}</div>
                <div class="text-xs text-slate-500">
                  {{ money(l.variant.priceCents) }}
                  <span v-if="l.discount" class="text-emerald-600">· −{{ l.discount.type === 'percent' ? l.discount.bps / 100 + '%' : money(l.discount.cents) }}</span>
                  <span v-if="l.variant.type === 'service'" :class="l.staffId ? 'text-violet-600' : 'text-amber-600'">
                    · {{ staff.find((s) => s.id === l.staffId)?.name ?? 'pick staff' }}
                  </span>
                </div>
              </button>
              <div class="text-right text-sm font-medium tabular-nums">{{ money(lineQuote(i)?.netCents ?? l.variant.priceCents * l.qty) }}</div>
            </div>
            <div class="mt-1.5 flex items-center gap-1">
              <button class="btn-secondary h-7 w-7 p-0" :aria-label="`Decrease ${l.variant.label}`" @click="cart.setQty(l.key, l.qty - 1)">−</button>
              <span class="w-8 text-center text-sm tabular-nums">{{ l.qty }}</span>
              <button class="btn-secondary h-7 w-7 p-0" :aria-label="`Increase ${l.variant.label}`" @click="cart.setQty(l.key, l.qty + 1)">+</button>
              <button class="btn-ghost ml-auto px-2 py-1 text-xs text-slate-500" @click="editLine(l)">Edit</button>
            </div>
          </li>
        </ul>
      </div>
      <div class="border-t border-slate-200 p-4">
        <input v-model="cart.customerName" class="input mb-3 py-1.5" placeholder="Customer name (optional)" aria-label="Customer name" />
        <dl class="space-y-1 text-sm">
          <div class="flex justify-between"><dt class="text-slate-500">Subtotal</dt><dd class="tabular-nums">{{ money(cart.quote?.subtotalCents) }}</dd></div>
          <div class="flex justify-between">
            <dt>
              <button class="text-slate-500 underline decoration-dotted" :disabled="!cart.lines.length" @click="orderDiscOpen = true">Discount</button>
            </dt>
            <dd class="tabular-nums text-emerald-600">−{{ money(cart.quote?.discountCents) }}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-slate-500">Tax ({{ ((session.currentStore?.taxRateBps ?? 0) / 100).toFixed(2) }}%)</dt>
            <dd class="tabular-nums">{{ money(cart.quote?.taxCents) }}</dd>
          </div>
          <div class="flex justify-between pt-1 text-lg font-semibold"><dt>Total</dt><dd class="tabular-nums" data-testid="cart-total">{{ money(cart.quote?.totalCents) }}</dd></div>
        </dl>
        <p v-if="cart.quoteError" class="mt-2 text-xs text-rose-600">{{ cart.quoteError }}</p>
        <div class="mt-3 flex gap-2">
          <button class="btn-secondary" :disabled="!cart.lines.length" @click="cart.clear()">Clear</button>
          <button
            class="btn-primary flex-1 py-3 text-base"
            :disabled="!cart.quote || !!cart.quoteError || cart.lines.some((l) => l.variant.type === 'service' && !l.staffId)"
            @click="paying = true"
          >
            Charge {{ money(cart.quote?.totalCents) }}
          </button>
        </div>
        <p v-if="cart.lines.some((l) => l.variant.type === 'service' && !l.staffId)" class="mt-2 text-xs text-amber-600">Pick who performed each service.</p>
      </div>
    </aside>
  </div>

  <BarcodeScanner v-if="scanning" @detected="onCameraDetected" @close="scanning = false" />
  <PayModal v-if="paying && cart.quote" :total-cents="cart.quote.totalCents" :busy="busy" @close="paying = false" @pay="pay" />

  <Modal v-if="editing" :title="editing.variant.label" @close="editing = null">
    <div class="space-y-4">
      <div>
        <label class="label" for="line-qty">Quantity</label>
        <input id="line-qty" v-model.number="editing.qty" type="number" min="1" class="input" />
      </div>
      <div>
        <span class="label">Line discount</span>
        <div class="flex gap-2">
          <select v-model="editDiscountType" class="input w-24" aria-label="Discount type">
            <option value="percent">%</option>
            <option value="amount">$</option>
          </select>
          <input v-model="editDiscountValue" class="input" inputmode="decimal" placeholder="0" aria-label="Discount value" />
        </div>
      </div>
      <div v-if="editing.variant.type === 'service'">
        <label class="label" for="line-staff">Performed by</label>
        <select id="line-staff" v-model="editing.staffId" class="input">
          <option :value="null" disabled>Select staff</option>
          <option v-for="s in staff" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </div>
    </div>
    <template #footer>
      <button class="btn-ghost mr-auto text-rose-600" @click="cart.remove(editing.key); editing = null">Remove</button>
      <button class="btn-primary" @click="saveLine">Done</button>
    </template>
  </Modal>

  <Modal v-if="orderDiscOpen" title="Order discount" @close="orderDiscOpen = false">
    <div class="flex gap-2">
      <select v-model="orderDiscType" class="input w-24" aria-label="Discount type">
        <option value="percent">%</option>
        <option value="amount">$</option>
      </select>
      <input v-model="orderDiscValue" class="input" inputmode="decimal" placeholder="0" aria-label="Order discount value" />
    </div>
    <p class="mt-2 text-xs text-slate-500">Spread across lines proportionally, so partial returns refund the right amount.</p>
    <template #footer>
      <button class="btn-secondary" @click="orderDiscValue = ''; saveOrderDiscount()">Remove</button>
      <button class="btn-primary" @click="saveOrderDiscount">Apply</button>
    </template>
  </Modal>

  <Modal v-if="completed" title="Sale complete" @close="newSale">
    <div class="text-center">
      <div class="mb-2 text-4xl">✅</div>
      <div class="text-sm text-slate-500">Receipt {{ completed.number }}</div>
      <div class="text-2xl font-semibold tabular-nums">{{ money(completed.totalCents) }}</div>
      <div v-if="completed.changeCents" class="mt-3 rounded-lg bg-emerald-50 p-3 text-lg font-semibold text-emerald-700">Change due {{ money(completed.changeCents) }}</div>
    </div>
    <template #footer>
      <button class="btn-secondary" @click="printReceipt(completed.id)">Print receipt</button>
      <button class="btn-primary" @click="newSale">New sale</button>
    </template>
  </Modal>
</template>
