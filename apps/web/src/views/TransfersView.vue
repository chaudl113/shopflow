<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ArrowRightIcon, PackageCheckIcon, PlusIcon, TruckIcon, XIcon } from '@lucide/vue';
import Modal from '@/components/Modal.vue';
import PageHeader from '@/components/PageHeader.vue';
import VariantPicker from '@/components/VariantPicker.vue';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import type { VariantView } from '@/lib/types';
import { useSession } from '@/stores/session';
import { toast } from '@/lib/notify';

interface TransferLine {
  id: string;
  variantId: string;
  sku: string;
  label: string;
  qtySent: number;
  qtyReceived: number | null;
}
interface Transfer {
  id: string;
  number: string;
  status: 'in_transit' | 'received' | 'cancelled';
  fromStoreId: string;
  toStoreId: string;
  fromName: string;
  toName: string;
  note: string;
  receiveNote: string;
  sentAt: string;
  sentByName: string;
  receivedAt: string | null;
  receivedByName: string | null;
  lines: TransferLine[];
}

const session = useSession();
const list = ref<Transfer[]>([]);
const loaded = ref(false);
const directory = ref<{ id: string; name: string; kind: string }[]>([]);
const here = computed(() => session.storeId!);

async function load() {
  list.value = (await api.get<{ transfers: Transfer[] }>('/transfers', { storeId: here.value })).transfers;
  loaded.value = true;
}
onMounted(async () => {
  directory.value = (await api.get<{ stores: { id: string; name: string; kind: string }[] }>('/stores/directory')).stores;
  await load();
});

const statusBadge: Record<Transfer['status'], string> = {
  in_transit: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  received: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  cancelled: 'bg-muted text-muted-foreground',
};
const toQty = (v: string | number, min: number) => Math.max(Math.trunc(Number(v)) || 0, min);
const units = (t: Transfer) => t.lines.reduce((s, l) => s + l.qtySent, 0);
const shortfall = (t: Transfer) => (t.status === 'received' ? t.lines.reduce((s, l) => s + (l.qtySent - (l.qtyReceived ?? 0)), 0) : 0);

// New transfer
const creating = ref(false);
const dest = ref('');
const note = ref('');
const lines = ref<{ variant: VariantView; qty: number }[]>([]);
const busy = ref(false);
function startNew() {
  dest.value = directory.value.find((s) => s.id !== here.value)?.id ?? '';
  note.value = '';
  lines.value = [];
  creating.value = true;
}
function addLine(v: VariantView) {
  if (!lines.value.some((l) => l.variant.id === v.id)) lines.value.push({ variant: v, qty: 1 });
}
async function send() {
  busy.value = true;
  try {
    const res = await api.post<{ transfer: Transfer }>('/transfers', {
      fromStoreId: here.value,
      toStoreId: dest.value,
      note: note.value,
      lines: lines.value.map((l) => ({ variantId: l.variant.id, qty: Number(l.qty) })),
    });
    toast.success(`${res.transfer.number} sent – stock is now in transit`);
    creating.value = false;
    load();
  } catch (e) {
    toast.error(e);
  } finally {
    busy.value = false;
  }
}

// Receive
const receiving = ref<Transfer | null>(null);
const recQty = ref<Record<string, number>>({});
const recNote = ref('');
function startReceive(t: Transfer) {
  receiving.value = t;
  recQty.value = Object.fromEntries(t.lines.map((l) => [l.id, l.qtySent]));
  recNote.value = '';
}
async function receive() {
  if (!receiving.value) return;
  busy.value = true;
  try {
    await api.post(`/transfers/${receiving.value.id}/receive`, { lines: receiving.value.lines.map((l) => ({ lineId: l.id, qtyReceived: Number(recQty.value[l.id] ?? 0) })), note: recNote.value });
    toast.success(`${receiving.value.number} received`);
    receiving.value = null;
    load();
  } catch (e) {
    toast.error(e);
  } finally {
    busy.value = false;
  }
}
const cancelling = ref<Transfer | null>(null);
async function cancel(t: Transfer) {
  cancelling.value = null;
  try {
    await api.post(`/transfers/${t.id}/cancel`);
    toast.success(`${t.number} cancelled`);
    load();
  } catch (e) {
    toast.error(e);
  }
}
</script>

