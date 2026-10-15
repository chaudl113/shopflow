<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import Modal from '@/components/Modal.vue';
import OpenShiftForm from '@/components/OpenShiftForm.vue';
import PageHeader from '@/components/PageHeader.vue';
import { api } from '@/lib/api';
import { dateTime, money, parseMoney } from '@/lib/format';
import { useSession } from '@/stores/session';
import { useShift, type ShiftSummary } from '@/stores/shift';
import { useToast } from '@/stores/toast';

const session = useSession();
const shift = useShift();
const toast = useToast();
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
const diffClass = (d: number | null) => (d === null ? '' : d === 0 ? 'text-emerald-600' : d < 0 ? 'text-rose-600' : 'text-amber-600');
const denomLabel = (d: number) => (d >= 100 ? `$${d / 100}` : `${d}¢`);
const printPage = () => window.print();
</script>

<template>
  <PageHeader title="Shifts" subtitle="Cash drawer sessions: opening float, takings, count and variance" />

  <div v-if="!isStore" class="card p-8 text-center text-slate-500">Shifts are per store. Switch to a store.</div>
  <template v-else>
    <OpenShiftForm v-if="shift.loaded && !shift.current" class="mb-6" />
    <section v-else-if="shift.current" class="card mb-6 p-5">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div class="text-sm text-slate-500">Open since {{ dateTime(shift.current.shift.openedAt, tz) }}</div>
          <div class="text-lg font-semibold">{{ shift.current.shift.userName }}’s drawer</div>
        </div>
        <div class="flex gap-2">
          <button class="btn-secondary" @click="cashOpen = 'pay_in'">Pay in</button>
          <button class="btn-secondary" @click="cashOpen = 'pay_out'">Pay out</button>
          <button class="btn-primary" @click="startClose">Close shift</button>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div class="rounded-lg bg-slate-50 p-3"><div class="text-xs text-slate-500">Opening float</div><div class="text-lg font-semibold tabular-nums">{{ money(shift.current.shift.openingFloatCents) }}</div></div>
        <div class="rounded-lg bg-slate-50 p-3"><div class="text-xs text-slate-500">Cash sales</div><div class="text-lg font-semibold tabular-nums">{{ money(shift.current.byMethod.cash.inCents) }}</div></div>
        <div class="rounded-lg bg-slate-50 p-3"><div class="text-xs text-slate-500">Card sales</div><div class="text-lg font-semibold tabular-nums">{{ money(shift.current.byMethod.card.inCents) }}</div></div>
        <div class="rounded-lg bg-slate-50 p-3"><div class="text-xs text-slate-500">Cash refunds / paid out</div><div class="text-lg font-semibold tabular-nums">{{ money(shift.current.byMethod.cash.outCents + shift.current.payOutCents) }}</div></div>
        <div class="rounded-lg bg-indigo-50 p-3"><div class="text-xs text-indigo-700">Expected in drawer</div><div class="text-lg font-semibold tabular-nums text-indigo-900" data-testid="expected-cash">{{ money(shift.current.expectedCashCents) }}</div></div>
      </div>
      <p class="mt-3 text-sm text-slate-500">{{ shift.current.salesCount }} sales · {{ shift.current.returnsCount }} returns</p>
    </section>

    <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">History</h2>
    <div class="card overflow-x-auto">
      <table class="table">
        <thead><tr><th>Opened</th><th>Cashier</th><th>Status</th><th class="text-right">Expected</th><th class="text-right">Counted</th><th class="text-right">Over / short</th></tr></thead>
        <tbody>
          <tr v-for="s in history" :key="s.id" class="cursor-pointer hover:bg-slate-50" @click="openReport(s.id)">
            <td class="whitespace-nowrap">{{ dateTime(s.openedAt, tz) }}</td>
            <td>{{ s.userName }}</td>
            <td><span class="badge" :class="s.status === 'open' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'">{{ s.status }}</span></td>
            <td class="text-right tabular-nums">{{ s.expectedCashCents === null ? '—' : money(s.expectedCashCents) }}</td>
            <td class="text-right tabular-nums">{{ s.countedCashCents === null ? '—' : money(s.countedCashCents) }}</td>
            <td class="text-right font-medium tabular-nums" :class="diffClass(s.differenceCents)">{{ s.differenceCents === null ? '—' : money(s.differenceCents) }}</td>
          </tr>
          <tr v-if="!history.length"><td colspan="6" class="py-8 text-center text-slate-500">No shifts yet.</td></tr>
        </tbody>
      </table>
    </div>
  </template>

  <Modal v-if="cashOpen" :title="cashOpen === 'pay_in' ? 'Pay in (add cash)' : 'Pay out (remove cash)'" @close="cashOpen = null">
    <div class="space-y-3">
      <div><label class="label" for="cash-amt">Amount ($)</label><input id="cash-amt" v-model="cashAmount" class="input" inputmode="decimal" /></div>
      <div><label class="label" for="cash-reason">Reason</label><input id="cash-reason" v-model="cashReason" class="input" placeholder="e.g. Supplies, change top-up" /></div>
    </div>
    <template #footer><button class="btn-primary" @click="submitCash">Save</button></template>
  </Modal>

  <Modal v-if="closing && shift.current" title="Close shift · count the drawer" @close="closing = false">
    <div class="grid grid-cols-2 gap-2">
      <label v-for="d in denoms" :key="d" class="flex items-center gap-2 text-sm">
        <span class="w-12 text-right font-medium">{{ denomLabel(d) }}</span>
        <span class="text-slate-400">×</span>
        <input v-model.number="counts[d]" type="number" min="0" class="input py-1" :aria-label="`Count of ${denomLabel(d)}`" />
      </label>
    </div>
    <div class="mt-4 flex justify-between rounded-lg bg-slate-50 p-3 text-lg font-semibold">
      <span>Counted</span><span class="tabular-nums" data-testid="counted-total">{{ money(counted) }}</span>
    </div>
    <div class="mt-3"><label class="label" for="close-note">Note</label><input id="close-note" v-model="note" class="input" placeholder="Explain any difference" /></div>
    <p class="mt-2 text-xs text-slate-500">The expected amount is revealed after you submit (blind count).</p>
    <template #footer>
      <button class="btn-secondary" @click="closing = false">Cancel</button>
      <button class="btn-primary" @click="submitClose">Close shift</button>
    </template>
  </Modal>

  <Modal v-if="report" :title="`Shift report · ${report.shift.userName}`" @close="report = null">
    <div class="text-sm" data-testid="shift-report">
      <div class="mb-3 text-slate-500">
        {{ dateTime(report.shift.openedAt, tz) }} → {{ report.shift.closedAt ? dateTime(report.shift.closedAt, tz) : 'open' }}
      </div>
      <dl class="space-y-1">
        <div class="flex justify-between"><dt>Sales ({{ report.salesCount }})</dt><dd class="tabular-nums">{{ money(report.salesTotalCents) }}</dd></div>
        <div class="flex justify-between"><dt>Refunds ({{ report.returnsCount }})</dt><dd class="tabular-nums">−{{ money(report.refundsTotalCents) }}</dd></div>
        <div v-for="(v, m) in report.byMethod" :key="m" class="flex justify-between pl-3 text-slate-500">
          <dt class="capitalize">{{ m }}</dt><dd class="tabular-nums">{{ money(v.inCents) }} in / {{ money(v.outCents) }} out</dd>
        </div>
        <hr class="my-2" />
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
          <p v-if="report.shift.closingNote" class="mt-2 text-slate-500">“{{ report.shift.closingNote }}”</p>
        </template>
        <ul v-if="report.cashMovements.length" class="mt-3 space-y-0.5 text-xs text-slate-500">
          <li v-for="m in report.cashMovements" :key="m.id">{{ m.kind === 'pay_in' ? 'Pay in' : 'Pay out' }} {{ money(m.amountCents) }} – {{ m.reason }}</li>
        </ul>
      </dl>
    </div>
    <template #footer><button class="btn-secondary" @click="printPage">Print</button></template>
  </Modal>
</template>
