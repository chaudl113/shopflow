<script setup lang="ts">
import { computed, ref } from 'vue';
import Modal from '@/components/Modal.vue';
import { money, parseMoney } from '@/lib/format';
import { quickCash, tenderStatus, type Method } from '@/lib/tender';

const props = defineProps<{ totalCents: number; busy: boolean }>();
const emit = defineEmits<{ close: []; pay: [{ method: Method; amountCents: number }[]] }>();

interface Row {
  method: Method;
  amount: string;
}
const rows = ref<Row[]>([{ method: 'card', amount: (props.totalCents / 100).toFixed(2) }]);
const tenders = computed(() => rows.value.map((r) => ({ method: r.method, amountCents: parseMoney(r.amount) ?? 0 })));
const status = computed(() => tenderStatus(props.totalCents, tenders.value));
const methods: { id: Method; label: string }[] = [
  { id: 'cash', label: 'Cash' },
  { id: 'card', label: 'Card' },
  { id: 'other', label: 'Other' },
];

function setMethod(i: number, m: Method) {
  rows.value[i]!.method = m;
}
function addSplit() {
  rows.value.push({ method: 'cash', amount: (status.value.dueCents / 100).toFixed(2) });
}
function cashQuick(cents: number) {
  const last = rows.value[rows.value.length - 1]!;
  last.method = 'cash';
  last.amount = (cents / 100).toFixed(2);
}
const dueBeforeLast = computed(() => Math.max(props.totalCents - tenders.value.slice(0, -1).reduce((s, t) => s + t.amountCents, 0), 0));

function submit() {
  if (!status.value.valid) return;
  emit('pay', tenders.value.filter((t) => t.amountCents > 0));
}
</script>

<template>
  <Modal title="Take payment" @close="emit('close')">
    <div class="mb-4 rounded-xl bg-slate-900 p-4 text-center text-white">
      <div class="text-xs uppercase tracking-wide text-slate-400">Total due</div>
      <div class="text-3xl font-semibold tabular-nums" data-testid="pay-total">{{ money(totalCents) }}</div>
    </div>

    <div v-for="(r, i) in rows" :key="i" class="mb-3 rounded-lg border border-slate-200 p-3">
      <div class="mb-2 flex gap-1.5" role="radiogroup" :aria-label="`Payment ${i + 1} method`">
        <button
          v-for="m in methods"
          :key="m.id"
          type="button"
          class="btn flex-1 border"
          :class="r.method === m.id ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-slate-700'"
          :aria-pressed="r.method === m.id"
          @click="setMethod(i, m.id)"
        >
          {{ m.label }}
        </button>
      </div>
      <div class="flex gap-2">
        <input v-model="r.amount" class="input text-right text-lg tabular-nums" inputmode="decimal" :aria-label="`Payment ${i + 1} amount`" />
        <button v-if="rows.length > 1" type="button" class="btn-ghost text-rose-600" aria-label="Remove payment" @click="rows.splice(i, 1)">✕</button>
      </div>
      <div v-if="i === rows.length - 1 && r.method === 'cash'" class="mt-2 flex flex-wrap gap-1.5">
        <button v-for="c in quickCash(dueBeforeLast)" :key="c" type="button" class="btn-secondary px-2.5 py-1 text-xs" @click="cashQuick(c)">{{ money(c) }}</button>
      </div>
    </div>
    <button v-if="status.dueCents > 0" type="button" class="btn-ghost mb-3 text-indigo-600" @click="addSplit">+ Split payment</button>

    <dl class="space-y-1 text-sm">
      <div class="flex justify-between"><dt class="text-slate-500">Tendered</dt><dd class="tabular-nums">{{ money(status.paidCents) }}</dd></div>
      <div v-if="status.dueCents > 0" class="flex justify-between font-medium text-rose-600"><dt>Still due</dt><dd class="tabular-nums">{{ money(status.dueCents) }}</dd></div>
      <div v-if="status.changeCents > 0" class="flex justify-between text-lg font-semibold text-emerald-700"><dt>Change</dt><dd class="tabular-nums" data-testid="change-due">{{ money(status.changeCents) }}</dd></div>
      <p v-if="status.paidCents > totalCents && !status.valid" class="text-xs text-rose-600">Only cash can be over-tendered.</p>
    </dl>

    <template #footer>
      <button class="btn-secondary" @click="emit('close')">Back</button>
      <button class="btn-primary px-6" :disabled="!status.valid || busy" @click="submit">Complete sale</button>
    </template>
  </Modal>
</template>
