<script setup lang="ts">
import { reactive, ref } from 'vue';
import Modal from '@/components/Modal.vue';
import { api } from '@/lib/api';
import { money, parseMoney } from '@/lib/format';
import type { Product } from '@/lib/types';
import { useSession } from '@/stores/session';
import { useToast } from '@/stores/toast';

const props = defineProps<{ product: Product | null }>();
const emit = defineEmits<{ close: []; saved: [] }>();
const session = useSession();
const toast = useToast();
const busy = ref(false);

interface VariantForm {
  id?: string;
  name: string;
  sku: string;
  barcode: string;
  price: string;
  cost: string;
  reorderLevel: number;
  storePrice: string;
}

const p = props.product;
const form = reactive({
  name: p?.name ?? '',
  type: p?.type ?? ('product' as 'product' | 'service'),
  category: p?.category ?? 'General',
  description: p?.description ?? '',
  durationMin: p?.durationMin ?? 30,
  variants: (p?.variants ?? []).map<VariantForm>((v) => ({
    id: v.id,
    name: v.name,
    sku: v.sku,
    barcode: v.barcode ?? '',
    price: (v.defaultPriceCents / 100).toFixed(2),
    cost: (v.costCents / 100).toFixed(2),
    reorderLevel: v.reorderLevel,
    storePrice: v.storePriceCents === null ? '' : (v.storePriceCents / 100).toFixed(2),
  })),
});
if (form.variants.length === 0) addVariant();

function addVariant() {
  form.variants.push({ name: form.variants.length ? '' : 'Default', sku: '', barcode: '', price: '', cost: '0', reorderLevel: 5, storePrice: '' });
}

async function save() {
  busy.value = true;
  try {
    const payload = {
      name: form.name,
      type: form.type,
      category: form.category,
      description: form.description,
      durationMin: form.type === 'service' ? Number(form.durationMin) : null,
      variants: form.variants.map((v) => ({
        id: v.id,
        name: v.name || 'Default',
        sku: v.sku,
        barcode: v.barcode || null,
        priceCents: parseMoney(v.price) ?? 0,
        costCents: parseMoney(v.cost) ?? 0,
        reorderLevel: Number(v.reorderLevel),
      })),
    };
    let id = p?.id;
    if (id) await api.put(`/products/${id}`, payload);
    else id = (await api.post<{ id: string }>('/products', payload)).id;

    // Store price overrides apply to the store selected in the header.
    if (session.storeId && p) {
      for (const v of form.variants.filter((x) => x.id)) {
        const before = p.variants.find((x) => x.id === v.id)?.storePriceCents ?? null;
        const after = v.storePrice === '' ? null : parseMoney(v.storePrice);
        if (before !== after) await api.put(`/stores/${session.storeId}/prices/${v.id}`, { priceCents: after });
      }
    }
    toast.success('Product saved');
    emit('saved');
  } catch (e) {
    toast.error(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Modal :title="p ? `Edit ${p.name}` : 'New product or service'" wide @close="emit('close')">
    <form id="product-form" class="space-y-4" @submit.prevent="save">
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="sm:col-span-2">
          <label class="label" for="p-name">Name</label>
          <input id="p-name" v-model="form.name" class="input" required />
        </div>
        <div>
          <label class="label" for="p-type">Type</label>
          <select id="p-type" v-model="form.type" class="input" :disabled="!!p">
            <option value="product">Product (stocked)</option>
            <option value="service">Service (bookable)</option>
          </select>
        </div>
        <div>
          <label class="label" for="p-cat">Category</label>
          <input id="p-cat" v-model="form.category" class="input" required />
        </div>
        <div v-if="form.type === 'service'">
          <label class="label" for="p-dur">Duration (minutes)</label>
          <input id="p-dur" v-model.number="form.durationMin" class="input" type="number" min="5" step="5" />
        </div>
      </div>

      <div>
        <div class="mb-2 flex items-center justify-between">
          <h3 class="text-sm font-semibold">Variants</h3>
          <button type="button" class="btn-ghost text-indigo-600" @click="addVariant">+ Add variant</button>
        </div>
        <div class="space-y-3">
          <div v-for="(v, i) in form.variants" :key="i" class="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-6">
            <div class="sm:col-span-2"><label class="label">Variant</label><input v-model="v.name" class="input" placeholder="Default" /></div>
            <div><label class="label">SKU</label><input v-model="v.sku" class="input" required /></div>
            <div class="sm:col-span-2"><label class="label">Barcode</label><input v-model="v.barcode" class="input" inputmode="numeric" /></div>
            <div><label class="label">Reorder at</label><input v-model.number="v.reorderLevel" class="input" type="number" min="0" /></div>
            <div><label class="label">Price $</label><input v-model="v.price" class="input" inputmode="decimal" required /></div>
            <div><label class="label">Cost $</label><input v-model="v.cost" class="input" inputmode="decimal" /></div>
            <div v-if="p && v.id" class="col-span-2">
              <label class="label">Price at {{ session.currentStore?.code }} $</label>
              <input v-model="v.storePrice" class="input" inputmode="decimal" :placeholder="`Default ${money(parseMoney(v.price))}`" />
            </div>
            <div class="col-span-2 flex items-end justify-end sm:col-span-2">
              <button v-if="form.variants.length > 1" type="button" class="btn-ghost text-rose-600" @click="form.variants.splice(i, 1)">Remove</button>
            </div>
          </div>
        </div>
      </div>
    </form>
    <template #footer>
      <button class="btn-secondary" @click="emit('close')">Cancel</button>
      <button class="btn-primary" form="product-form" :disabled="busy">Save</button>
    </template>
  </Modal>
</template>
