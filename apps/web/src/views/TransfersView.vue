<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import Modal from '@/components/Modal.vue';
import PageHeader from '@/components/PageHeader.vue';
import VariantPicker from '@/components/VariantPicker.vue';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import type { VariantView } from '@/lib/types';
import { useSession } from '@/stores/session';
import { useToast } from '@/stores/toast';

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
const toast = useToast();
const list = ref<Transfer[]>([]);
const directory = ref<{ id: string; name: string; kind: string }[]>([]);
const here = computed(() => session.storeId!);

async function load() {
  list.value = (await api.get<{ transfers: Transfer[] }>('/transfers', { storeId: here.value })).transfers;
}
onMounted(async () => {
  directory.value = (await api.get<{ stores: { id: string; name: string; kind: string }[] }>('/stores/directory')).stores;
  await load();
});

const statusBadge: Record<Transfer['status'], string> = {
  in_transit: 'bg-sky-50 text-sky-700',
  received: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-500',
};
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
async function cancel(t: Transfer) {
  if (!confirm(`Cancel ${t.number}? Stock goes back to ${t.fromName}.`)) return;
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
    <button class="btn-primary" @click="startNew">+ New transfer</button>
  </PageHeader>

  <div class="space-y-3">
    <div v-for="t in list" :key="t.id" class="card p-4" :data-testid="`transfer-${t.number}`">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-3">
          <span class="font-mono text-sm font-semibold">{{ t.number }}</span>
          <span class="badge" :class="statusBadge[t.status]">{{ t.status.replace('_', ' ') }}</span>
          <span class="badge" :class="t.toStoreId === here ? 'bg-indigo-50 text-indigo-700' : 'bg-amber-50 text-amber-700'">{{ t.toStoreId === here ? 'incoming' : 'outgoing' }}</span>
        </div>
        <div class="flex gap-2">
          <button v-if="t.status === 'in_transit' && t.toStoreId === here" class="btn-primary py-1.5" @click="startReceive(t)">Receive</button>
          <button v-if="t.status === 'in_transit' && t.fromStoreId === here" class="btn-secondary py-1.5" @click="cancel(t)">Cancel</button>
        </div>
      </div>
      <div class="mt-2 text-sm text-slate-600">
        <strong>{{ t.fromName }}</strong> → <strong>{{ t.toName }}</strong> · {{ units(t) }} units · sent {{ dateTime(t.sentAt, session.currentStore?.timezone) }} by {{ t.sentByName }}
        <span v-if="t.receivedAt"> · received {{ dateTime(t.receivedAt, session.currentStore?.timezone) }} by {{ t.receivedByName }}</span>
      </div>
      <div class="mt-2 flex flex-wrap gap-1.5">
        <span v-for="l in t.lines" :key="l.id" class="badge bg-slate-100 text-slate-700">
          {{ l.label }} × {{ l.qtySent }}<template v-if="l.qtyReceived !== null && l.qtyReceived !== l.qtySent">&nbsp;(got {{ l.qtyReceived }})</template>
        </span>
      </div>
      <p v-if="shortfall(t)" class="mt-2 text-sm text-rose-600">Short by {{ shortfall(t) }} unit(s){{ t.receiveNote ? ` – ${t.receiveNote}` : '' }}</p>
      <p v-if="t.note" class="mt-1 text-xs text-slate-400">{{ t.note }}</p>
    </div>
    <div v-if="!list.length" class="card p-10 text-center text-slate-500">No transfers for this location yet.</div>
  </div>

  <Modal v-if="creating" title="New transfer" wide @close="creating = false">
    <div class="mb-3 grid gap-3 sm:grid-cols-2">
      <div><span class="label">From</span><div class="input bg-slate-50">{{ session.currentStore?.name }}</div></div>
      <div>
        <label class="label" for="dest">To</label>
        <select id="dest" v-model="dest" class="input">
          <option v-for="s in directory.filter((d) => d.id !== here)" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </div>
    </div>
    <VariantPicker type="product" @pick="addLine" />
    <table v-if="lines.length" class="table mt-3">
      <thead><tr><th>Item</th><th class="text-right">Available</th><th class="w-28">Send</th><th /></tr></thead>
      <tbody>
        <tr v-for="(l, i) in lines" :key="l.variant.id">
          <td>{{ l.variant.label }}</td>
          <td class="text-right tabular-nums text-slate-500">{{ l.variant.onHand }}</td>
          <td><input v-model.number="l.qty" type="number" min="1" class="input py-1" :aria-label="`Send quantity for ${l.variant.label}`" /></td>
          <td class="text-right"><button class="btn-ghost px-2 text-rose-600" @click="lines.splice(i, 1)">✕</button></td>
        </tr>
      </tbody>
    </table>
    <div class="mt-3"><label class="label" for="t-note">Note</label><input id="t-note" v-model="note" class="input" placeholder="e.g. Weekly restock" /></div>
    <template #footer>
      <button class="btn-secondary" @click="creating = false">Cancel</button>
      <button class="btn-primary" :disabled="busy || !lines.length || !dest" @click="send">Send</button>
    </template>
  </Modal>

  <Modal v-if="receiving" :title="`Receive ${receiving.number}`" @close="receiving = null">
    <p class="mb-3 text-sm text-slate-500">Count what actually arrived. Anything short is recorded on the transfer.</p>
    <table class="table">
      <thead><tr><th>Item</th><th class="text-right">Sent</th><th class="w-28">Received</th></tr></thead>
      <tbody>
        <tr v-for="l in receiving.lines" :key="l.id">
          <td>{{ l.label }}</td>
          <td class="text-right tabular-nums">{{ l.qtySent }}</td>
          <td><input v-model.number="recQty[l.id]" type="number" min="0" :max="l.qtySent" class="input py-1" :aria-label="`Received quantity for ${l.label}`" /></td>
        </tr>
      </tbody>
    </table>
    <div class="mt-3"><label class="label" for="r-note">Note</label><input id="r-note" v-model="recNote" class="input" placeholder="Damage, missing items…" /></div>
    <template #footer>
      <button class="btn-secondary" @click="receiving = null">Cancel</button>
      <button class="btn-primary" :disabled="busy" @click="receive">Confirm receipt</button>
    </template>
  </Modal>
</template>
