<script setup lang="ts">
import { ClipboardListIcon, HistoryIcon, PackagePlusIcon, SearchIcon, XIcon } from '@lucide/vue';
import { computed, onMounted, ref, watch } from 'vue';
import Modal from '@/components/Modal.vue';
import PageHeader from '@/components/PageHeader.vue';
import VariantPicker from '@/components/VariantPicker.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { dateTime, money, parseMoney } from '@/lib/format';
import { toast } from '@/lib/notify';
import type { VariantView } from '@/lib/types';
import { useSession } from '@/stores/session';

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
}

const session = useSession();
const tz = computed(() => session.currentStore?.timezone);
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

// Ledger
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
const lines = ref<{ id: string; label: string; qty: string; cost: string }[]>([]);
const note = ref('');
const busy = ref(false);
function openMode(m: Mode) {
  mode.value = m;
  lines.value = [];
  note.value = m === 'count' ? 'Stock count' : '';
}
function addLine(v: VariantView) {
  if (lines.value.some((l) => l.id === v.id)) return;
  lines.value.push({ id: v.id, label: v.label, qty: String(mode.value === 'count' ? (v.onHand ?? 0) : 1), cost: (v.costCents / 100).toFixed(2) });
}
async function submit() {
  busy.value = true;
  try {
    if (mode.value === 'receive') {
      await api.post('/inventory/receive', {
        storeId: session.storeId,
        note: note.value,
        lines: lines.value.map((l) => ({ variantId: l.id, qty: Number(l.qty), unitCostCents: parseMoney(l.cost) ?? undefined })),
      });
      toast.success('Stock received');
    } else {
      const res = await api.post<{ adjustments: { delta: number }[] }>('/inventory/stocktake', {
        storeId: session.storeId,
        note: note.value,
        lines: lines.value.map((l) => ({ variantId: l.id, countedQty: Number(l.qty) })),
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
      <Button variant="outline" @click="openMode('count')"><ClipboardListIcon /> Stock count</Button>
      <Button @click="openMode('receive')"><PackagePlusIcon /> Receive stock</Button>
    </template>
  </PageHeader>

  <div class="mb-4 flex flex-wrap items-center gap-4">
    <InputGroup class="max-w-xs">
      <InputGroupAddon><SearchIcon /></InputGroupAddon>
      <InputGroupInput v-model="q" placeholder="Search…" aria-label="Search stock" />
    </InputGroup>
    <div class="flex items-center gap-2">
      <Switch id="low-only" v-model="lowOnly" />
      <Label for="low-only">Low stock only</Label>
    </div>
  </div>

  <Card class="py-0">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Item</TableHead>
          <TableHead>SKU</TableHead>
          <TableHead class="text-right">On hand</TableHead>
          <TableHead class="text-right">In transit</TableHead>
          <TableHead class="text-right">Reorder at</TableHead>
          <TableHead class="text-right">Price</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="l in shown" :key="l.variantId">
          <TableCell>
            <div class="font-medium">{{ l.label }}</div>
            <div class="text-xs text-muted-foreground">{{ l.category }}</div>
          </TableCell>
          <TableCell class="font-mono text-xs">{{ l.sku }}</TableCell>
          <TableCell class="text-right tabular-nums">
            <span :class="l.onHand < 0 ? 'text-destructive' : l.low ? 'font-semibold text-amber-600 dark:text-amber-400' : ''">{{ l.onHand }}</span>
            <Badge v-if="l.low" variant="outline" class="ml-2 border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400">low</Badge>
          </TableCell>
          <TableCell class="text-right text-xs tabular-nums">
            <span v-if="l.inbound" class="text-sky-700 dark:text-sky-400">+{{ l.inbound }} in</span>
            <span v-if="l.outbound" class="ml-1 text-muted-foreground">−{{ l.outbound }} out</span>
          </TableCell>
          <TableCell class="text-right tabular-nums text-muted-foreground">{{ l.reorderLevel }}</TableCell>
          <TableCell class="text-right tabular-nums">{{ money(l.priceCents) }}</TableCell>
          <TableCell class="text-right"><Button variant="ghost" size="sm" @click="openLedger(l)"><HistoryIcon /> History</Button></TableCell>
        </TableRow>
        <TableEmpty v-if="!loading && shown.length === 0" :colspan="7">Nothing here.</TableEmpty>
      </TableBody>
    </Table>
  </Card>

  <Modal v-if="ledgerFor" :title="`Stock ledger · ${ledgerFor.label}`" description="Every change is an immutable movement. On hand = sum of movements." wide @close="ledgerFor = null">
    <Table>
      <TableHeader>
        <TableRow><TableHead>When</TableHead><TableHead>Movement</TableHead><TableHead>By</TableHead><TableHead class="text-right">Qty</TableHead><TableHead class="text-right">Balance</TableHead></TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="m in movements" :key="m.id">
          <TableCell class="whitespace-nowrap text-xs text-muted-foreground">{{ dateTime(m.createdAt, tz) }}</TableCell>
          <TableCell>{{ kindLabel[m.kind] ?? m.kind }}<span v-if="m.note" class="block text-xs text-muted-foreground">{{ m.note }}</span></TableCell>
          <TableCell class="text-xs">{{ m.userName ?? '—' }}</TableCell>
          <TableCell class="text-right font-medium tabular-nums" :class="m.qty < 0 ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'">{{ m.qty > 0 ? '+' : '' }}{{ m.qty }}</TableCell>
          <TableCell class="text-right tabular-nums">{{ m.balance }}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Modal>

  <Modal
    v-if="mode"
    :title="mode === 'receive' ? 'Receive stock' : 'Stock count'"
    :description="mode === 'receive' ? 'Adds stock from a supplier delivery.' : 'Enter what is physically on the shelf. Only the difference is posted as an adjustment.'"
    wide
    @close="mode = null"
  >
    <VariantPicker type="product" @pick="addLine" />
    <Table v-if="lines.length" class="mt-3">
      <TableHeader>
        <TableRow>
          <TableHead>Item</TableHead>
          <TableHead class="w-28">{{ mode === 'receive' ? 'Qty' : 'Counted' }}</TableHead>
          <TableHead v-if="mode === 'receive'" class="w-28">Unit cost $</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="(l, i) in lines" :key="l.id">
          <TableCell>{{ l.label }}</TableCell>
          <TableCell><Input v-model="l.qty" type="number" :min="mode === 'receive' ? 1 : 0" :aria-label="`Quantity for ${l.label}`" /></TableCell>
          <TableCell v-if="mode === 'receive'"><Input v-model="l.cost" inputmode="decimal" :aria-label="`Unit cost for ${l.label}`" /></TableCell>
          <TableCell class="text-right"><Button variant="ghost" size="icon-sm" aria-label="Remove line" @click="lines.splice(i, 1)"><XIcon /></Button></TableCell>
        </TableRow>
      </TableBody>
    </Table>
    <Field class="mt-4">
      <FieldLabel for="inv-note">Note</FieldLabel>
      <Input id="inv-note" v-model="note" placeholder="Supplier invoice #, reason…" />
    </Field>
    <template #footer>
      <Button variant="outline" @click="mode = null">Cancel</Button>
      <Button :disabled="busy || !lines.length" @click="submit">{{ mode === 'receive' ? 'Receive' : 'Save count' }}</Button>
    </template>
  </Modal>
</template>
