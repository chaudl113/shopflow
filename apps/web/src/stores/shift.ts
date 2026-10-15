import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '@/lib/api';

export interface ShiftSummary {
  shift: {
    id: string;
    storeId: string;
    userId: string;
    userName: string;
    status: 'open' | 'closed';
    openingFloatCents: number;
    openedAt: string;
    closedAt: string | null;
    expectedCashCents: number | null;
    countedCashCents: number | null;
    differenceCents: number | null;
    closingNote: string;
  };
  salesCount: number;
  returnsCount: number;
  salesTotalCents: number;
  refundsTotalCents: number;
  byMethod: Record<'cash' | 'card' | 'other', { inCents: number; outCents: number }>;
  payInCents: number;
  payOutCents: number;
  expectedCashCents: number;
  cashMovements: { id: string; kind: 'pay_in' | 'pay_out'; amountCents: number; reason: string; createdAt: string }[];
}

export const useShift = defineStore('shift', () => {
  const current = ref<ShiftSummary | null>(null);
  const loaded = ref(false);

  async function load(storeId: string) {
    current.value = (await api.get<{ summary: ShiftSummary | null }>('/shifts/current', { storeId })).summary;
    loaded.value = true;
  }
  async function open(storeId: string, openingFloatCents: number) {
    current.value = (await api.post<{ summary: ShiftSummary }>('/shifts/open', { storeId, openingFloatCents })).summary;
  }
  return { current, loaded, load, open };
});