<template>
  <PageHeader title="Transfers" subtitle="Move stock between locations in two steps: send, then receive at the destination">
    <Button @click="startNew"><PlusIcon /> New transfer</Button>
  </PageHeader>

  <div class="space-y-3">
    <Card v-for="t in list" :key="t.id" class="py-4" :data-testid="`transfer-${t.number}`">
      <CardContent class="space-y-2 px-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="font-mono text-sm font-semibold">{{ t.number }}</span>
            <Badge variant="secondary" class="capitalize" :class="statusBadge[t.status]">{{ t.status.replace('_', ' ') }}</Badge>
            <Badge variant="outline">{{ t.toStoreId === here ? 'incoming' : 'outgoing' }}</Badge>
          </div>
          <div class="flex gap-2">
            <Button v-if="t.status === 'in_transit' && t.toStoreId === here" size="sm" @click="startReceive(t)"><PackageCheckIcon /> Receive</Button>
            <Button v-if="t.status === 'in_transit' && t.fromStoreId === here" size="sm" variant="outline" @click="cancelling = t">Cancel</Button>
          </div>
        </div>
        <div class="text-sm text-muted-foreground">
          <span class="inline-flex items-center gap-1 font-medium text-foreground">{{ t.fromName }} <ArrowRightIcon class="size-3.5" /> {{ t.toName }}</span>
          · {{ units(t) }} units · sent {{ dateTime(t.sentAt, session.currentStore?.timezone) }} by {{ t.sentByName }}
          <span v-if="t.receivedAt"> · received {{ dateTime(t.receivedAt, session.currentStore?.timezone) }} by {{ t.receivedByName }}</span>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <Badge v-for="l in t.lines" :key="l.id" variant="secondary" class="font-normal">
            {{ l.label }} × {{ l.qtySent }}<template v-if="l.qtyReceived !== null && l.qtyReceived !== l.qtySent">&nbsp;(got {{ l.qtyReceived }})</template>
          </Badge>
        </div>
        <p v-if="shortfall(t)" class="text-sm text-destructive">Short by {{ shortfall(t) }} unit(s){{ t.receiveNote ? ` – ${t.receiveNote}` : '' }}</p>
        <p v-if="t.note" class="text-xs text-muted-foreground">{{ t.note }}</p>
      </CardContent>
    </Card>
    <Empty v-if="loaded && !list.length" class="border">
      <EmptyHeader>
        <EmptyMedia variant="icon"><TruckIcon /></EmptyMedia>
        <EmptyTitle>No transfers yet</EmptyTitle>
        <EmptyDescription>Transfers to or from this location will show here.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  </div>

  <Modal v-if="creating" title="New transfer" description="Stock leaves this location now and is held in transit until the destination receives it." wide @close="creating = false">
    <div class="space-y-4">
      <div class="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel for="from">From</FieldLabel>
          <Input id="from" :model-value="session.currentStore?.name" disabled />
        </Field>
        <Field>
          <FieldLabel for="dest">To</FieldLabel>
          <NativeSelect id="dest" v-model="dest">
            <NativeSelectOption v-for="s in directory.filter((d) => d.id !== here)" :key="s.id" :value="s.id">{{ s.name }}</NativeSelectOption>
          </NativeSelect>
        </Field>
      </div>
      <VariantPicker type="product" @pick="addLine" />
      <Table v-if="lines.length">
        <TableHeader><TableRow><TableHead>Item</TableHead><TableHead class="text-right">Available</TableHead><TableHead class="w-28">Send</TableHead><TableHead /></TableRow></TableHeader>
        <TableBody>
          <TableRow v-for="(l, i) in lines" :key="l.variant.id">
            <TableCell>{{ l.variant.label }}</TableCell>
            <TableCell class="text-right tabular-nums text-muted-foreground">{{ l.variant.onHand }}</TableCell>
            <TableCell><Input :model-value="l.qty" type="number" min="1" class="h-8" :aria-label="`Send quantity for ${l.variant.label}`" @update:model-value="l.qty = toQty($event, 1)" /></TableCell>
            <TableCell class="text-right"><Button variant="ghost" size="icon-sm" class="text-destructive" aria-label="Remove line" @click="lines.splice(i, 1)"><XIcon /></Button></TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <Field>
        <FieldLabel for="t-note">Note</FieldLabel>
        <Input id="t-note" v-model="note" placeholder="e.g. Weekly restock" />
      </Field>
    </div>
    <template #footer>
      <Button variant="outline" @click="creating = false">Cancel</Button>
      <Button :disabled="busy || !lines.length || !dest" @click="send"><TruckIcon /> Send</Button>
    </template>
  </Modal>

  <Modal v-if="receiving" :title="`Receive ${receiving.number}`" description="Count what actually arrived. Anything short is recorded on the transfer." @close="receiving = null">
    <div class="space-y-4">
      <Table>
        <TableHeader><TableRow><TableHead>Item</TableHead><TableHead class="text-right">Sent</TableHead><TableHead class="w-28">Received</TableHead></TableRow></TableHeader>
        <TableBody>
          <TableRow v-for="l in receiving.lines" :key="l.id">
            <TableCell>{{ l.label }}</TableCell>
            <TableCell class="text-right tabular-nums">{{ l.qtySent }}</TableCell>
            <TableCell>
              <Input :model-value="recQty[l.id]" type="number" min="0" :max="l.qtySent" class="h-8" :aria-label="`Received quantity for ${l.label}`" @update:model-value="recQty[l.id] = Math.min(toQty($event, 0), l.qtySent)" />
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <Field>
        <FieldLabel for="r-note">Note</FieldLabel>
        <Input id="r-note" v-model="recNote" placeholder="Damage, missing items…" />
      </Field>
    </div>
    <template #footer>
      <Button variant="outline" @click="receiving = null">Cancel</Button>
      <Button :disabled="busy" @click="receive">Confirm receipt</Button>
    </template>
  </Modal>

  <AlertDialog :open="!!cancelling" @update:open="(v: boolean) => !v && (cancelling = null)">
    <AlertDialogContent v-if="cancelling">
      <AlertDialogHeader>
        <AlertDialogTitle>Cancel {{ cancelling.number }}?</AlertDialogTitle>
        <AlertDialogDescription>All {{ units(cancelling) }} units go back to {{ cancelling.fromName }}. This cannot be undone.</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Keep it</AlertDialogCancel>
        <AlertDialogAction variant="destructive" @click="cancel(cancelling)">Cancel transfer</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
