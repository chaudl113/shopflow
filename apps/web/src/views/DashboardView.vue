<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { DateTime } from 'luxon';
import { VisAxis, VisStackedBar, VisXYContainer } from '@unovis/vue';
import { AlertTriangleIcon, ArrowRightIcon, TrendingDownIcon, TrendingUpIcon } from '@lucide/vue';
import PageHeader from '@/components/PageHeader.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartCrosshair, ChartTooltip, ChartTooltipContent, componentToString, type ChartConfig } from '@/components/ui/chart';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { toast } from '@/lib/notify';
import { change, percent, type LowStockItem, type SalesReport } from '@/lib/reports';
import { useSession } from '@/stores/session';

const session = useSession();

const PRESETS = { today: 'Today', '7d': '7 days', '30d': '30 days', '90d': '90 days' } as const;
type Preset = keyof typeof PRESETS;
const preset = ref<Preset>('30d');
const setPreset = (v: unknown) => v && (preset.value = v as Preset);

const ALL = 'all';
const shops = computed(() => session.stores.filter((s) => s.kind === 'store'));
const scope = ref<string>(ALL);
const scopeStore = computed(() => shops.value.find((s) => s.id === scope.value) ?? null);
// "Today" depends on where the shop is; for the combined view use the first store's zone.
const zone = computed(() => scopeStore.value?.timezone ?? shops.value[0]?.timezone ?? 'local');

const range = computed(() => {
  const today = DateTime.now().setZone(zone.value).startOf('day');
  const days = preset.value === 'today' ? 1 : Number.parseInt(preset.value);
  const from = today.minus({ days: days - 1 });
  return { from, to: today, prevFrom: from.minus({ days }), prevTo: from.minus({ days: 1 }) };
});
const rangeLabel = computed(() => {
  const { from, to } = range.value;
  return from.equals(to) ? to.toFormat('cccc, LLL d') : `${from.toFormat('LLL d')} – ${to.toFormat('LLL d, yyyy')}`;
});

const report = ref<SalesReport | null>(null);
const previous = ref<SalesReport | null>(null);
const lowStock = ref<LowStockItem[]>([]);
const loading = ref(false);
/** Which range/scope the numbers on screen belong to; a slow older response must not overwrite a newer one. */
const loaded = ref('');
let latest = 0;

async function load() {
  const storeId = scopeStore.value?.id;
  const { from, to, prevFrom, prevTo } = range.value;
  const key = `${preset.value}:${scope.value}`;
  const seq = ++latest;
  loading.value = true;
  try {
    const [now, before, low] = await Promise.all([
      api.get<SalesReport>('/reports/sales', { storeId, from: from.toISODate(), to: to.toISODate() }),
      api.get<SalesReport>('/reports/sales', { storeId, from: prevFrom.toISODate(), to: prevTo.toISODate() }),
      api.get<{ items: LowStockItem[] }>('/reports/low-stock', { storeId }),
    ]);
    if (seq !== latest) return;
    report.value = now;
    previous.value = before;
    lowStock.value = low.items;
    loaded.value = key;
  } catch (e) {
    toast.error(e);
  } finally {
    if (seq === latest) loading.value = false;
  }
}
watch([preset, scope, () => session.stores.length], load, { immediate: true });

