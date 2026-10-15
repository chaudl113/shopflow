<script setup lang="ts">
defineProps<{ title: string; wide?: boolean }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" @mousedown.self="emit('close')">
      <div
        class="flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
        :class="wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'"
        role="dialog"
        :aria-label="title"
      >
        <div class="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h2 class="text-base font-semibold">{{ title }}</h2>
          <button class="btn-ghost -mr-2 px-2 py-1" aria-label="Close" @click="emit('close')">✕</button>
        </div>
        <div class="overflow-y-auto px-5 py-4"><slot /></div>
        <div v-if="$slots.footer" class="flex justify-end gap-2 border-t border-slate-200 px-5 py-3"><slot name="footer" /></div>
      </div>
    </div>
  </Teleport>
</template>
