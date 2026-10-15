export interface VariantView {
  id: string;
  productId: string;
  productName: string;
  name: string;
  label: string;
  sku: string;
  barcode: string | null;
  type: 'product' | 'service';
  category: string;
  durationMin: number | null;
  priceCents: number;
  defaultPriceCents: number;
  storePriceCents: number | null;
  costCents: number;
  reorderLevel: number;
  active: boolean;
  onHand: number | null;
}

export interface Product {
  id: string;
  name: string;
  type: 'product' | 'service';
  category: string;
  description: string;
  durationMin: number | null;
  active: boolean;
  variants: VariantView[];
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'manager' | 'cashier' | 'staff';
  bookable: boolean;
  color: string;
  active: boolean;
  storeIds: string[];
}

export interface SaleLine {
  id: string;
  variantId: string;
  name: string;
  sku: string;
  qty: number;
  isService: boolean;
  staffId: string | null;
  staffName: string | null;
  unitPriceCents: number;
  lineDiscountCents: number;
  orderDiscountCents: number;
  netCents: number;
  taxCents: number;
  totalCents: number;
  returnedQty: number;
}

export interface SaleDetail {
  id: string;
  number: string;
  createdAt: string;
  storeId: string;
  cashierName: string;
  customerName: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  changeCents: number;
  taxRateBps: number;
  bookingId?: string | null;
  store: { id: string; name: string; code: string; address: string; phone: string; timezone: string };
  lines: SaleLine[];
  payments: { id: string; method: 'cash' | 'card' | 'other'; amountCents: number; tenderedCents: number; changeCents: number; returnId: string | null; createdAt: string }[];
  returns: { id: string; number: string; totalCents: number; reason: string; createdAt: string }[];
}
