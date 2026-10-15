<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import Modal from '@/components/Modal.vue';
import PageHeader from '@/components/PageHeader.vue';
import { api } from '@/lib/api';
import { dateTime, money } from '@/lib/format';
import type { SaleDetail } from '@/lib/types';
import { useSession } from '@/stores/session';
import { useToast } from '@/stores/toast';

interface SaleRow {
  id: string;
  number: string;
  createdAt: string;
  totalCents: number;
  customerName: string;
  cashierName: string;
}

const session = useSession();
const toast = useToast();
const tz = computed(() => session.currentStore?.timezone);
const rows = ref<SaleRow[]>([]);
const q = ref('');
const sale = ref<SaleDetail | null>(null);

async function load() {
  rows.value = (await api.get<{ sales: SaleRow[] }>('/sales', { storeId: session.storeId, q: q.value })).sales;
}
let t: ReturnType<typeof setTimeout>;
watch(q, () => {
  clearTimeout(t);
  t = setTimeout(load, 200);
});
onMounted(load);

async function open(id: string) {
  sale.value = (await api.get<{ sale: SaleDetail }>(`/sales/${id}`)).sale;
}
const refunded = computed(() => sale.value?.returns.reduce((s, r) => s + r.totalCents, 0) ?? 0);

// Returns
const returning = ref(false);
const retQty = ref<Record<string, number>>({});
const retRestock = ref<Record<string, boolean>>({});
const refundMethod = ref<'cash' | 'card' | 'other'>('cash');
const reason = ref('');
const busy = ref(false);
const clientRef = ref('');

function startReturn() {
  if (!sale.value) return;
  retQty.value = Object.fromEntries(sale.value.lines.map((l) => [l.id, 0]));
  retRestock.value = Object.fromEntries(sale.value.lines.map((l) => [l.id, !l.isService]));
  const paidBy = sale.value.payments.filter((p) => !p.returnId).sort((a, b) => b.amountCents - a.amountCents)[0]?.method;
  refundMethod.value = paidBy ?? 'cash';
  reason.value = '';
  clientRef.value = crypto.randomUUID();
  returning.value = true;
}
const estimate = computed(() => {
  if (!sale.value) return 0;
  return sale.value.lines.reduce((s, l) => s + Math.round((l.totalCents * (retQty.value[l.id] ?? 0)) / l.qty), 0);
});
async function submitReturn() {
  if (!sale.value) return;
  const lines = sale.value.lines.filter((l) => (retQty.value[l.id] ?? 0) > 0).map((l) => ({ saleLineId: l.id, qty: retQty.value[l.id]!, restock: retRestock.value[l.id] ?? false }));
  if (!lines.length) return toast.error('Choose at least one item to return');
  busy.value = true;
  try {
    const res = await api.post<{ return: { number: string; totalCents: number }; sale: SaleDetail }>(`/sales/${sale.value.id}/returns`, {
      lines,
      refundMethod: refundMethod.value,
      reason: reason.value || undefined,
      clientRef: clientRef.value,
    });
    toast.success(`Refund ${res.return.number}: ${money(res.return.totalCents)} (${refundMethod.value})`);
    sale.value = res.sale;
    returning.value = false;
  } catch (e) {
    toast.error(e);
  } finally {
    busy.value = false;
  }
}
const printReceipt = (id: string) => window.open(`/receipt/${id}?print=1`, '_blank', 'width=420,height=720');
</script>

