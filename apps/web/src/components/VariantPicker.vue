<script setup lang="ts">
import { ref, watch } from 'vue';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import type { VariantView } from '@/lib/types';
import { useSession } from '@/stores/session';

const props = defineProps<{ type?: 'product' | 'service'; placeholder?: string; storeId?: string }>();
const emit = defineEmits<{ pick: [VariantView] }>();
const session = useSession();
const q = ref('');
const results = ref<VariantView[]>([]);
const open = ref(false);

let t: ReturnType<typeof setTimeout>;
watch(q, (v) => {
  clearTimeout(t);
  if (!v.trim()) {
    results.value = [];
    return;
  }
  t = setTimeout(async () => {
    results.value = (await api.get<{ variants: VariantView[] }>('/products/variants', { storeId: props.storeId ?? session.storeId, q: v, type: props.type })).variants.slice(0, 8);
    open.value = true;
  }, 150);
});

function pick(v: VariantView) {
  emit('pick', v);
  q.value = '';
  results.value = [];
  open.value = false;
}
</script>

<template>
  <div class="relative">
    <input v-model="q" class="input" :placeholder="placeholder ?? 'Search item to add…'" aria-label="Search item" @focus="open = true" @keydown.enter.prevent="results[0] && pick(results[0])" />
    <ul v-if="open && results.length" class="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
      <li v-for="v in results" :key="v.id">
        <button type="button" class="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-indigo-50" @click="pick(v)">
          <span>{{ v.label }} <span class="font-mono text-xs text-slate-400">{{ v.sku }}</span></span>
          <span class="text-xs text-slate-500">{{ v.onHand === null ? money(v.priceCents) : `${v.onHand} on hand` }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>
