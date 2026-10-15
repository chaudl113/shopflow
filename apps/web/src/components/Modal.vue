<script setup lang="ts">
// App-level dialog = shadcn Dialog composed with header/footer slots. Parents mount it with v-if.
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

defineProps<{ title: string; description?: string; wide?: boolean }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <Dialog :open="true" @update:open="(v: boolean) => !v && emit('close')">
    <DialogContent :class="cn('flex max-h-[92vh] flex-col gap-4', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription v-if="description">{{ description }}</DialogDescription>
      </DialogHeader>
      <div class="-mx-6 overflow-y-auto px-6"><slot /></div>
      <DialogFooter v-if="$slots.footer"><slot name="footer" /></DialogFooter>
    </DialogContent>
  </Dialog>
</template>
