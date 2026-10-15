<script setup lang="ts">
import { parseDate, type DateValue } from '@internationalized/date';
import { CalendarIcon } from '@lucide/vue';
import { DateTime } from 'luxon';
import { computed, ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/** shadcn date picker (Popover + Calendar) bound to a plain "YYYY-MM-DD" string. */
const props = defineProps<{ min?: string; id?: string; class?: string; format?: string }>();
const model = defineModel<string>({ required: true });
const open = ref(false);

const value = computed(() => (model.value ? parseDate(model.value) : undefined));
const minValue = computed(() => (props.min ? parseDate(props.min) : undefined));
const label = computed(() => (model.value ? DateTime.fromISO(model.value).toFormat(props.format ?? 'ccc, LLL d, yyyy') : 'Pick a date'));

function pick(v: DateValue | undefined) {
  if (!v) return;
  model.value = v.toString();
  open.value = false;
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button :id="id" variant="outline" :class="cn('justify-start font-normal', !model && 'text-muted-foreground', props.class)">
        <CalendarIcon /> {{ label }}
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-auto p-0" align="start">
      <Calendar :model-value="value" :min-value="minValue" :placeholder="value" weekday-format="short" initial-focus @update:model-value="pick($event as DateValue | undefined)" />
    </PopoverContent>
  </Popover>
</template>
