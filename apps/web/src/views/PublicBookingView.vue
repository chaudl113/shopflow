<script setup lang="ts">
import { parseDate, type DateValue } from '@internationalized/date';
import { ArrowLeftIcon, CalendarCheckIcon, ChevronRightIcon, ClockIcon, MapPinIcon, PhoneIcon, SparklesIcon, UsersIcon } from '@lucide/vue';
import { toTypedSchema } from '@vee-validate/zod';
import { DateTime } from 'luxon';
import { useForm } from 'vee-validate';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { z } from 'zod';
import DemoBanner from '@/components/DemoBanner.vue';
import ThemeToggle from '@/components/ThemeToggle.vue';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError } from '@/lib/api';
import { mergedSlots, slotLabel, type Availability } from '@/lib/booking';
import { money } from '@/lib/format';
import { toast } from '@/lib/notify';

interface Service {
  id: string;
  productId: string;
  name: string;
  category: string;
  durationMin: number;
  priceCents: number;
}
interface Info {
  store: { name: string; slug: string; address: string; phone: string; timezone: string };
  services: Service[];
  staff: { id: string; name: string; color: string; productIds: string[] }[];
}
interface Confirmation {
  reference: string;
  startsAt: string;
  endsAt: string;
  serviceName: string;
  staffName: string;
  storeName: string;
  timezone: string;
}

const route = useRoute();
const slug = String(route.params.slug);
const info = ref<Info | null>(null);
const notFound = ref(false);

type Step = 'service' | 'staff' | 'time' | 'details' | 'done';
const step = ref<Step>('service');
const service = ref<Service | null>(null);
/** null = anyone available */
const staffId = ref<string | null>(null);
const date = ref('');
const slot = ref<string | null>(null);
const avail = ref<Availability | null>(null);
const loadingSlots = ref(false);
const confirmation = ref<Confirmation | null>(null);

const tz = computed(() => info.value?.store.timezone ?? 'America/New_York');
const todayIso = computed(() => DateTime.now().setZone(tz.value).toISODate()!);
const categories = computed(() => [...new Set(info.value?.services.map((s) => s.category) ?? [])]);
const staffForService = computed(() => info.value?.staff.filter((s) => service.value && s.productIds.includes(service.value.productId)) ?? []);
const staffName = computed(() => (staffId.value ? info.value?.staff.find((s) => s.id === staffId.value)?.name : 'Anyone available'));
const slots = computed(() => (avail.value ? mergedSlots(avail.value) : []));
const steps: { id: Step; label: string }[] = [
  { id: 'service', label: 'Service' },
  { id: 'staff', label: 'Stylist' },
  { id: 'time', label: 'Time' },
  { id: 'details', label: 'Details' },
];
const stepIndex = computed(() => steps.findIndex((s) => s.id === step.value));

onMounted(async () => {
  try {
    info.value = await api.get<Info>(`/public/stores/${slug}`);
    date.value = todayIso.value;
  } catch {
    notFound.value = true;
  }
});

function chooseService(s: Service) {
  service.value = s;
  staffId.value = null;
  step.value = staffForService.value.length > 1 ? 'staff' : 'time';
  if (staffForService.value.length === 1) staffId.value = staffForService.value[0]!.id;
}
function chooseStaff(id: string | null) {
  staffId.value = id;
  step.value = 'time';
}

async function loadSlots() {
  if (!service.value || !date.value || step.value !== 'time') return;
  loadingSlots.value = true;
  slot.value = null;
  try {
    avail.value = await api.get<Availability>(`/public/stores/${slug}/availability`, { variantId: service.value.id, date: date.value, staffId: staffId.value ?? undefined });
  } catch (e) {
    toast.error(e);
  } finally {
    loadingSlots.value = false;
  }
}
watch([date, step, staffId], loadSlots);

const calendarValue = computed(() => (date.value ? parseDate(date.value) : undefined));
const minDate = computed(() => parseDate(todayIso.value));
const maxDate = computed(() => parseDate(DateTime.fromISO(todayIso.value).plus({ days: 60 }).toISODate()!));
function onPickDate(v: DateValue | undefined) {
  if (v) date.value = v.toString();
}
const prettyDate = computed(() => (date.value ? DateTime.fromISO(date.value).toFormat('cccc, LLLL d') : ''));
const prettySlot = (iso: string, fmt = 'cccc, LLLL d · h:mm a') => DateTime.fromISO(iso).setZone(tz.value).toFormat(fmt);

const { handleSubmit, isSubmitting } = useForm({
  validationSchema: toTypedSchema(
    z.object({
      customerName: z.string({ required_error: 'Please enter your name' }).trim().min(2, 'Please enter your name'),
      customerPhone: z
        .string({ required_error: 'We need a phone number to reach you' })
        .trim()
        .min(7, 'Enter a valid phone number')
        .regex(/^[\d\s()+.-]+$/, 'Enter a valid phone number'),
      customerEmail: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
      note: z.string().trim().max(300).optional(),
    }),
  ),
});

