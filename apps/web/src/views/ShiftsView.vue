<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ArrowDownToLineIcon, ArrowUpFromLineIcon, LockIcon, PrinterIcon, StoreIcon } from '@lucide/vue';
import Modal from '@/components/Modal.vue';
import OpenShiftForm from '@/components/OpenShiftForm.vue';
import PageHeader from '@/components/PageHeader.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { dateTime, money, parseMoney } from '@/lib/format';
import { useSession } from '@/stores/session';
import { useShift, type ShiftSummary } from '@/stores/shift';
import { toast } from '@/lib/notify';

const session = useSession();
const shift = useShift();
const tz = computed(() => session.currentStore?.timezone);
const history = ref<ShiftSummary['shift'][]>([]);
const report = ref<ShiftSummary | null>(null);
const isStore = computed(() => session.currentStore?.kind === 'store');

async function load() {
  if (!isStore.value) return;
  await shift.load(session.storeId!);
  history.value = (await api.get<{ shifts: ShiftSummary['shift'][] }>('/shifts', { storeId: session.storeId })).shifts;
}
onMounted(load);

// Pay in / out
const cashOpen = ref<'pay_in' | 'pay_out' | null>(null);
const cashAmount = ref('');
const cashReason = ref('');
async function submitCash() {
  try {
    await api.post(`/shifts/${shift.current!.shift.id}/cash`, { kind: cashOpen.value, amountCents: parseMoney(cashAmount.value), reason: cashReason.value });
    cashOpen.value = null;
    cashAmount.value = '';
    cashReason.value = '';
    await load();
  } catch (e) {
    toast.error(e);
  }
}

// Close with a denomination count
const closing = ref(false);
const denoms = [10000, 5000, 2000, 1000, 500, 100, 25, 10, 5, 1];
const counts = ref<Record<number, number>>({});
const counted = computed(() => denoms.reduce((s, d) => s + d * (counts.value[d] ?? 0), 0));
const note = ref('');
function startClose() {
  counts.value = Object.fromEntries(denoms.map((d) => [d, 0]));
  note.value = '';
  closing.value = true;
}
async function submitClose() {
  try {
    const res = await api.post<{ summary: ShiftSummary }>(`/shifts/${shift.current!.shift.id}/close`, { countedCashCents: counted.value, note: note.value });
    closing.value = false;
    report.value = res.summary;
    await load();
  } catch (e) {
    toast.error(e);
  }
}
async function openReport(id: string) {
  report.value = (await api.get<{ summary: ShiftSummary }>(`/shifts/${id}`)).summary;
}
const diffClass = (d: number | null) => (d === null ? '' : d === 0 ? 'text-emerald-600 dark:text-emerald-400' : d < 0 ? 'text-destructive' : 'text-amber-600');
const setCount = (d: number, v: string | number) => (counts.value[d] = Math.max(Math.trunc(Number(v)) || 0, 0));
const denomLabel = (d: number) => (d >= 100 ? `$${d / 100}` : `${d}¢`);
const printPage = () => window.print();
</script>

