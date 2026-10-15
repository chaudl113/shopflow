<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { CalendarDaysIcon, CameraIcon, CircleCheckIcon, GlobeIcon, MinusIcon, PlusIcon, PrinterIcon, ScanBarcodeIcon, SearchIcon, ShoppingCartIcon, Trash2Icon, WarehouseIcon, XIcon } from '@lucide/vue';
import { DateTime } from 'luxon';
import { useRoute } from 'vue-router';
import BarcodeScanner from '@/components/BarcodeScanner.vue';
import Modal from '@/components/Modal.vue';
import OpenShiftForm from '@/components/OpenShiftForm.vue';
import PayModal from '@/components/PayModal.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { api, ApiError } from '@/lib/api';
import { statusLabel, type Booking } from '@/lib/booking';
import { money, parseMoney } from '@/lib/format';
import type { Method } from '@/lib/tender';
import type { TeamMember, VariantView } from '@/lib/types';
import { useCart, type CartLine, type Discount } from '@/stores/cart';
import { useSession } from '@/stores/session';
import { useShift } from '@/stores/shift';
import { toast } from '@/lib/notify';

const session = useSession();
const shift = useShift();
const cart = useCart();
const storeId = session.storeId!;

const catalog = ref<VariantView[]>([]);
const staff = ref<TeamMember[]>([]);
const category = ref('All');
const search = ref('');
const scanning = ref(false);
const paying = ref(false);
const busy = ref(false);
const completed = ref<{ id: string; number: string; totalCents: number; changeCents: number } | null>(null);
const cartOpen = ref(false);
const route = useRoute();
const tz = computed(() => session.currentStore?.timezone ?? 'America/New_York');

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
  if (typeof route.query.booking === 'string') {
    try {
      const { booking } = await api.get<{ booking: Booking }>(`/bookings/${route.query.booking}`);
      if (booking.status === 'booked') checkoutBooking(booking);
      else toast.info(`${booking.reference} is already ${statusLabel[booking.status].toLowerCase()}`);
    } catch (e) {
      toast.error(e);
    }
  }
  focusScan();
});

// Appointments: today's bookings can be pulled into the cart and are marked paid with the sale.
const apptOpen = ref(false);
const appts = ref<Booking[]>([]);
const bookingInfo = ref<Booking | null>(null);
async function openAppointments() {
  apptOpen.value = true;
  const day = DateTime.now().setZone(tz.value).startOf('day');
  appts.value = (
    await api.get<{ bookings: Booking[] }>('/bookings', { storeId, from: day.toUTC().toISO(), to: day.plus({ days: 1 }).toUTC().toISO() })
  ).bookings.filter((b) => b.status === 'booked' || b.status === 'completed');
}
function checkoutBooking(b: Booking) {
  const v = catalog.value.find((x) => x.id === b.variantId);
  if (!v) return toast.error(`${b.serviceName} is not on sale at this store`);
  cart.clear();
  cart.add(v, { staffId: b.staffId });
  cart.customerName = b.customerName;
  cart.bookingId = b.id;
  bookingInfo.value = b;
  apptOpen.value = false;
  cartOpen.value = true;
}
watch(
  () => cart.bookingId,
  (id) => {
    if (!id) bookingInfo.value = null;
  },
);
const apptTime = (iso: string) => DateTime.fromISO(iso).setZone(tz.value).toFormat('h:mm a');

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
  nextTick(() => document.getElementById('scan-input')?.focus());
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
const staffName = (id: string | null) => staff.value.find((s) => s.id === id)?.name;
// Toggle groups emit '' when the active item is clicked again; ignore that so a type is always selected.
function setLineDiscType(v: unknown) {
  if (v) editDiscountType.value = v as 'percent' | 'amount';
}
function setOrderDiscType(v: unknown) {
  if (v) orderDiscType.value = v as 'percent' | 'amount';
}
</script>

