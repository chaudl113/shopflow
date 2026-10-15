<script setup lang="ts">
import { DateTime } from 'luxon';
import { computed, ref, watch } from 'vue';
import DatePicker from '@/components/DatePicker.vue';
import Modal from '@/components/Modal.vue';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { slotLabel, type Availability, type Booking, type TeamSchedule } from '@/lib/booking';
import { money } from '@/lib/format';
import { toast } from '@/lib/notify';
import type { VariantView } from '@/lib/types';

const props = defineProps<{
  storeId: string;
  timezone: string;
  services: VariantView[];
  team: TeamSchedule[];
  booking?: Booking | null;
  initialDate: string;
}>();
const emit = defineEmits<{ close: []; saved: [Booking] }>();

const b = props.booking;
const variantId = ref(b?.variantId ?? props.services[0]?.id ?? '');
const service = computed(() => props.services.find((s) => s.id === variantId.value));
const eligible = computed(() => props.team.filter((t) => service.value && t.productIds.includes(service.value.productId)));
const staffId = ref(b?.staffId ?? '');
const date = ref(b ? DateTime.fromISO(b.startsAt).setZone(props.timezone).toISODate()! : props.initialDate);
const startsAt = ref<string | null>(b?.startsAt ? DateTime.fromISO(b.startsAt).toUTC().toISO() : null);
const customTime = ref('');
const customerName = ref(b?.customerName ?? '');
const customerPhone = ref(b?.customerPhone ?? '');
const note = ref(b?.note ?? '');
const busy = ref(false);
const avail = ref<Availability | null>(null);
const loading = ref(false);
const today = DateTime.now().setZone(props.timezone).toISODate()!;

watch(
  eligible,
  (list) => {
    if (!list.some((s) => s.id === staffId.value)) staffId.value = list[0]?.id ?? '';
  },
  { immediate: true },
);

let seq = 0;
watch(
  [variantId, staffId, date],
  async () => {
    avail.value = null;
    if (!variantId.value || !staffId.value || !date.value) return;
    const mine = ++seq;
    loading.value = true;
    try {
      const res = await api.get<Availability>('/bookings/availability', {
        storeId: props.storeId,
        variantId: variantId.value,
        staffId: staffId.value,
        date: date.value,
        excludeBookingId: b?.id,
      });
      if (mine === seq) avail.value = res;
    } catch (e) {
      toast.error(e);
    } finally {
      if (mine === seq) loading.value = false;
    }
  },
  { immediate: true },
);
const slots = computed(() => avail.value?.staff[0]?.slots ?? []);

function pickSlot(iso: string) {
  startsAt.value = iso;
  customTime.value = '';
}
function applyCustomTime() {
  if (!customTime.value) return;
  const [h, m] = customTime.value.split(':').map(Number);
  startsAt.value = DateTime.fromISO(date.value, { zone: props.timezone }).set({ hour: h, minute: m }).toUTC().toISO();
}
watch(customTime, applyCustomTime);
watch(date, () => {
  if (customTime.value) return applyCustomTime();
  // Keep the original time when coming back to the booking's own day; otherwise make them pick again.
  startsAt.value = b && DateTime.fromISO(b.startsAt).setZone(props.timezone).toISODate() === date.value ? DateTime.fromISO(b.startsAt).toUTC().toISO() : null;
});
const chosenLabel = computed(() => (startsAt.value ? DateTime.fromISO(startsAt.value).setZone(props.timezone).toFormat('ccc, LLL d · h:mm a') : null));

async function save() {
  if (!startsAt.value) return toast.error('Pick a time');
  if (!customerName.value.trim()) return toast.error('Enter the customer’s name');
  busy.value = true;
  const body = {
    variantId: variantId.value,
    staffId: staffId.value,
    startsAt: startsAt.value,
    customerName: customerName.value.trim(),
    customerPhone: customerPhone.value.trim(),
    note: note.value.trim(),
  };
  try {
    const res = b
      ? await api.patch<{ booking: Booking }>(`/bookings/${b.id}`, body)
      : await api.post<{ booking: Booking }>('/bookings', { ...body, storeId: props.storeId });
    toast.success(b ? 'Booking moved' : `Booked ${res.booking.reference}`);
    emit('saved', res.booking);
  } catch (e) {
    toast.error(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Modal :title="b ? `Reschedule ${b.reference}` : 'New booking'" wide @close="emit('close')">
    <div class="grid gap-5 md:grid-cols-2">
      <div class="space-y-4">
        <Field>
          <FieldLabel for="bk-service">Service</FieldLabel>
          <NativeSelect id="bk-service" v-model="variantId">
            <NativeSelectOption v-for="s in services" :key="s.id" :value="s.id">{{ s.label }} · {{ s.durationMin }} min · {{ money(s.priceCents) }}</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel for="bk-staff">With</FieldLabel>
          <NativeSelect id="bk-staff" v-model="staffId" :disabled="!eligible.length">
            <NativeSelectOption v-for="s in eligible" :key="s.id" :value="s.id">{{ s.name }}</NativeSelectOption>
          </NativeSelect>
          <FieldDescription v-if="!eligible.length">Nobody here offers this service yet.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel for="bk-date">Date</FieldLabel>
          <DatePicker id="bk-date" v-model="date" :min="today" class="w-full" />
        </Field>
        <Field>
          <FieldLabel>Time</FieldLabel>
          <div v-if="loading" class="grid grid-cols-4 gap-1.5"><Skeleton v-for="n in 8" :key="n" class="h-8" /></div>
          <div v-else-if="slots.length" class="grid max-h-44 grid-cols-4 gap-1.5 overflow-y-auto pr-1" data-testid="desk-slots">
            <Button v-for="s in slots" :key="s" size="sm" :variant="s === startsAt && !customTime ? 'default' : 'outline'" class="tabular-nums" @click="pickSlot(s)">
              {{ slotLabel(s, timezone) }}
            </Button>
          </div>
          <p v-else class="text-sm text-muted-foreground">No free slots in working hours on this day.</p>
          <div class="mt-1 flex items-center gap-2">
            <span class="text-xs text-muted-foreground">or any time (outside hours is allowed at the desk):</span>
            <Input v-model="customTime" type="time" step="300" class="h-8 w-32" aria-label="Custom start time" />
          </div>
        </Field>
      </div>
      <div class="space-y-4">
        <Field>
          <FieldLabel for="bk-name">Customer name</FieldLabel>
          <Input id="bk-name" v-model="customerName" autocomplete="off" />
        </Field>
        <Field>
          <FieldLabel for="bk-phone">Phone</FieldLabel>
          <Input id="bk-phone" v-model="customerPhone" type="tel" autocomplete="off" />
        </Field>
        <Field>
          <FieldLabel for="bk-note">Note</FieldLabel>
          <Textarea id="bk-note" v-model="note" rows="3" placeholder="Allergies, preferences…" />
        </Field>
        <div v-if="chosenLabel" class="rounded-lg bg-muted p-3 text-sm">
          <div class="text-muted-foreground">Selected</div>
          <div class="font-medium">{{ chosenLabel }}</div>
          <div class="text-muted-foreground">{{ service?.label }} · {{ service?.durationMin }} min</div>
        </div>
      </div>
    </div>
    <template #footer>
      <Button variant="outline" @click="emit('close')">Cancel</Button>
      <Button :disabled="busy || !startsAt || !staffId" @click="save">{{ b ? 'Save changes' : 'Book' }}</Button>
    </template>
  </Modal>
</template>
