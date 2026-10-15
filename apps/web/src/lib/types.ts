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
