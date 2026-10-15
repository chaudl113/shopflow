<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { PrinterIcon, ReceiptTextIcon, SearchIcon, Undo2Icon } from '@lucide/vue';
import Modal from '@/components/Modal.vue';
import PageHeader from '@/components/PageHeader.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { dateTime, money } from '@/lib/format';
import type { SaleDetail } from '@/lib/types';
import { useSession } from '@/stores/session';
import { toast } from '@/lib/notify';

interface SaleRow {
  id: string;
  number: string;
  createdAt: string;
  totalCents: number;
  customerName: string;
  cashierName: string;
}

const session = useSession();
const tz = computed(() => session.currentStore?.timezone);
const rows = ref<SaleRow[]>([]);
const loaded = ref(false);
const q = ref('');
const sale = ref<SaleDetail | null>(null);

async function load() {
  rows.value = (await api.get<{ sales: SaleRow[] }>('/sales', { storeId: session.storeId, q: q.value })).sales;
  loaded.value = true;
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
function setRetQty(id: string, max: number, v: string | number) {
  retQty.value[id] = Math.min(Math.max(Math.trunc(Number(v)) || 0, 0), max);
}
const printReceipt = (id: string) => window.open(`/receipt/${id}?print=1`, '_blank', 'width=420,height=720');
</script>

<template>
  <PageHeader title="Sales" :subtitle="`Receipts at ${session.currentStore?.name}`" />
  <InputGroup class="mb-4 max-w-xs">
    <InputGroupAddon><SearchIcon /></InputGroupAddon>
    <InputGroupInput v-model="q" placeholder="Receipt number…" aria-label="Search receipts" />
  </InputGroup>

  <Card class="py-0">
    <Table>
      <TableHeader>
        <TableRow><TableHead>Receipt</TableHead><TableHead>Date</TableHead><TableHead>Cashier</TableHead><TableHead>Customer</TableHead><TableHead class="text-right">Total</TableHead></TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="r in rows" :key="r.id" class="cursor-pointer" @click="open(r.id)">
          <TableCell class="font-mono text-xs font-medium text-primary">{{ r.number }}</TableCell>
          <TableCell class="whitespace-nowrap text-muted-foreground">{{ dateTime(r.createdAt, tz) }}</TableCell>
          <TableCell>{{ r.cashierName }}</TableCell>
          <TableCell class="text-muted-foreground">{{ r.customerName || '—' }}</TableCell>
          <TableCell class="text-right tabular-nums">{{ money(r.totalCents) }}</TableCell>
        </TableRow>
        <TableEmpty v-if="loaded && !rows.length" :colspan="5">No sales yet.</TableEmpty>
      </TableBody>
    </Table>
  </Card>

  <Modal v-if="sale && !returning" :title="`Receipt ${sale.number}`" wide @close="sale = null">
    <div class="space-y-4">
    <div class="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
      <span>{{ dateTime(sale.createdAt, tz) }}</span>
      <span>Cashier: {{ sale.cashierName }}</span>
      <span v-if="sale.customerName">Customer: {{ sale.customerName }}</span>
    </div>
    <Table>
      <TableHeader><TableRow><TableHead>Item</TableHead><TableHead class="text-right">Qty</TableHead><TableHead class="text-right">Discount</TableHead><TableHead class="text-right">Net</TableHead></TableRow></TableHeader>
      <TableBody>
        <TableRow v-for="l in sale.lines" :key="l.id">
          <TableCell>
            {{ l.name }}
            <span v-if="l.staffName" class="block text-xs text-violet-600 dark:text-violet-400">by {{ l.staffName }}</span>
            <Badge v-if="l.returnedQty" variant="destructive" class="mt-0.5">{{ l.returnedQty }} returned</Badge>
          </TableCell>
          <TableCell class="text-right tabular-nums">{{ l.qty }}</TableCell>
          <TableCell class="text-right tabular-nums text-emerald-600 dark:text-emerald-400">{{ l.lineDiscountCents + l.orderDiscountCents ? '−' + money(l.lineDiscountCents + l.orderDiscountCents) : '' }}</TableCell>
          <TableCell class="text-right tabular-nums">{{ money(l.netCents) }}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
    <dl class="ml-auto w-full max-w-xs space-y-1 text-sm">
      <div class="flex justify-between"><dt class="text-muted-foreground">Subtotal</dt><dd class="tabular-nums">{{ money(sale.subtotalCents) }}</dd></div>
      <div v-if="sale.discountCents" class="flex justify-between"><dt class="text-muted-foreground">Discounts</dt><dd class="tabular-nums text-emerald-600 dark:text-emerald-400">−{{ money(sale.discountCents) }}</dd></div>
      <div class="flex justify-between"><dt class="text-muted-foreground">Tax</dt><dd class="tabular-nums">{{ money(sale.taxCents) }}</dd></div>
      <div class="flex justify-between font-semibold"><dt>Total</dt><dd class="tabular-nums">{{ money(sale.totalCents) }}</dd></div>
      <div v-for="p in sale.payments" :key="p.id" class="flex justify-between text-muted-foreground">
        <dt class="capitalize">{{ p.returnId ? 'Refund · ' : '' }}{{ p.method }}</dt>
        <dd class="tabular-nums" :class="p.amountCents < 0 ? 'text-destructive' : ''">{{ money(p.amountCents) }}</dd>
      </div>
      <div v-if="refunded" class="flex justify-between font-medium text-destructive"><dt>Refunded</dt><dd class="tabular-nums">−{{ money(refunded) }}</dd></div>
    </dl>
    </div>
    <template #footer>
      <Button variant="outline" @click="printReceipt(sale.id)"><PrinterIcon /> Print receipt</Button>
      <Button v-if="session.can('owner', 'manager', 'cashier') && sale.lines.some((l) => l.returnedQty < l.qty)" variant="destructive" @click="startReturn"><Undo2Icon /> Return items</Button>
    </template>
  </Modal>

  <Modal v-if="sale && returning" :title="`Return from ${sale.number}`" wide @close="returning = false">
    <div class="space-y-4">
    <Table>
      <TableHeader><TableRow><TableHead>Item</TableHead><TableHead class="text-right">Sold</TableHead><TableHead class="w-28">Return</TableHead><TableHead>Back to stock</TableHead></TableRow></TableHeader>
      <TableBody>
        <TableRow v-for="l in sale.lines" :key="l.id">
          <TableCell>{{ l.name }}</TableCell>
          <TableCell class="text-right tabular-nums">{{ l.qty - l.returnedQty }} / {{ l.qty }}</TableCell>
          <TableCell>
            <Input
              :model-value="retQty[l.id]"
              type="number"
              min="0"
              :max="l.qty - l.returnedQty"
              class="h-8"
              :disabled="l.returnedQty >= l.qty"
              :aria-label="`Return quantity for ${l.name}`"
              @update:model-value="setRetQty(l.id, l.qty - l.returnedQty, $event)"
            />
          </TableCell>
          <TableCell>
            <label v-if="!l.isService" class="flex items-center gap-2 text-sm"><Checkbox v-model="retRestock[l.id]" /> Restock</label>
            <span v-else class="text-xs text-muted-foreground">service</span>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
    <div class="grid gap-3 sm:grid-cols-2">
      <Field>
        <FieldLabel for="refund-method">Refund to</FieldLabel>
        <NativeSelect id="refund-method" v-model="refundMethod">
          <NativeSelectOption value="cash">Cash (from drawer)</NativeSelectOption>
          <NativeSelectOption value="card">Card</NativeSelectOption>
          <NativeSelectOption value="other">Other</NativeSelectOption>
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel for="ret-reason">Reason</FieldLabel>
        <Input id="ret-reason" v-model="reason" placeholder="Wrong shade, damaged…" />
      </Field>
    </div>
    <p class="text-sm text-muted-foreground"><ReceiptTextIcon class="mr-1 inline size-4 align-text-bottom" />Estimated refund ≈ {{ money(estimate) }} (exact amount is computed by the server so partial returns always add up).</p>
    </div>
    <template #footer>
      <Button variant="outline" @click="returning = false">Cancel</Button>
      <Button variant="destructive" :disabled="busy" @click="submitReturn">Refund</Button>
    </template>
  </Modal>
</template>