<template>
  <PageHeader title="Shifts" subtitle="Cash drawer sessions: opening float, takings, count and variance" />

  <Empty v-if="!isStore" class="border">
    <EmptyHeader>
      <EmptyMedia variant="icon"><StoreIcon /></EmptyMedia>
      <EmptyTitle>Shifts are per store</EmptyTitle>
      <EmptyDescription>Switch to a store to see its cash drawer.</EmptyDescription>
    </EmptyHeader>
  </Empty>
  <template v-else>
    <OpenShiftForm v-if="shift.loaded && !shift.current" class="mb-6" />
    <Card v-else-if="shift.current" class="mb-6">
      <CardHeader>
        <CardDescription>Open since {{ dateTime(shift.current.shift.openedAt, tz) }}</CardDescription>
        <CardTitle class="text-lg">{{ shift.current.shift.userName }}’s drawer</CardTitle>
        <CardAction class="flex flex-wrap gap-2">
          <Button variant="outline" @click="cashOpen = 'pay_in'"><ArrowDownToLineIcon /> Pay in</Button>
          <Button variant="outline" @click="cashOpen = 'pay_out'"><ArrowUpFromLineIcon /> Pay out</Button>
          <Button @click="startClose"><LockIcon /> Close shift</Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div class="grid grid-cols-2 gap-3 md:grid-cols-5">
          <div class="rounded-lg bg-muted p-3"><div class="text-xs text-muted-foreground">Opening float</div><div class="text-lg font-semibold tabular-nums">{{ money(shift.current.shift.openingFloatCents) }}</div></div>
          <div class="rounded-lg bg-muted p-3"><div class="text-xs text-muted-foreground">Cash sales</div><div class="text-lg font-semibold tabular-nums">{{ money(shift.current.byMethod.cash.inCents) }}</div></div>
          <div class="rounded-lg bg-muted p-3"><div class="text-xs text-muted-foreground">Card sales</div><div class="text-lg font-semibold tabular-nums">{{ money(shift.current.byMethod.card.inCents) }}</div></div>
          <div class="rounded-lg bg-muted p-3"><div class="text-xs text-muted-foreground">Cash refunds / paid out</div><div class="text-lg font-semibold tabular-nums">{{ money(shift.current.byMethod.cash.outCents + shift.current.payOutCents) }}</div></div>
          <div class="rounded-lg bg-primary/10 p-3"><div class="text-xs text-primary">Expected in drawer</div><div class="text-lg font-semibold tabular-nums text-primary" data-testid="expected-cash">{{ money(shift.current.expectedCashCents) }}</div></div>
        </div>
        <p class="mt-3 text-sm text-muted-foreground">{{ shift.current.salesCount }} sales · {{ shift.current.returnsCount }} returns</p>
      </CardContent>
    </Card>

    <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">History</h2>
    <Card class="py-0">
      <Table>
        <TableHeader><TableRow><TableHead>Opened</TableHead><TableHead>Cashier</TableHead><TableHead>Status</TableHead><TableHead class="text-right">Expected</TableHead><TableHead class="text-right">Counted</TableHead><TableHead class="text-right">Over / short</TableHead></TableRow></TableHeader>
        <TableBody>
          <TableRow v-for="s in history" :key="s.id" class="cursor-pointer" @click="openReport(s.id)">
            <TableCell class="whitespace-nowrap">{{ dateTime(s.openedAt, tz) }}</TableCell>
            <TableCell>{{ s.userName }}</TableCell>
            <TableCell>
              <Badge v-if="s.status === 'open'" class="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">open</Badge>
              <Badge v-else variant="secondary">closed</Badge>
            </TableCell>
            <TableCell class="text-right tabular-nums">{{ s.expectedCashCents === null ? '—' : money(s.expectedCashCents) }}</TableCell>
            <TableCell class="text-right tabular-nums">{{ s.countedCashCents === null ? '—' : money(s.countedCashCents) }}</TableCell>
            <TableCell class="text-right font-medium tabular-nums" :class="diffClass(s.differenceCents)">{{ s.differenceCents === null ? '—' : money(s.differenceCents) }}</TableCell>
          </TableRow>
          <TableEmpty v-if="!history.length" :colspan="6">No shifts yet.</TableEmpty>
        </TableBody>
      </Table>
    </Card>
  </template>

  <Modal v-if="cashOpen" :title="cashOpen === 'pay_in' ? 'Pay in (add cash)' : 'Pay out (remove cash)'" @close="cashOpen = null">
    <div class="space-y-4">
      <Field>
        <FieldLabel for="cash-amt">Amount ($)</FieldLabel>
        <Input id="cash-amt" v-model="cashAmount" inputmode="decimal" />
      </Field>
      <Field>
        <FieldLabel for="cash-reason">Reason</FieldLabel>
        <Input id="cash-reason" v-model="cashReason" placeholder="e.g. Supplies, change top-up" />
      </Field>
    </div>
    <template #footer><Button @click="submitCash">Save</Button></template>
  </Modal>

  <Modal v-if="closing && shift.current" title="Close shift · count the drawer" description="The expected amount is revealed after you submit (blind count)." @close="closing = false">
    <div class="space-y-4">
      <div class="grid grid-cols-2 gap-2">
        <label v-for="d in denoms" :key="d" class="flex items-center gap-2 text-sm">
          <span class="w-12 text-right font-medium">{{ denomLabel(d) }}</span>
          <span class="text-muted-foreground">×</span>
          <Input :model-value="counts[d]" type="number" min="0" class="h-8" :aria-label="`Count of ${denomLabel(d)}`" @update:model-value="setCount(d, $event)" />
        </label>
      </div>
      <div class="flex justify-between rounded-lg bg-muted p-3 text-lg font-semibold">
        <span>Counted</span><span class="tabular-nums" data-testid="counted-total">{{ money(counted) }}</span>
      </div>
      <Field>
        <FieldLabel for="close-note">Note</FieldLabel>
        <Input id="close-note" v-model="note" placeholder="Explain any difference" />
      </Field>
    </div>
    <template #footer>
      <Button variant="outline" @click="closing = false">Cancel</Button>
      <Button @click="submitClose"><LockIcon /> Close shift</Button>
    </template>
  </Modal>

  <Modal v-if="report" :title="`Shift report · ${report.shift.userName}`" :description="`${dateTime(report.shift.openedAt, tz)} → ${report.shift.closedAt ? dateTime(report.shift.closedAt, tz) : 'open'}`" @close="report = null">
    <dl class="space-y-1 text-sm" data-testid="shift-report">
      <div class="flex justify-between"><dt>Sales ({{ report.salesCount }})</dt><dd class="tabular-nums">{{ money(report.salesTotalCents) }}</dd></div>
      <div class="flex justify-between"><dt>Refunds ({{ report.returnsCount }})</dt><dd class="tabular-nums">−{{ money(report.refundsTotalCents) }}</dd></div>
      <div v-for="(v, m) in report.byMethod" :key="m" class="flex justify-between pl-3 text-muted-foreground">
        <dt class="capitalize">{{ m }}</dt><dd class="tabular-nums">{{ money(v.inCents) }} in / {{ money(v.outCents) }} out</dd>
      </div>
      <Separator class="my-2" />
      <div class="flex justify-between"><dt>Opening float</dt><dd class="tabular-nums">{{ money(report.shift.openingFloatCents) }}</dd></div>
      <div class="flex justify-between"><dt>+ Cash taken</dt><dd class="tabular-nums">{{ money(report.byMethod.cash.inCents) }}</dd></div>
      <div class="flex justify-between"><dt>− Cash refunds</dt><dd class="tabular-nums">{{ money(report.byMethod.cash.outCents) }}</dd></div>
      <div class="flex justify-between"><dt>+ Pay-ins / − Pay-outs</dt><dd class="tabular-nums">{{ money(report.payInCents - report.payOutCents) }}</dd></div>
      <div class="flex justify-between font-semibold"><dt>Expected cash</dt><dd class="tabular-nums">{{ money(report.shift.expectedCashCents ?? report.expectedCashCents) }}</dd></div>
      <template v-if="report.shift.status === 'closed'">
        <div class="flex justify-between"><dt>Counted cash</dt><dd class="tabular-nums">{{ money(report.shift.countedCashCents) }}</dd></div>
        <div class="flex justify-between text-base font-semibold" :class="diffClass(report.shift.differenceCents)">
          <dt>{{ (report.shift.differenceCents ?? 0) < 0 ? 'Short' : (report.shift.differenceCents ?? 0) > 0 ? 'Over' : 'Balanced' }}</dt>
          <dd class="tabular-nums" data-testid="shift-difference">{{ money(report.shift.differenceCents) }}</dd>
        </div>
        <p v-if="report.shift.closingNote" class="mt-2 text-muted-foreground">“{{ report.shift.closingNote }}”</p>
      </template>
      <ul v-if="report.cashMovements.length" class="mt-3 space-y-0.5 text-xs text-muted-foreground">
        <li v-for="m in report.cashMovements" :key="m.id">{{ m.kind === 'pay_in' ? 'Pay in' : 'Pay out' }} {{ money(m.amountCents) }} – {{ m.reason }}</li>
      </ul>
    </dl>
    <template #footer><Button variant="outline" @click="printPage"><PrinterIcon /> Print</Button></template>
  </Modal>
</template>
