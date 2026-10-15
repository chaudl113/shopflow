<script setup lang="ts">
import { computed, ref } from 'vue';
import { PlusIcon, XIcon } from '@lucide/vue';
import Modal from '@/components/Modal.vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
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

function setMethod(i: number, m: unknown) {
  // A single-select toggle group emits '' when the active item is clicked again; keep the current method.
  if (m) rows.value[i]!.method = m as Method;
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
    <div class="mb-4 rounded-xl bg-primary p-4 text-center text-primary-foreground">
      <div class="text-xs uppercase tracking-wide opacity-75">Total due</div>
      <div class="text-3xl font-semibold tabular-nums" data-testid="pay-total">{{ money(totalCents) }}</div>
    </div>

    <div v-for="(r, i) in rows" :key="i" class="mb-3 rounded-lg border p-3">
      <ToggleGroup
        type="single"
        variant="outline"
        class="mb-2 w-full"
        :model-value="r.method"
        :aria-label="`Payment ${i + 1} method`"
        @update:model-value="setMethod(i, $event)"
      >
        <ToggleGroupItem v-for="m in methods" :key="m.id" :value="m.id" class="flex-1 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
          {{ m.label }}
        </ToggleGroupItem>
      </ToggleGroup>
      <div class="flex gap-2">
        <Input v-model="r.amount" class="h-11 text-right text-lg tabular-nums" inputmode="decimal" :aria-label="`Payment ${i + 1} amount`" />
        <Button v-if="rows.length > 1" variant="ghost" size="icon" class="size-11 text-destructive" aria-label="Remove payment" @click="rows.splice(i, 1)"><XIcon /></Button>
      </div>
      <div v-if="i === rows.length - 1 && r.method === 'cash'" class="mt-2 flex flex-wrap gap-1.5">
        <Button v-for="c in quickCash(dueBeforeLast)" :key="c" variant="secondary" size="xs" class="tabular-nums" @click="cashQuick(c)">{{ money(c) }}</Button>
      </div>
    </div>
    <Button v-if="status.dueCents > 0" variant="ghost" size="sm" class="mb-3 text-primary" @click="addSplit"><PlusIcon /> Split payment</Button>

    <dl class="space-y-1 text-sm">
      <div class="flex justify-between"><dt class="text-muted-foreground">Tendered</dt><dd class="tabular-nums">{{ money(status.paidCents) }}</dd></div>
      <div v-if="status.dueCents > 0" class="flex justify-between font-medium text-destructive"><dt>Still due</dt><dd class="tabular-nums">{{ money(status.dueCents) }}</dd></div>
      <div v-if="status.changeCents > 0" class="flex justify-between text-lg font-semibold text-emerald-600 dark:text-emerald-400"><dt>Change</dt><dd class="tabular-nums" data-testid="change-due">{{ money(status.changeCents) }}</dd></div>
      <p v-if="status.paidCents > totalCents && !status.valid" class="text-xs text-destructive">Only cash can be over-tendered.</p>
    </dl>

    <template #footer>
      <Button variant="outline" @click="emit('close')">Back</Button>
      <Button class="px-6" :disabled="!status.valid || busy" @click="submit">Complete sale</Button>
    </template>
  </Modal>
</template>