const t = computed(() => report.value?.totals);
const p = computed(() => previous.value?.totals);
const kpis = computed(() => {
  if (!t.value || !p.value) return [];
  const margin = (x: SalesReport['totals']) => (x.netSalesCents ? x.grossMarginCents / x.netSalesCents : 0);
  return [
    { label: 'Net sales', value: money(t.value.netSalesCents), delta: change(t.value.netSalesCents, p.value.netSalesCents), note: `${money(t.value.servicesCents)} services · ${money(t.value.retailCents)} retail` },
    { label: 'Gross margin', value: money(t.value.grossMarginCents), delta: change(t.value.grossMarginCents, p.value.grossMarginCents), note: `${percent(margin(t.value))} of net sales · retail at standard cost` },
    { label: 'Transactions', value: t.value.salesCount.toLocaleString(), delta: change(t.value.salesCount, p.value.salesCount), note: `Average ticket ${money(t.value.avgTicketCents)} incl. tax` },
    { label: 'Refunds', value: money(t.value.refundsCents), delta: change(t.value.refundsCents, p.value.refundsCents), note: `${t.value.itemsSold} retail items sold`, lowerIsBetter: true },
  ];
});
const deltaTone = (d: number, lowerIsBetter = false) => ((d >= 0) !== lowerIsBetter ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive');

// Chart: services and retail stacked per day, in dollars.
const chartConfig = {
  services: { label: 'Services', color: 'var(--chart-1)' },
  retail: { label: 'Retail', color: 'var(--chart-2)' },
} satisfies ChartConfig;
type Bar = { i: number; day: string; services: number; retail: number };
const bars = computed<Bar[]>(() =>
  (report.value?.byDay ?? []).map((d, i) => ({ i, day: d.day, services: d.servicesCents / 100, retail: d.retailCents / 100 })),
);
const dayLabel = (i: number | Date) => {
  const d = bars.value[Math.round(Number(i))];
  return d ? DateTime.fromISO(d.day).toFormat(bars.value.length > 1 ? 'ccc, LLL d' : 'cccc') : '';
};
const tickLabel = (i: number) => {
  const d = bars.value[i];
  return d ? DateTime.fromISO(d.day).toFormat('LLL d') : '';
};
const dollars = (v: number) => money(Math.round(v * 100));
const tooltip = componentToString(chartConfig, ChartTooltipContent, { labelFormatter: dayLabel, valueFormatter: dollars });

const payments = computed(() => {
  const list = report.value?.payments ?? [];
  const total = list.reduce((s, x) => s + x.amountCents, 0);
  return list.map((x) => ({ ...x, share: total ? x.amountCents / total : 0 }));
});
const methodLabel: Record<string, string> = { cash: 'Cash', card: 'Card', other: 'Other' };

const storesTotal = computed(() => (report.value?.byStore ?? []).reduce((s, x) => s + Math.max(x.netSalesCents, 0), 0));
const showStores = computed(() => !scopeStore.value && (report.value?.byStore.length ?? 0) > 1);
</script>

<template>
  <div :data-loaded="loaded" :aria-busy="loading">
    <PageHeader title="Dashboard" :subtitle="`${rangeLabel} · net of discounts, before tax · refunds count on the day they happen`">
      <ToggleGroup :model-value="preset" type="single" variant="outline" size="sm" aria-label="Date range" @update:model-value="setPreset">
        <ToggleGroupItem v-for="(label, key) in PRESETS" :key="key" :value="key" :data-testid="`range-${key}`">{{ label }}</ToggleGroupItem>
      </ToggleGroup>
      <Select v-model="scope">
        <SelectTrigger size="sm" class="min-w-40" aria-label="Stores in report" data-testid="report-scope">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem :value="ALL">{{ shops.length > 1 ? 'All stores' : 'My stores' }}</SelectItem>
          <SelectItem v-for="s in shops" :key="s.id" :value="s.id">{{ s.name }}</SelectItem>
        </SelectContent>
      </Select>
    </PageHeader>

    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <template v-if="!kpis.length">
        <Skeleton v-for="i in 4" :key="i" class="h-32 rounded-xl" />
      </template>
      <Card v-for="k in kpis" :key="k.label" class="gap-2" :data-testid="`kpi-${k.label.toLowerCase().replace(' ', '-')}`">
        <CardHeader>
          <CardDescription>{{ k.label }}</CardDescription>
          <CardTitle class="text-2xl font-semibold tabular-nums">{{ k.value }}</CardTitle>
          <CardAction v-if="k.delta !== null">
            <Badge variant="outline" :class="deltaTone(k.delta, k.lowerIsBetter)">
              <TrendingUpIcon v-if="k.delta >= 0" />
              <TrendingDownIcon v-else />
              {{ k.delta >= 0 ? '+' : '' }}{{ percent(k.delta) }}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter class="text-xs text-muted-foreground">{{ k.note }}</CardFooter>
      </Card>
    </div>

    <div class="mt-4 grid gap-4 xl:grid-cols-3">
      <Card class="xl:col-span-2">
        <CardHeader>
          <CardTitle>Net sales by day</CardTitle>
          <CardDescription>Services and retail, in each store's local day</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton v-if="!report" class="h-64 w-full" />
          <ChartContainer v-else :config="chartConfig" class="aspect-auto h-64 w-full" cursor data-testid="sales-chart">
            <VisXYContainer :data="bars" :padding="{ top: 8 }" :y-domain-min-constraint="[0, 0]">
              <VisStackedBar
                :x="(d: Bar) => d.i"
                :y="[(d: Bar) => d.services, (d: Bar) => d.retail]"
                :color="[chartConfig.services.color, chartConfig.retail.color]"
                :rounded-corners="3"
                :bar-padding="0.2"
              />
              <VisAxis type="x" :tick-line="false" :domain-line="false" :grid-line="false" :num-ticks="Math.min(bars.length, 8)" :tick-format="tickLabel" />
              <VisAxis type="y" :num-ticks="4" :tick-line="false" :domain-line="false" :tick-format="(v: number) => `$${v.toLocaleString()}`" />
              <ChartTooltip />
              <ChartCrosshair :template="tooltip" color="#0000" />
            </VisXYContainer>
          </ChartContainer>
        </CardContent>
        <CardFooter class="gap-4 text-xs text-muted-foreground">
          <span v-for="(c, key) in chartConfig" :key="key" class="flex items-center gap-1.5">
            <span class="size-2.5 rounded-sm" :style="{ background: c.color }" /> {{ c.label }}
          </span>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment mix</CardTitle>
          <CardDescription>Money taken at the till, after refunds</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <p v-if="report && !payments.length" class="text-sm text-muted-foreground">No payments in this period.</p>
          <div v-for="m in payments" :key="m.method" class="space-y-1.5">
            <div class="flex justify-between text-sm">
              <span>{{ methodLabel[m.method] ?? m.method }}</span>
              <span class="tabular-nums">{{ money(m.amountCents) }} <span class="text-muted-foreground">· {{ percent(m.share) }}</span></span>
            </div>
            <Progress :model-value="m.share * 100" />
          </div>
          <template v-if="showStores">
            <div class="pt-2 text-sm font-medium">Stores</div>
            <div v-for="s in report!.byStore" :key="s.storeId" class="space-y-1.5" data-testid="store-row">
              <div class="flex justify-between text-sm">
                <span>{{ s.name }}</span>
                <span class="tabular-nums">{{ money(s.netSalesCents) }} <span class="text-muted-foreground">· {{ s.salesCount }} sales</span></span>
              </div>
              <Progress :model-value="storesTotal ? (Math.max(s.netSalesCents, 0) / storesTotal) * 100 : 0" />
            </div>
          </template>
        </CardContent>
      </Card>
    </div>

    <div class="mt-4 grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Team</CardTitle>
          <CardDescription>Services go to who performed them, retail to who rang it up</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead class="text-right">Services</TableHead>
                <TableHead class="text-right">Retail</TableHead>
                <TableHead class="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="s in report?.byStaff ?? []" :key="s.userId">
                <TableCell>
                  <span class="flex items-center gap-2">
                    <span class="size-2 rounded-full" :style="{ background: s.color }" />
                    {{ s.name }}
                    <span v-if="s.services" class="text-xs text-muted-foreground">{{ s.services }} appts</span>
                  </span>
                </TableCell>
                <TableCell class="text-right tabular-nums">{{ money(s.servicesCents) }}</TableCell>
                <TableCell class="text-right tabular-nums">{{ money(s.retailCents) }}</TableCell>
                <TableCell class="text-right font-medium tabular-nums">{{ money(s.netSalesCents) }}</TableCell>
              </TableRow>
              <TableEmpty v-if="report && !report.byStaff.length" :colspan="4">No sales in this period.</TableEmpty>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top sellers</CardTitle>
          <CardDescription>By net sales</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead class="text-right">Qty</TableHead>
                <TableHead class="text-right">Net sales</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="s in report?.topSellers ?? []" :key="s.variantId" data-testid="top-seller">
                <TableCell>
                  {{ s.name }}
                  <Badge v-if="s.isService" variant="secondary" class="ml-1">Service</Badge>
                </TableCell>
                <TableCell class="text-right tabular-nums">{{ s.qty }}</TableCell>
                <TableCell class="text-right tabular-nums">{{ money(s.netSalesCents) }}</TableCell>
              </TableRow>
              <TableEmpty v-if="report && !report.topSellers.length" :colspan="3">No sales in this period.</TableEmpty>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>

    <Card class="mt-4">
      <CardHeader>
        <CardTitle class="flex items-center gap-2"><AlertTriangleIcon class="size-4 text-amber-500" /> Low stock</CardTitle>
        <CardDescription>At or below the reorder level right now, with stock already on the way</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" as-child>
            <RouterLink to="/transfers">Transfers <ArrowRightIcon /></RouterLink>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Empty v-if="!lowStock.length && !loading" class="py-6">
          <EmptyHeader>
            <EmptyTitle>Nothing to reorder</EmptyTitle>
            <EmptyDescription>Every item is above its reorder level.</EmptyDescription>
          </EmptyHeader>
        </Empty>
        <Table v-else>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Store</TableHead>
              <TableHead class="text-right">On hand</TableHead>
              <TableHead class="text-right">Reorder at</TableHead>
              <TableHead class="text-right">On the way</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="i in lowStock" :key="i.storeId + i.variantId" data-testid="low-stock-row">
              <TableCell>
                {{ i.label }} <span class="ml-1 font-mono text-xs text-muted-foreground">{{ i.sku }}</span>
              </TableCell>
              <TableCell>{{ i.storeName }}</TableCell>
              <TableCell class="text-right tabular-nums">
                <Badge :variant="i.onHand <= 0 ? 'destructive' : 'outline'">{{ i.onHand }}</Badge>
              </TableCell>
              <TableCell class="text-right tabular-nums">{{ i.reorderLevel }}</TableCell>
              <TableCell class="text-right tabular-nums">
                <span v-if="i.inboundQty" class="text-emerald-600 dark:text-emerald-400">+{{ i.inboundQty }}</span>
                <span v-else class="text-muted-foreground">—</span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </div>
</template>