const submit = handleSubmit(async (values) => {
  if (!service.value || !slot.value) return;
  try {
    const res = await api.post<{ booking: Confirmation }>(`/public/stores/${slug}/bookings`, {
      ...values,
      variantId: service.value.id,
      staffId: staffId.value,
      startsAt: slot.value,
    });
    confirmation.value = res.booking;
    step.value = 'done';
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      toast.error('Sorry, that time was just taken. Please pick another.');
      step.value = 'time';
      loadSlots();
    } else toast.error(e);
  }
});

function back() {
  if (step.value === 'details') step.value = 'time';
  else if (step.value === 'time') step.value = staffForService.value.length > 1 ? 'staff' : 'service';
  else if (step.value === 'staff') step.value = 'service';
}
function restart() {
  service.value = null;
  slot.value = null;
  confirmation.value = null;
  step.value = 'service';
}
const initials = (n: string) => n.split(' ').map((p) => p[0]).join('').slice(0, 2);
</script>

<template>
  <div class="min-h-screen bg-muted/40">
    <DemoBanner />
    <div class="mx-auto max-w-xl px-4 pt-6 pb-16">
      <div v-if="notFound" class="pt-16">
        <Empty class="border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon"><CalendarCheckIcon /></EmptyMedia>
            <EmptyTitle>Online booking unavailable</EmptyTitle>
            <EmptyDescription>This store does not take online bookings. Please call the store instead.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>

      <div v-else-if="!info" class="space-y-3"><Skeleton class="h-20" /><Skeleton class="h-64" /></div>

      <template v-else>
        <header class="mb-5 flex items-start justify-between gap-3">
          <div>
            <div class="mb-1 flex items-center gap-2 text-sm font-medium text-primary"><SparklesIcon class="size-4" /> Book online</div>
            <h1 class="text-2xl font-semibold tracking-tight" data-testid="public-store-name">{{ info.store.name }}</h1>
            <div class="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground">
              <span class="flex items-center gap-1"><MapPinIcon class="size-3.5" /> {{ info.store.address }}</span>
              <span v-if="info.store.phone" class="flex items-center gap-1"><PhoneIcon class="size-3.5" /> {{ info.store.phone }}</span>
            </div>
          </div>
          <ThemeToggle />
        </header>

        <ol v-if="step !== 'done'" class="mb-4 flex gap-1.5" aria-label="Progress">
          <li v-for="(s, i) in steps" :key="s.id" class="flex-1">
            <div class="h-1 rounded-full" :class="i <= stepIndex ? 'bg-primary' : 'bg-border'" />
            <div class="mt-1 text-xs" :class="i === stepIndex ? 'font-medium text-foreground' : 'text-muted-foreground'">{{ s.label }}</div>
          </li>
        </ol>

        <!-- 1. Service -->
        <Card v-if="step === 'service'">
          <CardHeader>
            <CardTitle>Choose a service</CardTitle>
            <CardDescription>Prices include everything except tax and tips.</CardDescription>
          </CardHeader>
          <CardContent class="space-y-5">
            <section v-for="c in categories" :key="c">
              <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{{ c }}</h3>
              <div class="divide-y rounded-lg border">
                <button
                  v-for="s in info.services.filter((x) => x.category === c)"
                  :key="s.id"
                  class="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  :data-testid="`service-${s.name}`"
                  @click="chooseService(s)"
                >
                  <div class="min-w-0 flex-1">
                    <div class="font-medium">{{ s.name }}</div>
                    <div class="flex items-center gap-1 text-sm text-muted-foreground"><ClockIcon class="size-3.5" /> {{ s.durationMin }} min</div>
                  </div>
                  <span class="font-semibold tabular-nums">{{ money(s.priceCents) }}</span>
                  <ChevronRightIcon class="size-4 text-muted-foreground" />
                </button>
              </div>
            </section>
          </CardContent>
        </Card>

        <!-- 2. Staff -->
        <Card v-else-if="step === 'staff'">
          <CardHeader>
            <CardTitle>Who would you like?</CardTitle>
            <CardDescription>{{ service?.name }} · {{ service?.durationMin }} min</CardDescription>
          </CardHeader>
          <CardContent class="grid gap-2">
            <Button variant="outline" class="h-auto justify-start gap-3 py-3" data-testid="staff-any" @click="chooseStaff(null)">
              <Avatar class="size-9"><AvatarFallback><UsersIcon class="size-4" /></AvatarFallback></Avatar>
              <div class="text-left">
                <div class="font-medium">Anyone available</div>
                <div class="text-xs font-normal text-muted-foreground">Most times to choose from</div>
              </div>
            </Button>
            <Button v-for="s in staffForService" :key="s.id" variant="outline" class="h-auto justify-start gap-3 py-3" :data-testid="`staff-${s.name}`" @click="chooseStaff(s.id)">
              <Avatar class="size-9"><AvatarFallback class="text-white" :style="{ background: s.color }">{{ initials(s.name) }}</AvatarFallback></Avatar>
              <span class="font-medium">{{ s.name }}</span>
            </Button>
            <Button variant="ghost" class="mt-1 justify-self-start" @click="back"><ArrowLeftIcon /> Back</Button>
          </CardContent>
        </Card>

        <!-- 3. Time -->
        <Card v-else-if="step === 'time'">
          <CardHeader>
            <CardTitle>Pick a time</CardTitle>
            <CardDescription>{{ service?.name }} with {{ staffName }} · times in store local time</CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <Calendar
              :model-value="calendarValue"
              :min-value="minDate"
              :max-value="maxDate"
              :placeholder="calendarValue"
              weekday-format="short"
              class="mx-auto rounded-lg border"
              @update:model-value="onPickDate($event as DateValue | undefined)"
            />
            <div>
              <h3 class="mb-2 text-sm font-medium">{{ prettyDate }}</h3>
              <div v-if="loadingSlots" class="grid grid-cols-3 gap-2 sm:grid-cols-4"><Skeleton v-for="n in 8" :key="n" class="h-10" /></div>
              <div v-else-if="slots.length" class="grid grid-cols-3 gap-2 sm:grid-cols-4" data-testid="public-slots">
                <Button v-for="s in slots" :key="s" :variant="s === slot ? 'default' : 'outline'" class="h-10 tabular-nums" @click="slot = s">{{ slotLabel(s, tz) }}</Button>
              </div>
              <p v-else class="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No times left on this day. Try another date.</p>
            </div>
            <div class="flex justify-between">
              <Button variant="ghost" @click="back"><ArrowLeftIcon /> Back</Button>
              <Button :disabled="!slot" @click="step = 'details'">Continue</Button>
            </div>
          </CardContent>
        </Card>

        <!-- 4. Details -->
        <Card v-else-if="step === 'details' && slot">
          <CardHeader>
            <CardTitle>Your details</CardTitle>
            <CardDescription>{{ service?.name }} · {{ prettySlot(slot) }} · {{ staffName }}</CardDescription>
          </CardHeader>
          <CardContent>
            <form class="space-y-4" @submit="submit">
              <FormField v-slot="{ componentField }" name="customerName">
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl><Input v-bind="componentField" autocomplete="name" /></FormControl>
                  <FormMessage />
                </FormItem>
              </FormField>
              <FormField v-slot="{ componentField }" name="customerPhone">
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl><Input v-bind="componentField" type="tel" autocomplete="tel" placeholder="(212) 555-0123" /></FormControl>
                  <FormMessage />
                </FormItem>
              </FormField>
              <FormField v-slot="{ componentField }" name="customerEmail">
                <FormItem>
                  <FormLabel>Email <span class="font-normal text-muted-foreground">(optional)</span></FormLabel>
                  <FormControl><Input v-bind="componentField" type="email" autocomplete="email" /></FormControl>
                  <FormMessage />
                </FormItem>
              </FormField>
              <FormField v-slot="{ componentField }" name="note">
                <FormItem>
                  <FormLabel>Anything we should know? <span class="font-normal text-muted-foreground">(optional)</span></FormLabel>
                  <FormControl><Textarea v-bind="componentField" rows="2" /></FormControl>
                  <FormMessage />
                </FormItem>
              </FormField>
              <div class="flex justify-between pt-1">
                <Button type="button" variant="ghost" @click="back"><ArrowLeftIcon /> Back</Button>
                <Button type="submit" :disabled="isSubmitting">Confirm booking</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <!-- 5. Done -->
        <Card v-else-if="step === 'done' && confirmation" class="text-center" data-testid="booking-confirmed">
          <CardHeader>
            <div class="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              <CalendarCheckIcon class="size-6" />
            </div>
            <CardTitle class="text-xl">You’re booked!</CardTitle>
            <CardDescription>Show this reference at the front desk.</CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="rounded-lg bg-muted py-3 font-mono text-2xl font-semibold tracking-widest" data-testid="booking-reference">{{ confirmation.reference }}</div>
            <dl class="mx-auto max-w-xs space-y-1 text-sm">
              <div class="flex justify-between gap-4"><dt class="text-muted-foreground">Service</dt><dd>{{ confirmation.serviceName }}</dd></div>
              <div class="flex justify-between gap-4"><dt class="text-muted-foreground">With</dt><dd>{{ confirmation.staffName }}</dd></div>
              <div class="flex justify-between gap-4"><dt class="text-muted-foreground">When</dt><dd>{{ prettySlot(confirmation.startsAt, 'ccc, LLL d · h:mm a') }}</dd></div>
              <div class="flex justify-between gap-4"><dt class="text-muted-foreground">Where</dt><dd>{{ confirmation.storeName }}</dd></div>
            </dl>
            <Button variant="outline" @click="restart">Book another</Button>
          </CardContent>
        </Card>
      </template>
    </div>
  </div>
</template>
