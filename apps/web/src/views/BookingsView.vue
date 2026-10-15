<script setup lang="ts">
import { CalendarClockIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon, ExternalLinkIcon, GlobeIcon, PlusIcon, ShoppingCartIcon, StoreIcon, UserXIcon, XIcon } from '@lucide/vue';
import { DateTime } from 'luxon';
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import BookingEditor from '@/components/BookingEditor.vue';
import DatePicker from '@/components/DatePicker.vue';
import Modal from '@/components/Modal.vue';
import PageHeader from '@/components/PageHeader.vue';
import TeamHoursEditor from '@/components/TeamHoursEditor.vue';
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
import { ButtonGroup } from '@/components/ui/button-group';
import { Card } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { api } from '@/lib/api';
import { hoursLabel, statusLabel, type Booking, type BookingStatus, type TeamSchedule } from '@/lib/booking';
import { money } from '@/lib/format';
import { toast } from '@/lib/notify';
import type { VariantView } from '@/lib/types';
import { useSession } from '@/stores/session';

const session = useSession();
const router = useRouter();
const store = computed(() => session.currentStore);
const tz = computed(() => store.value?.timezone ?? 'America/New_York');
const isStore = computed(() => store.value?.kind === 'store');
const canEdit = computed(() => session.can('owner', 'manager', 'cashier'));

const today = computed(() => DateTime.now().setZone(tz.value).toISODate()!);
const anchor = ref(DateTime.now().setZone(tz.value).toISODate()!);
const weekStart = computed(() => DateTime.fromISO(anchor.value, { zone: tz.value }).startOf('week'));
const days = computed(() => Array.from({ length: 7 }, (_, i) => weekStart.value.plus({ days: i })));
const rangeLabel = computed(() => {
  const a = weekStart.value;
  const b = a.plus({ days: 6 });
  return a.month === b.month ? `${a.toFormat('LLL d')} – ${b.toFormat('d, yyyy')}` : `${a.toFormat('LLL d')} – ${b.toFormat('LLL d, yyyy')}`;
});

const team = ref<TeamSchedule[]>([]);
const services = ref<VariantView[]>([]);
const list = ref<Booking[]>([]);
const loaded = ref(false);

async function loadWeek() {
  if (!isStore.value) return;
  const from = weekStart.value;
  list.value = (
    await api.get<{ bookings: Booking[] }>('/bookings', { storeId: session.storeId, from: from.toUTC().toISO(), to: from.plus({ days: 7 }).toUTC().toISO() })
  ).bookings;
  loaded.value = true;
}
async function loadTeam() {
  team.value = (await api.get<{ team: TeamSchedule[] }>('/bookings/team', { storeId: session.storeId })).team;
}
onMounted(async () => {
  if (!isStore.value) return;
  const [, s] = await Promise.all([loadTeam(), api.get<{ variants: VariantView[] }>('/products/variants', { storeId: session.storeId, type: 'service' })]);
  services.value = s.variants.filter((v) => v.durationMin);
  await loadWeek();
});
watch(weekStart, loadWeek);

const shift = (weeks: number) => (anchor.value = DateTime.fromISO(anchor.value).plus({ weeks }).toISODate()!);

const localDate = (iso: string) => DateTime.fromISO(iso).setZone(tz.value).toISODate();
const hhmm = (iso: string) => DateTime.fromISO(iso).setZone(tz.value).toFormat('h:mm');
const cell = (staffId: string, day: DateTime) => list.value.filter((b) => b.staffId === staffId && localDate(b.startsAt) === day.toISODate());
const hoursFor = (t: TeamSchedule, day: DateTime) => t.hours.filter((h) => h.weekday === day.weekday);
const dayCount = (day: DateTime) => list.value.filter((b) => localDate(b.startsAt) === day.toISODate() && (b.status === 'booked' || b.status === 'completed')).length;
// People on the team plus anyone who has a booking this week but no longer has hours here.
const rows = computed(() => {
  const extra = list.value.filter((b) => !team.value.some((t) => t.id === b.staffId));
  const ghosts = [...new Map(extra.map((b) => [b.staffId, { id: b.staffId, name: b.staffName, color: b.staffColor, role: 'staff', hours: [], productIds: [] }])).values()];
  return [...team.value, ...ghosts];
});

const chipClass: Record<BookingStatus, string> = {
  booked: 'bg-card hover:bg-accent',
  completed: 'bg-muted/60 text-muted-foreground',
  cancelled: 'bg-transparent text-muted-foreground line-through opacity-60',
  no_show: 'bg-transparent text-muted-foreground opacity-70',
};

// Details / actions
const open = ref<Booking | null>(null);
const editing = ref<{ booking: Booking | null; date: string } | null>(null);
const confirmCancel = ref(false);
const hoursOpen = ref(false);

