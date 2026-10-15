<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import Modal from '@/components/Modal.vue';
import PageHeader from '@/components/PageHeader.vue';
import VariantPicker from '@/components/VariantPicker.vue';
import { api } from '@/lib/api';
import { dateTime, money, parseMoney } from '@/lib/format';
import type { VariantView } from '@/lib/types';
import { useSession } from '@/stores/session';
import { useToast } from '@/stores/toast';

interface Level {
  variantId: string;
  label: string;
  sku: string;
  category: string;
  onHand: number;
  inbound: number;
  outbound: number;
  reorderLevel: number;
  low: boolean;
  costCents: number;
  priceCents: number;
}
interface Movement {
  id: number;
  kind: string;
  qty: number;
  note: string;
  balance: number;
  createdAt: string;
  userName: string | null;
  refType: string | null;
}

const session = useSession();
const toast = useToast();
const levels = ref<Level[]>([]);
const q = ref('');
const lowOnly = ref(false);
const loading = ref(true);
const canManage = computed(() => session.can('owner', 'manager'));

const shown = computed(() => levels.value.filter((l) => !lowOnly.value || l.low));
const stockValue = computed(() => levels.value.reduce((s, l) => s + Math.max(l.onHand, 0) * l.costCents, 0));

async function load() {
  loading.value = true;
  try {
    levels.value = (await api.get<{ levels: Level[] }>('/inventory/levels', { storeId: session.storeId, q: q.value })).levels;
  } catch (e) {
    toast.error(e);
  } finally {
    loading.value = false;
  }
}
let t: ReturnType<typeof setTimeout>;
watch(q, () => {
  clearTimeout(t);
  t = setTimeout(load, 200);
});
onMounted(load);

// Ledger drawer
const ledgerFor = ref<Level | null>(null);
const movements = ref<Movement[]>([]);
async function openLedger(l: Level) {
  ledgerFor.value = l;
  movements.value = (await api.get<{ movements: Movement[] }>('/inventory/movements', { storeId: session.storeId, variantId: l.variantId })).movements;
}
const kindLabel: Record<string, string> = {
  receive: 'Received',
  sale: 'Sold',
  return: 'Customer return',
  adjust: 'Stock count',
  transfer_out: 'Transfer sent',
  transfer_in: 'Transfer received',
  transfer_cancel: 'Transfer cancelled',
};

