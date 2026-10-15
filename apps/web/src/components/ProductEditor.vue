<script setup lang="ts">
import { PlusIcon, Trash2Icon } from '@lucide/vue';
import { reactive, ref } from 'vue';
import Modal from '@/components/Modal.vue';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { api } from '@/lib/api';
import { money, parseMoney } from '@/lib/format';
import { toast } from '@/lib/notify';
import type { Product } from '@/lib/types';
import { useSession } from '@/stores/session';

const props = defineProps<{ product: Product | null }>();
const emit = defineEmits<{ close: []; saved: [] }>();
const session = useSession();
const busy = ref(false);

interface VariantForm {
  id?: string;
  name: string;
  sku: string;
  barcode: string;
  price: string;
  cost: string;
  reorderLevel: string;
  storePrice: string;
}

const p = props.product;
const form = reactive({
  name: p?.name ?? '',
  type: p?.type ?? ('product' as 'product' | 'service'),
  category: p?.category ?? 'General',
  durationMin: String(p?.durationMin ?? 30),
  variants: (p?.variants ?? []).map<VariantForm>((v) => ({
    id: v.id,
    name: v.name,
    sku: v.sku,
    barcode: v.barcode ?? '',
    price: (v.defaultPriceCents / 100).toFixed(2),
    cost: (v.costCents / 100).toFixed(2),
    reorderLevel: String(v.reorderLevel),
    storePrice: v.storePriceCents === null ? '' : (v.storePriceCents / 100).toFixed(2),
  })),
});
if (form.variants.length === 0) addVariant();

function addVariant() {
  form.variants.push({ name: form.variants.length ? '' : 'Default', sku: '', barcode: '', price: '', cost: '0', reorderLevel: '5', storePrice: '' });
}

async function save() {
  busy.value = true;
  try {
    const payload = {
      name: form.name,
      type: form.type,
      category: form.category,
      durationMin: form.type === 'service' ? Number(form.durationMin) : null,
      variants: form.variants.map((v) => ({
        id: v.id,
        name: v.name || 'Default',
        sku: v.sku,
        barcode: v.barcode || null,
        priceCents: parseMoney(v.price) ?? 0,
        costCents: parseMoney(v.cost) ?? 0,
        reorderLevel: Number(v.reorderLevel) || 0,
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
  <Modal :title="p ? `Edit ${p.name}` : 'New product or service'" description="Prices are per variant; a store can override the price." wide @close="emit('close')">
    <form id="product-form" class="space-y-5" @submit.prevent="save">
      <FieldGroup class="grid gap-4 sm:grid-cols-2">
        <Field class="sm:col-span-2">
          <FieldLabel for="p-name">Name</FieldLabel>
          <Input id="p-name" v-model="form.name" required />
        </Field>
        <Field>
          <FieldLabel for="p-type">Type</FieldLabel>
          <NativeSelect id="p-type" v-model="form.type" :disabled="!!p">
            <NativeSelectOption value="product">Product (stocked)</NativeSelectOption>
            <NativeSelectOption value="service">Service (bookable)</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel for="p-cat">Category</FieldLabel>
          <Input id="p-cat" v-model="form.category" required />
        </Field>
        <Field v-if="form.type === 'service'">
          <FieldLabel for="p-dur">Duration (minutes)</FieldLabel>
          <Input id="p-dur" v-model="form.durationMin" type="number" min="5" step="5" />
        </Field>
      </FieldGroup>

      <div>
        <div class="mb-2 flex items-center justify-between">
          <h3 class="text-sm font-semibold">Variants</h3>
          <Button type="button" variant="ghost" size="sm" @click="addVariant"><PlusIcon /> Add variant</Button>
        </div>
        <div class="space-y-3">
          <div v-for="(v, i) in form.variants" :key="i" class="grid grid-cols-2 gap-3 rounded-lg border p-3 sm:grid-cols-6">
            <Field class="sm:col-span-2"><FieldLabel>Variant</FieldLabel><Input v-model="v.name" placeholder="Default" /></Field>
            <Field><FieldLabel>SKU</FieldLabel><Input v-model="v.sku" required /></Field>
            <Field class="sm:col-span-2"><FieldLabel>Barcode</FieldLabel><Input v-model="v.barcode" inputmode="numeric" /></Field>
            <Field><FieldLabel>Reorder at</FieldLabel><Input v-model="v.reorderLevel" type="number" min="0" /></Field>
            <Field><FieldLabel>Price $</FieldLabel><Input v-model="v.price" inputmode="decimal" required /></Field>
            <Field><FieldLabel>Cost $</FieldLabel><Input v-model="v.cost" inputmode="decimal" /></Field>
            <Field v-if="p && v.id" class="col-span-2">
              <FieldLabel>Price at {{ session.currentStore?.code }} $</FieldLabel>
              <Input v-model="v.storePrice" inputmode="decimal" :placeholder="`Default ${money(parseMoney(v.price))}`" />
            </Field>
            <div class="col-span-2 flex items-end justify-end sm:col-span-2">
              <Button v-if="form.variants.length > 1" type="button" variant="ghost" size="sm" class="text-destructive" @click="form.variants.splice(i, 1)"><Trash2Icon /> Remove</Button>
            </div>
          </div>
        </div>
      </div>
    </form>
    <template #footer>
      <Button variant="outline" @click="emit('close')">Cancel</Button>
      <Button type="submit" form="product-form" :disabled="busy">Save</Button>
    </template>
  </Modal>
</template>