async function setStatus(b: Booking, status: 'cancelled' | 'no_show' | 'booked') {
  try {
    const res = await api.patch<{ booking: Booking }>(`/bookings/${b.id}`, { status });
    toast.success(`${b.reference}: ${statusLabel[status].toLowerCase()}`);
    open.value = res.booking;
    confirmCancel.value = false;
    loadWeek();
  } catch (e) {
    toast.error(e);
  }
}
function onSaved(b: Booking) {
  editing.value = null;
  open.value = null;
  anchor.value = localDate(b.startsAt)!;
  loadWeek();
}
const checkout = (b: Booking) => router.push({ path: '/pos', query: { booking: b.id } });
const bookingPage = computed(() => (store.value ? `/book/${store.value.slug}` : ''));
const openReceipt = (id: string) => window.open(`/receipt/${id}`, '_blank', 'width=420,height=720');
</script>

<template>
  <PageHeader title="Bookings" :subtitle="isStore ? `Team calendar at ${store?.name} · times in ${tz.replace('_', ' ')}` : undefined">
    <template v-if="isStore">
      <Button v-if="store?.bookingEnabled" variant="outline" as="a" :href="bookingPage" target="_blank"><GlobeIcon /> Booking page <ExternalLinkIcon class="opacity-60" /></Button>
      <Button v-if="session.can('owner', 'manager')" variant="outline" @click="hoursOpen = true"><CalendarClockIcon /> Team hours</Button>
      <Button v-if="canEdit" @click="editing = { booking: null, date: anchor < today ? today : anchor }"><PlusIcon /> New booking</Button>
    </template>
  </PageHeader>

  <Empty v-if="!isStore" class="border">
    <EmptyHeader>
      <EmptyMedia variant="icon"><StoreIcon /></EmptyMedia>
      <EmptyTitle>Bookings are per store</EmptyTitle>
      <EmptyDescription>Switch to a store to see its calendar.</EmptyDescription>
    </EmptyHeader>
  </Empty>

  <template v-else>
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <ButtonGroup>
        <Button variant="outline" size="icon" aria-label="Previous week" @click="shift(-1)"><ChevronLeftIcon /></Button>
        <Button variant="outline" @click="anchor = today">Today</Button>
        <Button variant="outline" size="icon" aria-label="Next week" @click="shift(1)"><ChevronRightIcon /></Button>
      </ButtonGroup>
      <DatePicker v-model="anchor" format="'Week of' LLL d" />
      <h2 class="ml-1 text-base font-semibold" data-testid="week-label">{{ rangeLabel }}</h2>
      <div class="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
        <span class="flex items-center gap-1"><GlobeIcon class="size-3.5" /> online</span>
        <span class="flex items-center gap-1"><CheckIcon class="size-3.5" /> paid</span>
      </div>
    </div>

    <Card class="overflow-x-auto py-0">
      <div class="grid min-w-[1060px] grid-cols-[150px_repeat(7,minmax(130px,1fr))]" data-testid="week-grid">
        <div class="sticky left-0 z-10 border-b bg-card" />
        <div
          v-for="d in days"
          :key="d.toISODate()!"
          class="border-b border-l px-2 py-2 text-center"
          :class="d.toISODate() === today ? 'bg-primary/5' : ''"
        >
          <div class="text-xs uppercase text-muted-foreground">{{ d.toFormat('ccc') }}</div>
          <div class="text-sm font-semibold" :class="d.toISODate() === today ? 'text-primary' : ''">{{ d.toFormat('LLL d') }}</div>
          <div class="text-[11px] text-muted-foreground">{{ dayCount(d) }} booked</div>
        </div>

        <template v-for="t in rows" :key="t.id">
          <div class="sticky left-0 z-10 flex items-start gap-2 border-b bg-card px-3 py-3">
            <span class="mt-1.5 size-2.5 shrink-0 rounded-full" :style="{ background: t.color }" />
            <div class="min-w-0">
              <div class="truncate text-sm font-medium">{{ t.name }}</div>
              <div class="text-xs text-muted-foreground">{{ t.hours.length ? `${new Set(t.hours.map((h) => h.weekday)).size} days/wk` : 'no hours here' }}</div>
            </div>
          </div>
          <div
            v-for="d in days"
            :key="t.id + d.toISODate()"
            class="min-h-24 space-y-1 border-b border-l p-1.5"
            :class="[d.toISODate() === today ? 'bg-primary/5' : '', !hoursFor(t, d).length ? 'bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,var(--color-muted)_6px,var(--color-muted)_7px)]' : '']"
          >
            <div class="px-1 text-[11px] text-muted-foreground">{{ hoursFor(t, d).length ? hoursLabel(hoursFor(t, d)) : 'Off' }}</div>
            <button
              v-for="b in cell(t.id, d)"
              :key="b.id"
              class="block w-full rounded-md border border-l-[3px] px-1.5 py-1 text-left text-xs shadow-xs transition-colors"
              :class="chipClass[b.status]"
              :style="{ borderLeftColor: b.staffColor }"
              :data-testid="`booking-${b.reference}`"
              @click="open = b"
            >
              <div class="flex items-center gap-1 font-medium tabular-nums">
                {{ hhmm(b.startsAt) }}
                <GlobeIcon v-if="b.source === 'online'" class="size-3 text-muted-foreground" />
                <CheckIcon v-if="b.status === 'completed'" class="size-3 text-emerald-600" />
                <UserXIcon v-if="b.status === 'no_show'" class="size-3" />
              </div>
              <div class="truncate">{{ b.customerName }}</div>
              <div class="truncate text-muted-foreground">{{ b.serviceName }}</div>
            </button>
          </div>
        </template>
      </div>
      <p v-if="loaded && !rows.length" class="p-8 text-center text-sm text-muted-foreground">No bookable team members at this store yet.</p>
    </Card>
  </template>

  <Modal v-if="open && !editing" :title="`${open.customerName}`" :description="`${open.reference} · ${open.source === 'online' ? 'booked online' : 'booked at the desk'}`" @close="open = null">
    <div class="space-y-3 text-sm">
      <div class="flex items-center gap-2">
        <Badge :variant="open.status === 'booked' ? 'default' : open.status === 'completed' ? 'secondary' : 'outline'">{{ statusLabel[open.status] }}</Badge>
        <span class="text-muted-foreground">{{ money(open.quotedPriceCents) }} quoted</span>
      </div>
      <dl class="grid grid-cols-[100px_1fr] gap-y-1.5">
        <dt class="text-muted-foreground">When</dt>
        <dd class="flex items-center gap-1.5"><ClockIcon class="size-3.5" /> {{ DateTime.fromISO(open.startsAt).setZone(tz).toFormat('ccc, LLL d · h:mm a') }} – {{ DateTime.fromISO(open.endsAt).setZone(tz).toFormat('h:mm a') }}</dd>
        <dt class="text-muted-foreground">Service</dt>
        <dd>{{ open.serviceName }} · {{ open.durationMin }} min</dd>
        <dt class="text-muted-foreground">With</dt>
        <dd class="flex items-center gap-1.5"><span class="size-2 rounded-full" :style="{ background: open.staffColor }" /> {{ open.staffName }}</dd>
        <dt class="text-muted-foreground">Phone</dt>
        <dd>{{ open.customerPhone || '—' }}</dd>
        <template v-if="open.customerEmail">
          <dt class="text-muted-foreground">Email</dt>
          <dd>{{ open.customerEmail }}</dd>
        </template>
        <template v-if="open.note">
          <dt class="text-muted-foreground">Note</dt>
          <dd>{{ open.note }}</dd>
        </template>
      </dl>
    </div>
    <template #footer>
      <template v-if="canEdit && open.status === 'booked'">
        <Button variant="ghost" class="text-destructive sm:mr-auto" @click="confirmCancel = true"><XIcon /> Cancel</Button>
        <Button variant="outline" @click="setStatus(open, 'no_show')"><UserXIcon /> No-show</Button>
        <Button variant="outline" @click="editing = { booking: open, date: localDate(open.startsAt)! }"><CalendarClockIcon /> Reschedule</Button>
        <Button @click="checkout(open)"><ShoppingCartIcon /> Check out</Button>
      </template>
      <Button v-else-if="canEdit && (open.status === 'cancelled' || open.status === 'no_show')" variant="outline" @click="setStatus(open, 'booked')">Restore booking</Button>
      <Button v-else-if="open.saleId" variant="outline" @click="openReceipt(open.saleId)">View receipt</Button>
    </template>
  </Modal>

  <BookingEditor
    v-if="editing && store"
    :store-id="store.id"
    :timezone="tz"
    :services="services"
    :team="team"
    :booking="editing.booking"
    :initial-date="editing.date"
    @close="editing = null"
    @saved="onSaved"
  />

  <TeamHoursEditor v-if="hoursOpen && store" :store-id="store.id" :team="team" :services="services" @close="hoursOpen = false" @saved="(t) => { team = t; hoursOpen = false; }" />

  <AlertDialog :open="confirmCancel && !!open" @update:open="(v: boolean) => !v && (confirmCancel = false)">
    <AlertDialogContent v-if="open">
      <AlertDialogHeader>
        <AlertDialogTitle>Cancel {{ open.customerName }}’s booking?</AlertDialogTitle>
        <AlertDialogDescription>The {{ DateTime.fromISO(open.startsAt).setZone(tz).toFormat('h:mm a') }} slot with {{ open.staffName }} becomes free again. You can restore it later if it is still free.</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Keep it</AlertDialogCancel>
        <AlertDialogAction variant="destructive" @click="setStatus(open, 'cancelled')">Cancel booking</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
