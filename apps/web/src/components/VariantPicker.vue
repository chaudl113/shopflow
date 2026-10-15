<script setup lang="ts">
import { SearchIcon } from '@lucide/vue';
import { ref, watch } from 'vue';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
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
  if (!String(v).trim()) {
    results.value = [];
    return;
  }
  t = setTimeout(async () => {
    results.value = (await api.get<{ variants: VariantView[] }>('/products/variants', { storeId: props.storeId ?? session.storeId, q: String(v), type: props.type })).variants.slice(0, 8);
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
    <InputGroup>
      <InputGroupAddon><SearchIcon /></InputGroupAddon>
      <InputGroupInput v-model="q" :placeholder="placeholder ?? 'Search item to add…'" aria-label="Search item" @focus="open = true" @keydown.enter.prevent="results[0] && pick(results[0])" />
    </InputGroup>
    <ul v-if="open && results.length" class="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
      <li v-for="v in results" :key="v.id">
        <button type="button" class="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground" @click="pick(v)">
          <span>{{ v.label }} <span class="font-mono text-xs text-muted-foreground">{{ v.sku }}</span></span>
          <span class="text-xs text-muted-foreground">{{ v.onHand === null ? money(v.priceCents) : `${v.onHand} on hand` }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>