<template>
  <PageHeader title="Sales" :subtitle="`Receipts at ${session.currentStore?.name}`" />
  <input v-model="q" class="input mb-4 max-w-xs" placeholder="Receipt number…" aria-label="Search receipts" />

  <div class="card overflow-x-auto">
    <table class="table">
      <thead>
        <tr><th>Receipt</th><th>Date</th><th>Cashier</th><th>Customer</th><th class="text-right">Total</th></tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id" class="cursor-pointer hover:bg-slate-50" @click="open(r.id)">
          <td class="font-mono text-xs font-medium text-indigo-700">{{ r.number }}</td>
          <td class="whitespace-nowrap text-slate-600">{{ dateTime(r.createdAt, tz) }}</td>
          <td>{{ r.cashierName }}</td>
          <td class="text-slate-600">{{ r.customerName || '—' }}</td>
          <td class="text-right tabular-nums">{{ money(r.totalCents) }}</td>
        </tr>
        <tr v-if="!rows.length"><td colspan="5" class="py-10 text-center text-slate-500">No sales yet.</td></tr>
      </tbody>
    </table>
  </div>

  <Modal v-if="sale && !returning" :title="`Receipt ${sale.number}`" wide @close="sale = null">
    <div class="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
      <span>{{ dateTime(sale.createdAt, tz) }}</span>
      <span>Cashier: {{ sale.cashierName }}</span>
      <span v-if="sale.customerName">Customer: {{ sale.customerName }}</span>
    </div>
    <table class="table">
      <thead><tr><th>Item</th><th class="text-right">Qty</th><th class="text-right">Discount</th><th class="text-right">Total</th></tr></thead>
      <tbody>
        <tr v-for="l in sale.lines" :key="l.id">
          <td>
            {{ l.name }}
            <span v-if="l.staffName" class="block text-xs text-violet-600">by {{ l.staffName }}</span>
            <span v-if="l.returnedQty" class="badge mt-0.5 bg-rose-50 text-rose-700">{{ l.returnedQty }} returned</span>
          </td>
          <td class="text-right tabular-nums">{{ l.qty }}</td>
          <td class="text-right tabular-nums text-emerald-600">{{ l.lineDiscountCents + l.orderDiscountCents ? '−' + money(l.lineDiscountCents + l.orderDiscountCents) : '' }}</td>
          <td class="text-right tabular-nums">{{ money(l.totalCents) }}</td>
        </tr>
      </tbody>
    </table>
    <dl class="ml-auto mt-3 max-w-xs space-y-1 text-sm">
      <div class="flex justify-between"><dt class="text-slate-500">Tax</dt><dd class="tabular-nums">{{ money(sale.taxCents) }}</dd></div>
      <div class="flex justify-between font-semibold"><dt>Total</dt><dd class="tabular-nums">{{ money(sale.totalCents) }}</dd></div>
      <div v-for="p in sale.payments" :key="p.id" class="flex justify-between text-slate-500">
        <dt class="capitalize">{{ p.returnId ? 'Refund · ' : '' }}{{ p.method }}</dt>
        <dd class="tabular-nums" :class="p.amountCents < 0 ? 'text-rose-600' : ''">{{ money(p.amountCents) }}</dd>
      </div>
      <div v-if="refunded" class="flex justify-between font-medium text-rose-600"><dt>Refunded</dt><dd class="tabular-nums">−{{ money(refunded) }}</dd></div>
    </dl>
    <template #footer>
      <button class="btn-secondary" @click="printReceipt(sale.id)">Print receipt</button>
      <button v-if="session.can('owner', 'manager', 'cashier') && sale.lines.some((l) => l.returnedQty < l.qty)" class="btn-danger" @click="startReturn">Return items</button>
    </template>
  </Modal>

  <Modal v-if="sale && returning" :title="`Return from ${sale.number}`" wide @close="returning = false">
    <table class="table">
      <thead><tr><th>Item</th><th class="text-right">Sold</th><th class="w-28">Return</th><th>Back to stock</th></tr></thead>
      <tbody>
        <tr v-for="l in sale.lines" :key="l.id">
          <td>{{ l.name }}</td>
          <td class="text-right tabular-nums">{{ l.qty - l.returnedQty }} / {{ l.qty }}</td>
          <td>
            <input v-model.number="retQty[l.id]" type="number" min="0" :max="l.qty - l.returnedQty" class="input py-1" :disabled="l.returnedQty >= l.qty" :aria-label="`Return quantity for ${l.name}`" />
          </td>
          <td>
            <label v-if="!l.isService" class="flex items-center gap-2 text-sm"><input v-model="retRestock[l.id]" type="checkbox" class="rounded" /> Restock</label>
            <span v-else class="text-xs text-slate-400">service</span>
          </td>
        </tr>
      </tbody>
    </table>
    <div class="mt-4 grid gap-3 sm:grid-cols-2">
      <div>
        <label class="label" for="refund-method">Refund to</label>
        <select id="refund-method" v-model="refundMethod" class="input">
          <option value="cash">Cash (from drawer)</option>
          <option value="card">Card</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div><label class="label" for="ret-reason">Reason</label><input id="ret-reason" v-model="reason" class="input" placeholder="Wrong shade, damaged…" /></div>
    </div>
    <p class="mt-3 text-sm text-slate-500">Estimated refund ≈ {{ money(estimate) }} (exact amount is computed by the server so partial returns always add up).</p>
    <template #footer>
      <button class="btn-secondary" @click="returning = false">Cancel</button>
      <button class="btn-danger" :disabled="busy" @click="submitReturn">Refund</button>
    </template>
  </Modal>
</template>
