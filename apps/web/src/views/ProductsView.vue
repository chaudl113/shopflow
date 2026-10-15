<script setup lang="ts">
import { PackageSearchIcon, PencilIcon, PlusIcon, SearchIcon } from '@lucide/vue';
import { onMounted, ref, watch } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import ProductEditor from '@/components/ProductEditor.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { toast } from '@/lib/notify';
import type { Product } from '@/lib/types';
import { useSession } from '@/stores/session';

const session = useSession();
const products = ref<Product[]>([]);
const q = ref('');
const type = ref<'all' | 'product' | 'service'>('all');
const editing = ref<Product | null | undefined>(undefined);
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    products.value = (await api.get<{ products: Product[] }>('/products', { storeId: session.storeId, q: q.value, type: type.value === 'all' ? undefined : type.value })).products;
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
    <Button v-if="session.can('owner', 'manager')" @click="editing = null"><PlusIcon /> New</Button>
  </PageHeader>

  <div class="mb-4 flex flex-wrap items-center gap-3">
    <InputGroup class="max-w-xs">
      <InputGroupAddon><SearchIcon /></InputGroupAddon>
      <InputGroupInput v-model="q" placeholder="Search name, SKU, category…" aria-label="Search products" />
    </InputGroup>
    <Tabs v-model="type">
      <TabsList>
        <TabsTrigger value="all">All</TabsTrigger>
        <TabsTrigger value="product">Products</TabsTrigger>
        <TabsTrigger value="service">Services</TabsTrigger>
      </TabsList>
    </Tabs>
  </div>

  <Card class="py-0">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Item</TableHead>
          <TableHead>Variant</TableHead>
          <TableHead>SKU / barcode</TableHead>
          <TableHead class="text-right">Price</TableHead>
          <TableHead class="text-right">On hand</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        <template v-for="p in products" :key="p.id">
          <TableRow v-for="(v, i) in p.variants" :key="v.id">
            <TableCell v-if="i === 0" :rowspan="p.variants.length" class="align-top">
              <div class="font-medium">{{ p.name }}</div>
              <div class="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                {{ p.category }}
                <Badge v-if="p.type === 'service'" variant="secondary">Service · {{ p.durationMin }} min</Badge>
              </div>
            </TableCell>
            <TableCell>{{ v.name }}</TableCell>
            <TableCell class="font-mono text-xs">
              {{ v.sku }}<span v-if="v.barcode" class="block text-muted-foreground">{{ v.barcode }}</span>
            </TableCell>
            <TableCell class="text-right tabular-nums">
              {{ money(v.priceCents) }}
              <Badge v-if="v.storePriceCents !== null" variant="outline" class="ml-1" title="Store price override">store</Badge>
            </TableCell>
            <TableCell class="text-right tabular-nums">
              <span v-if="v.onHand === null" class="text-muted-foreground">—</span>
              <span v-else :class="v.onHand <= v.reorderLevel ? 'font-semibold text-destructive' : ''">{{ v.onHand }}</span>
            </TableCell>
            <TableCell v-if="i === 0" :rowspan="p.variants.length" class="text-right align-top">
              <Button v-if="session.can('owner', 'manager')" variant="ghost" size="sm" @click="editing = p"><PencilIcon /> Edit</Button>
            </TableCell>
          </TableRow>
        </template>
      </TableBody>
    </Table>
    <Empty v-if="!loading && products.length === 0">
      <EmptyHeader>
        <EmptyMedia variant="icon"><PackageSearchIcon /></EmptyMedia>
        <EmptyTitle>No products match</EmptyTitle>
        <EmptyDescription>Try a different search or type.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  </Card>

  <ProductEditor v-if="editing !== undefined" :product="editing" @close="editing = undefined" @saved="editing = undefined; load()" />
</template>
