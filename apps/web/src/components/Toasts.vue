<script setup lang="ts">
import { useToast } from '@/stores/toast';
const toast = useToast();
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-3">
    <div
      v-for="t in toast.items"
      :key="t.id"
      role="status"
      class="pointer-events-auto max-w-md rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg"
      :class="{ 'bg-emerald-600 text-white': t.kind === 'success', 'bg-rose-600 text-white': t.kind === 'error', 'bg-slate-800 text-white': t.kind === 'info' }"
    >
      {{ t.text }}
    </div>
  </div>
</template>
