<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '@/lib/api';
import { dateTime, money } from '@/lib/format';
import type { SaleDetail } from '@/lib/types';

const route = useRoute();
const sale = ref<SaleDetail | null>(null);
const error = ref('');

onMounted(async () => {
  try {
    sale.value = (await api.get<{ sale: SaleDetail }>(`/sales/${route.params.id}`)).sale;
    if (route.query.print) {
      await nextTick();
      setTimeout(() => window.print(), 250);
    }
  } catch (e) {
    error.value = (e as Error).message;
  }
});

const salePayments = computed(() => sale.value?.payments.filter((p) => !p.returnId) ?? []);
const print = () => window.print();
const method = (m: string) => ({ cash: 'Cash', card: 'Card', other: 'Other' })[m] ?? m;
</script>

<template>
  <div class="receipt-page min-h-screen bg-slate-200 py-6 print:bg-white print:py-0">
    <div v-if="error" class="text-center text-rose-600">{{ error }}</div>
    <article v-else-if="sale" class="receipt mx-auto bg-white px-3 py-4 font-mono text-[11px] leading-snug text-black shadow print:shadow-none" data-testid="receipt">
      <header class="text-center">
        <div class="text-sm font-bold uppercase">{{ sale.store.name }}</div>
        <div>{{ sale.store.address }}</div>
        <div v-if="sale.store.phone">{{ sale.store.phone }}</div>
        <div class="mt-1">*** DEMO DATA – NOT A TAX INVOICE ***</div>
      </header>
      <hr class="my-2 border-dashed border-black" />
      <div class="flex justify-between"><span>Receipt</span><span>{{ sale.number }}</span></div>
      <div class="flex justify-between"><span>Date</span><span>{{ dateTime(sale.createdAt, sale.store.timezone) }}</span></div>
      <div class="flex justify-between"><span>Cashier</span><span>{{ sale.cashierName }}</span></div>
      <div v-if="sale.customerName" class="flex justify-between"><span>Customer</span><span>{{ sale.customerName }}</span></div>
      <hr class="my-2 border-dashed border-black" />
      <div v-for="l in sale.lines" :key="l.id" class="mb-1">
        <div class="flex justify-between gap-2">
          <span class="min-w-0 break-words">{{ l.name }}</span>
          <span class="shrink-0">{{ money(l.unitPriceCents * l.qty) }}</span>
        </div>
        <div class="pl-2 text-[10px]">
          {{ l.qty }} x {{ money(l.unitPriceCents) }}<span v-if="l.staffName"> · {{ l.staffName }}</span>
        </div>
        <div v-if="l.lineDiscountCents" class="flex justify-between pl-2 text-[10px]"><span>Discount</span><span>-{{ money(l.lineDiscountCents) }}</span></div>
      </div>
      <hr class="my-2 border-dashed border-black" />
      <div class="flex justify-between"><span>Subtotal</span><span>{{ money(sale.subtotalCents) }}</span></div>
      <div v-if="sale.discountCents" class="flex justify-between"><span>Discounts</span><span>-{{ money(sale.discountCents) }}</span></div>
      <div class="flex justify-between"><span>Tax {{ (sale.taxRateBps / 100).toFixed(3).replace(/0+$/, '') }}%</span><span>{{ money(sale.taxCents) }}</span></div>
      <div class="mt-1 flex justify-between text-sm font-bold"><span>TOTAL</span><span>{{ money(sale.totalCents) }}</span></div>
      <hr class="my-2 border-dashed border-black" />
      <div v-for="p in salePayments" :key="p.id" class="flex justify-between">
        <span>{{ method(p.method) }}</span><span>{{ money(p.tenderedCents) }}</span>
      </div>
      <div v-if="sale.changeCents" class="flex justify-between font-bold"><span>Change</span><span>{{ money(sale.changeCents) }}</span></div>
      <template v-if="sale.returns.length">
        <hr class="my-2 border-dashed border-black" />
        <div v-for="r in sale.returns" :key="r.id" class="flex justify-between"><span>Refund {{ r.number }}</span><span>-{{ money(r.totalCents) }}</span></div>
      </template>
      <hr class="my-2 border-dashed border-black" />
      <footer class="text-center">
        <div>Thank you for visiting!</div>
        <div>Returns accepted within 30 days with receipt.</div>
      </footer>
    </article>
    <div class="mt-4 text-center print:hidden">
      <button class="btn-primary" @click="print">Print</button>
    </div>
  </div>
</template>

<style>
/* 80 mm thermal roll: ~72 mm printable width, page height grows with content. */
.receipt {
  width: 72mm;
}
@media print {
  @page {
    size: 80mm auto;
    margin: 4mm;
  }
  body {
    background: white;
  }
}
</style>
