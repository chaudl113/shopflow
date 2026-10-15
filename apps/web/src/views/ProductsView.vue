<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import ProductEditor from '@/components/ProductEditor.vue';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import type { Product } from '@/lib/types';
import { useSession } from '@/stores/session';
import { useToast } from '@/stores/toast';

const session = useSession();
const toast = useToast();
const products = ref<Product[]>([]);
const q = ref('');
const type = ref<'' | 'product' | 'service'>('');
const editing = ref<Product | null | undefined>(undefined);
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    products.value = (await api.get<{ products: Product[] }>('/products', { storeId: session.storeId, q: q.value, type: type.value })).products;
  } catch (e) {
    toast.error(e);
  } finally {
    loading.value = false;
  }
}
let t: ReturnType<typeof setTimeout>;
watch([q, type], () => {
  clearTimeout(t);
  t = setTimeout(load, 200);
});
onMounted(load);
</script>

<template>
  <PageHeader title="Products & services" :subtitle="`Prices and stock shown for ${session.currentStore?.name}`">
    <button v-if="session.can('owner', 'manager')" class="btn-primary" @click="editing = null">+ New</button>
  </PageHeader>

  <div class="mb-4 flex flex-wrap gap-2">
    <input v-model="q" class="input max-w-xs" placeholder="Search name, SKU, category…" aria-label="Search products" />
    <select v-model="type" class="input w-auto" aria-label="Type">
      <option value="">All types</option>
      <option value="product">Products</option>
      <option value="service">Services</option>
    </select>
  </div>

  <div class="card overflow-x-auto">
    <table class="table">
      <thead>
        <tr>
          <th>Item</th>
          <th>Variant</th>
          <th>SKU / barcode</th>
          <th class="text-right">Price</th>
          <th class="text-right">On hand</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <template v-for="p in products" :key="p.id">
          <tr v-for="(v, i) in p.variants" :key="v.id">
            <td v-if="i === 0" :rowspan="p.variants.length" class="align-top">
              <div class="font-medium">{{ p.name }}</div>
              <div class="text-xs text-slate-500">
                {{ p.category }} ·
                <span :class="p.type === 'service' ? 'text-violet-600' : 'text-slate-500'">{{ p.type === 'service' ? `Service · ${p.durationMin} min` : 'Product' }}</span>
              </div>
            </td>
            <td>{{ v.name }}</td>
            <td class="font-mono text-xs text-slate-600">{{ v.sku }}<span v-if="v.barcode" class="block text-slate-400">{{ v.barcode }}</span></td>
            <td class="text-right tabular-nums">
              {{ money(v.priceCents) }}
              <span v-if="v.storePriceCents !== null" class="badge ml-1 bg-sky-50 text-sky-700" title="Store price override">store</span>
            </td>
            <td class="text-right tabular-nums">
              <span v-if="v.onHand === null" class="text-slate-400">—</span>
              <span v-else :class="v.onHand <= v.reorderLevel ? 'font-semibold text-rose-600' : ''">{{ v.onHand }}</span>
            </td>
            <td v-if="i === 0" :rowspan="p.variants.length" class="text-right align-top">
              <button v-if="session.can('owner', 'manager')" class="btn-ghost px-2 py-1 text-indigo-600" @click="editing = p">Edit</button>
            </td>
          </tr>
        </template>
        <tr v-if="!loading && products.length === 0">
          <td colspan="6" class="py-10 text-center text-slate-500">No products match.</td>
        </tr>
      </tbody>
    </table>
  </div>

  <ProductEditor v-if="editing !== undefined" :product="editing" @close="editing = undefined" @saved="editing = undefined; load()" />
</template>