// Receive / count
type Mode = 'receive' | 'count';
const mode = ref<Mode | null>(null);
const lines = ref<{ variant: VariantView | Level; qty: number; cost: string }[]>([]);
const note = ref('');
const busy = ref(false);
function openMode(m: Mode) {
  mode.value = m;
  lines.value = [];
  note.value = m === 'count' ? 'Stock count' : '';
}
function addLine(v: VariantView) {
  if (lines.value.some((l) => ('id' in l.variant ? l.variant.id : l.variant.variantId) === v.id)) return;
  lines.value.push({ variant: v, qty: mode.value === 'count' ? (v.onHand ?? 0) : 1, cost: (v.costCents / 100).toFixed(2) });
}
const idOf = (v: VariantView | Level) => ('id' in v ? v.id : v.variantId);
async function submit() {
  busy.value = true;
  try {
    if (mode.value === 'receive') {
      await api.post('/inventory/receive', {
        storeId: session.storeId,
        note: note.value,
        lines: lines.value.map((l) => ({ variantId: idOf(l.variant), qty: Number(l.qty), unitCostCents: parseMoney(l.cost) ?? undefined })),
      });
      toast.success('Stock received');
    } else {
      const res = await api.post<{ adjustments: { delta: number }[] }>('/inventory/stocktake', {
        storeId: session.storeId,
        note: note.value,
        lines: lines.value.map((l) => ({ variantId: idOf(l.variant), countedQty: Number(l.qty) })),
      });
      const changed = res.adjustments.filter((a) => a.delta !== 0).length;
      toast.success(changed ? `Count saved, ${changed} item(s) adjusted` : 'Count matches, nothing to adjust');
    }
    mode.value = null;
    load();
  } catch (e) {
    toast.error(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <PageHeader title="Inventory" :subtitle="`Stock at ${session.currentStore?.name} · value at cost ${money(stockValue)}`">
    <template v-if="canManage">
      <button class="btn-secondary" @click="openMode('count')">Stock count</button>
      <button class="btn-primary" @click="openMode('receive')">Receive stock</button>
    </template>
  </PageHeader>

  <div class="mb-4 flex flex-wrap items-center gap-3">
    <input v-model="q" class="input max-w-xs" placeholder="Search…" aria-label="Search stock" />
    <label class="flex items-center gap-2 text-sm text-slate-600"><input v-model="lowOnly" type="checkbox" class="rounded" /> Low stock only</label>
  </div>

  <div class="card overflow-x-auto">
    <table class="table">
      <thead>
        <tr>
          <th>Item</th>
          <th>SKU</th>
          <th class="text-right">On hand</th>
          <th class="text-right">In transit</th>
          <th class="text-right">Reorder at</th>
          <th class="text-right">Price</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="l in shown" :key="l.variantId" class="hover:bg-slate-50">
          <td>
            <div class="font-medium">{{ l.label }}</div>
            <div class="text-xs text-slate-500">{{ l.category }}</div>
          </td>
          <td class="font-mono text-xs">{{ l.sku }}</td>
          <td class="text-right tabular-nums">
            <span :class="l.onHand < 0 ? 'text-rose-700' : l.low ? 'font-semibold text-amber-600' : ''">{{ l.onHand }}</span>
            <span v-if="l.low" class="badge ml-2 bg-amber-50 text-amber-700">low</span>
          </td>
          <td class="text-right text-xs tabular-nums">
            <span v-if="l.inbound" class="text-sky-700">+{{ l.inbound }} in</span>
            <span v-if="l.outbound" class="ml-1 text-slate-500">−{{ l.outbound }} out</span>
          </td>
          <td class="text-right tabular-nums text-slate-500">{{ l.reorderLevel }}</td>
          <td class="text-right tabular-nums">{{ money(l.priceCents) }}</td>
          <td class="text-right"><button class="btn-ghost px-2 py-1 text-indigo-600" @click="openLedger(l)">History</button></td>
        </tr>
        <tr v-if="!loading && shown.length === 0">
          <td colspan="7" class="py-10 text-center text-slate-500">Nothing here.</td>
        </tr>
      </tbody>
    </table>
  </div>

  <Modal v-if="ledgerFor" :title="`Stock ledger · ${ledgerFor.label}`" wide @close="ledgerFor = null">
    <p class="mb-3 text-sm text-slate-500">Every change is an immutable movement. On hand = sum of movements.</p>
    <table class="table">
      <thead>
        <tr><th>When</th><th>Movement</th><th>By</th><th class="text-right">Qty</th><th class="text-right">Balance</th></tr>
      </thead>
      <tbody>
        <tr v-for="m in movements" :key="m.id">
          <td class="whitespace-nowrap text-xs text-slate-500">{{ dateTime(m.createdAt, session.currentStore?.timezone) }}</td>
          <td>{{ kindLabel[m.kind] ?? m.kind }}<span v-if="m.note" class="block text-xs text-slate-400">{{ m.note }}</span></td>
          <td class="text-xs">{{ m.userName ?? '—' }}</td>
          <td class="text-right font-medium tabular-nums" :class="m.qty < 0 ? 'text-rose-600' : 'text-emerald-600'">{{ m.qty > 0 ? '+' : '' }}{{ m.qty }}</td>
          <td class="text-right tabular-nums">{{ m.balance }}</td>
        </tr>
      </tbody>
    </table>
  </Modal>

  <Modal v-if="mode" :title="mode === 'receive' ? 'Receive stock' : 'Stock count'" wide @close="mode = null">
    <p class="mb-3 text-sm text-slate-500">
      {{ mode === 'receive' ? 'Adds stock from a supplier delivery.' : 'Enter what is physically on the shelf. Only the difference is posted as an adjustment.' }}
    </p>
    <VariantPicker type="product" @pick="addLine" />
    <table v-if="lines.length" class="table mt-3">
      <thead>
        <tr>
          <th>Item</th>
          <th class="w-28">{{ mode === 'receive' ? 'Qty' : 'Counted' }}</th>
          <th v-if="mode === 'receive'" class="w-28">Unit cost $</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="(l, i) in lines" :key="i">
          <td>{{ l.variant.label }}</td>
          <td><input v-model.number="l.qty" class="input" type="number" :min="mode === 'receive' ? 1 : 0" :aria-label="`Quantity for ${l.variant.label}`" /></td>
          <td v-if="mode === 'receive'"><input v-model="l.cost" class="input" inputmode="decimal" /></td>
          <td class="text-right"><button class="btn-ghost px-2 text-rose-600" @click="lines.splice(i, 1)">✕</button></td>
        </tr>
      </tbody>
    </table>
    <div class="mt-3"><label class="label" for="inv-note">Note</label><input id="inv-note" v-model="note" class="input" placeholder="Supplier invoice #, reason…" /></div>
    <template #footer>
      <button class="btn-secondary" @click="mode = null">Cancel</button>
      <button class="btn-primary" :disabled="busy || !lines.length" @click="submit">{{ mode === 'receive' ? 'Receive' : 'Save count' }}</button>
    </template>
  </Modal>
</template>
