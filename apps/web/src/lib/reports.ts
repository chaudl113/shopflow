export interface SalesReport {
  totals: {
    netSalesCents: number;
    refundsCents: number;
    taxCents: number;
    costCents: number;
    servicesCents: number;
    retailCents: number;
    salesCount: number;
    itemsSold: number;
    grossMarginCents: number;
    avgTicketCents: number;
  };
  byDay: { day: string; netSalesCents: number; servicesCents: number; retailCents: number; salesCount: number }[];
  byStore: { storeId: string; name: string; code: string; netSalesCents: number; salesCount: number }[];
  byStaff: { userId: string; name: string; color: string; role: string; servicesCents: number; retailCents: number; netSalesCents: number; services: number }[];
  topSellers: { variantId: string; name: string; isService: boolean; qty: number; netSalesCents: number }[];
  payments: { method: string; amountCents: number }[];
}

export interface LowStockItem {
  storeId: string;
  storeName: string;
  variantId: string;
  label: string;
  sku: string;
  onHand: number;
  reorderLevel: number;
  inboundQty: number;
}

/** Percentage change, or null when there is nothing to compare against. */
export const change = (now: number, before: number) => (before === 0 ? null : (now - before) / Math.abs(before));
export const percent = (x: number) => `${(x * 100).toFixed(1)}%`;