<template>
  <Empty v-if="isWarehouse" class="border">
    <EmptyHeader>
      <EmptyMedia variant="icon"><WarehouseIcon /></EmptyMedia>
      <EmptyTitle>Warehouses do not sell</EmptyTitle>
      <EmptyDescription>Switch to a store to use the POS.</EmptyDescription>
    </EmptyHeader>
  </Empty>
  <div v-else-if="!shift.loaded" class="grid grid-cols-2 gap-2.5 sm:grid-cols-4"><Skeleton v-for="n in 8" :key="n" class="h-28 rounded-xl" /></div>
  <OpenShiftForm v-else-if="!shift.current" class="mt-10" />

  <div v-else class="grid gap-4 lg:grid-cols-[1fr_380px]">
    <!-- Catalog -->
    <section class="min-w-0">
      <div class="mb-3 flex gap-2">
        <InputGroup class="h-10 flex-1">
          <InputGroupAddon><ScanBarcodeIcon /></InputGroupAddon>
          <InputGroupInput
            id="scan-input"
            class="font-mono"
            placeholder="Scan or type barcode / SKU and press Enter"
            aria-label="Scan barcode"
            autocomplete="off"
            @keydown.enter.prevent="onScanEnter"
          />
        </InputGroup>
        <Button variant="outline" class="h-10" title="Scan with camera" @click="scanning = true"><CameraIcon /> <span class="hidden sm:inline">Camera</span></Button>
        <Button variant="outline" class="h-10" title="Today's appointments" @click="openAppointments"><CalendarDaysIcon /> <span class="hidden sm:inline">Appointments</span></Button>
      </div>
      <div class="mb-3 flex items-center gap-2">
        <div class="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1">
          <Button v-for="c in categories" :key="c" size="sm" class="shrink-0 rounded-full" :variant="category === c ? 'default' : 'outline'" @click="category = c">{{ c }}</Button>
        </div>
        <InputGroup class="w-40 shrink-0">
          <InputGroupAddon><SearchIcon /></InputGroupAddon>
          <InputGroupInput v-model="search" placeholder="Filter…" aria-label="Filter products" />
        </InputGroup>
      </div>
      <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
        <button
          v-for="v in shown"
          :key="v.id"
          class="flex h-28 flex-col justify-between rounded-xl bg-card p-3 text-left text-card-foreground shadow-xs ring-1 ring-foreground/10 transition hover:ring-primary/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.98]"
          :class="v.type === 'product' && (v.onHand ?? 0) <= 0 ? 'opacity-50' : ''"
          :data-testid="`tile-${v.sku}`"
          @click="addVariant(v)"
        >
          <div class="line-clamp-2 text-sm font-medium leading-snug">{{ v.label }}</div>
          <div class="flex items-end justify-between">
            <span class="font-semibold tabular-nums">{{ money(v.priceCents) }}</span>
            <Badge v-if="v.type === 'service'" variant="secondary" class="bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300">{{ v.durationMin }}m</Badge>
            <Badge v-else :variant="(v.onHand ?? 0) <= v.reorderLevel ? 'outline' : 'secondary'" :class="(v.onHand ?? 0) <= v.reorderLevel ? 'border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400' : ''">{{ v.onHand }} left</Badge>
          </div>
        </button>
      </div>
    </section>

    <!-- Cart -->
    <aside
      class="flex flex-col overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10 fixed inset-x-0 bottom-0 z-20 max-h-[85vh] rounded-b-none transition-transform lg:sticky lg:top-20 lg:z-0 lg:max-h-[calc(100vh-7rem)] lg:rounded-b-xl"
      :class="cartOpen ? '' : 'max-lg:translate-y-[calc(100%-4.5rem)]'"
      aria-label="Cart"
    >
      <button class="flex items-center justify-between border-b px-4 py-3 lg:pointer-events-none" @click="cartOpen = !cartOpen">
        <span class="flex items-center gap-2 font-semibold"><ShoppingCartIcon class="size-4" /> Cart <span class="font-normal text-muted-foreground">· {{ cart.itemCount }} items</span></span>
        <span class="text-lg font-semibold tabular-nums lg:hidden">{{ money(cart.quote?.totalCents ?? 0) }}</span>
      </button>
      <div v-if="bookingInfo" class="flex items-center gap-2 border-b bg-primary/5 px-4 py-2 text-sm" data-testid="cart-booking">
        <CalendarDaysIcon class="size-4 text-primary" />
        <span class="min-w-0 flex-1 truncate">Booking <span class="font-mono font-medium">{{ bookingInfo.reference }}</span> · {{ apptTime(bookingInfo.startsAt) }} · {{ bookingInfo.staffName }}</span>
        <Button variant="ghost" size="icon-xs" aria-label="Detach booking" @click="cart.bookingId = null"><XIcon /></Button>
      </div>
      <div class="flex-1 overflow-y-auto">
        <p v-if="!cart.lines.length" class="px-4 py-10 text-center text-sm text-muted-foreground">Scan an item or tap a product to start a sale.</p>
        <ul class="divide-y">
          <li v-for="(l, i) in cart.lines" :key="l.key" class="px-4 py-2.5" data-testid="cart-line">
            <div class="flex items-start justify-between gap-2">
              <button class="min-w-0 text-left" @click="editLine(l)">
                <div class="truncate text-sm font-medium">{{ l.variant.label }}</div>
                <div class="text-xs text-muted-foreground">
                  {{ money(l.variant.priceCents) }}
                  <span v-if="l.discount" class="text-emerald-600 dark:text-emerald-400">· −{{ l.discount.type === 'percent' ? l.discount.bps / 100 + '%' : money(l.discount.cents) }}</span>
                  <span v-if="l.variant.type === 'service'" :class="l.staffId ? 'text-violet-600 dark:text-violet-400' : 'text-amber-600'">
                    · {{ staffName(l.staffId) ?? 'pick staff' }}
                  </span>
                </div>
              </button>
              <div class="text-right text-sm font-medium tabular-nums">{{ money(lineQuote(i)?.netCents ?? l.variant.priceCents * l.qty) }}</div>
            </div>
            <div class="mt-1.5 flex items-center gap-1">
              <Button variant="outline" size="icon-xs" :aria-label="`Decrease ${l.variant.label}`" @click="cart.setQty(l.key, l.qty - 1)"><MinusIcon /></Button>
              <span class="w-8 text-center text-sm tabular-nums">{{ l.qty }}</span>
              <Button variant="outline" size="icon-xs" :aria-label="`Increase ${l.variant.label}`" @click="cart.setQty(l.key, l.qty + 1)"><PlusIcon /></Button>
              <Button variant="ghost" size="xs" class="ml-auto text-muted-foreground" @click="editLine(l)">Edit</Button>
            </div>
          </li>
        </ul>
      </div>
      <div class="border-t p-4">
        <Input v-model="cart.customerName" class="mb-3" placeholder="Customer name (optional)" aria-label="Customer name" />
        <dl class="space-y-1 text-sm">
          <div class="flex justify-between"><dt class="text-muted-foreground">Subtotal</dt><dd class="tabular-nums">{{ money(cart.quote?.subtotalCents) }}</dd></div>
          <div class="flex justify-between">
            <dt>
              <button class="text-muted-foreground underline decoration-dotted underline-offset-2 disabled:opacity-50" :disabled="!cart.lines.length" @click="orderDiscOpen = true">Discount</button>
            </dt>
            <dd class="tabular-nums text-emerald-600 dark:text-emerald-400">−{{ money(cart.quote?.discountCents) }}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-muted-foreground">Tax ({{ ((session.currentStore?.taxRateBps ?? 0) / 100).toFixed(2) }}%)</dt>
            <dd class="tabular-nums">{{ money(cart.quote?.taxCents) }}</dd>
          </div>
          <div class="flex justify-between pt-1 text-lg font-semibold"><dt>Total</dt><dd class="tabular-nums" data-testid="cart-total">{{ money(cart.quote?.totalCents) }}</dd></div>
        </dl>
        <p v-if="cart.quoteError" class="mt-2 text-xs text-destructive">{{ cart.quoteError }}</p>
        <div class="mt-3 flex gap-2">
          <Button variant="outline" size="lg" class="h-12" :disabled="!cart.lines.length" aria-label="Clear cart" @click="cart.clear()"><Trash2Icon /></Button>
          <Button
            size="lg"
            class="h-12 flex-1 text-base"
            :disabled="!cart.quote || !!cart.quoteError || cart.lines.some((l) => l.variant.type === 'service' && !l.staffId)"
            @click="paying = true"
          >
            Charge {{ money(cart.quote?.totalCents) }}
          </Button>
        </div>
        <p v-if="cart.lines.some((l) => l.variant.type === 'service' && !l.staffId)" class="mt-2 text-xs text-amber-600">Pick who performed each service.</p>
      </div>
    </aside>
  </div>

  <Sheet v-model:open="apptOpen">
    <SheetContent class="w-full sm:max-w-md">
      <SheetHeader>
        <SheetTitle>Today’s appointments</SheetTitle>
        <SheetDescription>Check out a booking to charge it and mark it paid.</SheetDescription>
      </SheetHeader>
      <div class="flex-1 space-y-2 overflow-y-auto px-4 pb-4">
        <p v-if="!appts.length" class="py-10 text-center text-sm text-muted-foreground">No appointments today.</p>
        <div v-for="b in appts" :key="b.id" class="flex items-center gap-3 rounded-lg border border-l-[3px] p-3" :style="{ borderLeftColor: b.staffColor }" :data-testid="`appt-${b.reference}`">
          <div class="w-16 shrink-0 text-sm font-semibold tabular-nums">{{ apptTime(b.startsAt) }}</div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1 truncate font-medium">{{ b.customerName }} <GlobeIcon v-if="b.source === 'online'" class="size-3 text-muted-foreground" /></div>
            <div class="truncate text-xs text-muted-foreground">{{ b.serviceName }} · {{ b.staffName }} · {{ b.reference }}</div>
          </div>
          <Button v-if="b.status === 'booked'" size="sm" @click="checkoutBooking(b)">Check out</Button>
          <Badge v-else variant="secondary">Paid</Badge>
        </div>
      </div>
    </SheetContent>
  </Sheet>

  <BarcodeScanner v-if="scanning" @detected="onCameraDetected" @close="scanning = false" />
  <PayModal v-if="paying && cart.quote" :total-cents="cart.quote.totalCents" :busy="busy" @close="paying = false" @pay="pay" />

  <Modal v-if="editing" :title="editing.variant.label" @close="editing = null">
    <div class="space-y-4">
      <Field>
        <FieldLabel for="line-qty">Quantity</FieldLabel>
        <Input id="line-qty" :model-value="editing.qty" type="number" min="1" @update:model-value="editing.qty = Math.max(1, Number($event) || 1)" />
      </Field>
      <Field>
        <FieldLabel for="line-disc">Line discount</FieldLabel>
        <div class="flex gap-2">
          <ToggleGroup type="single" variant="outline" :model-value="editDiscountType" aria-label="Discount type" @update:model-value="setLineDiscType">
            <ToggleGroupItem value="percent" aria-label="Percent">%</ToggleGroupItem>
            <ToggleGroupItem value="amount" aria-label="Amount">$</ToggleGroupItem>
          </ToggleGroup>
          <Input id="line-disc" v-model="editDiscountValue" inputmode="decimal" placeholder="0" aria-label="Discount value" />
        </div>
      </Field>
      <Field v-if="editing.variant.type === 'service'">
        <FieldLabel for="line-staff">Performed by</FieldLabel>
        <NativeSelect id="line-staff" :model-value="editing.staffId ?? ''" @update:model-value="editing.staffId = $event ? String($event) : null">
          <NativeSelectOption value="" disabled>Select staff</NativeSelectOption>
          <NativeSelectOption v-for="s in staff" :key="s.id" :value="s.id">{{ s.name }}</NativeSelectOption>
        </NativeSelect>
      </Field>
    </div>
    <template #footer>
      <Button variant="ghost" class="mr-auto text-destructive" @click="cart.remove(editing.key); editing = null"><Trash2Icon /> Remove</Button>
      <Button @click="saveLine">Done</Button>
    </template>
  </Modal>

  <Modal v-if="orderDiscOpen" title="Order discount" description="Spread across lines proportionally, so partial returns refund the right amount." @close="orderDiscOpen = false">
    <div class="flex gap-2">
      <ToggleGroup type="single" variant="outline" :model-value="orderDiscType" aria-label="Discount type" @update:model-value="setOrderDiscType">
        <ToggleGroupItem value="percent" aria-label="Percent">%</ToggleGroupItem>
        <ToggleGroupItem value="amount" aria-label="Amount">$</ToggleGroupItem>
      </ToggleGroup>
      <Input v-model="orderDiscValue" inputmode="decimal" placeholder="0" aria-label="Order discount value" />
    </div>
    <template #footer>
      <Button variant="outline" @click="orderDiscValue = ''; saveOrderDiscount()">Remove</Button>
      <Button @click="saveOrderDiscount">Apply</Button>
    </template>
  </Modal>

  <Modal v-if="completed" title="Sale complete" @close="newSale">
    <div class="text-center">
      <CircleCheckIcon class="mx-auto mb-2 size-12 text-emerald-500" />
      <div class="text-sm text-muted-foreground">Receipt {{ completed.number }}</div>
      <div class="text-2xl font-semibold tabular-nums">{{ money(completed.totalCents) }}</div>
      <div v-if="completed.changeCents" class="mt-3 rounded-lg bg-emerald-50 p-3 text-lg font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Change due {{ money(completed.changeCents) }}</div>
    </div>
    <template #footer>
      <Button variant="outline" @click="printReceipt(completed.id)"><PrinterIcon /> Print receipt</Button>
      <Button @click="newSale">New sale</Button>
    </template>
  </Modal>
</template>
