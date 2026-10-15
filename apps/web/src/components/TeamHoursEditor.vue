<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Modal from '@/components/Modal.vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import type { TeamSchedule } from '@/lib/booking';
import { toast } from '@/lib/notify';
import type { VariantView } from '@/lib/types';

const props = defineProps<{ storeId: string; team: TeamSchedule[]; services: VariantView[] }>();
const emit = defineEmits<{ close: []; saved: [TeamSchedule[]] }>();

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

const who = ref(props.team[0]?.id ?? '');
const person = computed(() => props.team.find((t) => t.id === who.value));
const days = ref<{ on: boolean; start: string; end: string }[]>([]);
const skills = ref<string[]>([]);
const busy = ref(false);

// One range per day in this editor; the API also accepts split shifts.
watch(
  person,
  (p) => {
    days.value = WEEKDAYS.map((_, i) => {
      const h = p?.hours.find((x) => x.weekday === i + 1);
      return { on: !!h, start: toTime(h?.startMin ?? 540), end: toTime(h?.endMin ?? 1020) };
    });
    skills.value = [...(p?.productIds ?? [])];
  },
  { immediate: true },
);
const products = computed(() => [...new Map(props.services.map((s) => [s.productId, s])).values()]);
function toggleSkill(productId: string, on: boolean | 'indeterminate') {
  skills.value = on === true ? [...skills.value, productId] : skills.value.filter((id) => id !== productId);
}

async function save() {
  const hours = days.value.flatMap((d, i) => (d.on ? [{ weekday: i + 1, startMin: toMin(d.start), endMin: toMin(d.end) }] : []));
  if (hours.some((h) => h.endMin <= h.startMin)) return toast.error('End time must be after start time');
  busy.value = true;
  try {
    const res = await api.put<{ team: TeamSchedule[] }>(`/bookings/team/${who.value}`, { storeId: props.storeId, hours, productIds: skills.value });
    toast.success(`Saved ${person.value?.name}’s schedule`);
    emit('saved', res.team);
  } catch (e) {
    toast.error(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Modal title="Team hours" description="Weekly working hours at this store drive the slots offered on the booking page." wide @close="emit('close')">
    <p v-if="!team.length" class="text-sm text-muted-foreground">Mark a team member as bookable and assign them to this store first.</p>
    <template v-else>
      <Tabs v-model="who" class="mb-4">
        <TabsList>
          <TabsTrigger v-for="t in team" :key="t.id" :value="t.id">
            <span class="size-2 rounded-full" :style="{ background: t.color }" /> {{ t.name }}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div class="grid gap-6 md:grid-cols-[1fr_220px]">
        <FieldSet>
          <FieldLegend variant="label">Working hours</FieldLegend>
          <div class="space-y-1.5">
            <div v-for="(d, i) in days" :key="i" class="flex items-center gap-3">
              <Switch v-model="d.on" :aria-label="`Works on ${WEEKDAYS[i]}`" />
              <span class="w-24 text-sm" :class="d.on ? '' : 'text-muted-foreground'">{{ WEEKDAYS[i] }}</span>
              <template v-if="d.on">
                <Input v-model="d.start" type="time" step="900" class="h-8 w-32" :aria-label="`${WEEKDAYS[i]} start`" />
                <span class="text-muted-foreground">–</span>
                <Input v-model="d.end" type="time" step="900" class="h-8 w-32" :aria-label="`${WEEKDAYS[i]} end`" />
              </template>
              <span v-else class="text-sm text-muted-foreground">Off</span>
            </div>
          </div>
        </FieldSet>
        <FieldSet>
          <FieldLegend variant="label">Services</FieldLegend>
          <label v-for="p in products" :key="p.productId" class="flex items-center gap-2 text-sm">
            <Checkbox :model-value="skills.includes(p.productId)" @update:model-value="toggleSkill(p.productId, $event)" />
            {{ p.productName }}
          </label>
        </FieldSet>
      </div>
    </template>
    <template #footer>
      <Button variant="outline" @click="emit('close')">Cancel</Button>
      <Button :disabled="busy || !person" @click="save">Save</Button>
    </template>
  </Modal>
</template>
