import { Package, Receipt, ShoppingCart, Tag, Truck, Wallet } from '@lucide/vue';
import type { Component } from 'vue';
import type { Role } from '@/stores/session';

export interface NavItem {
  to: string;
  label: string;
  icon: Component;
  roles: Role[];
  group: 'Sell' | 'Stock' | 'Book' | 'Insights';
}

const all: Role[] = ['owner', 'manager', 'cashier', 'staff'];
const sellers: Role[] = ['owner', 'manager', 'cashier'];

export const navItems: NavItem[] = [
  { to: '/pos', label: 'Point of sale', icon: ShoppingCart, roles: sellers, group: 'Sell' },
  { to: '/sales', label: 'Sales & returns', icon: Receipt, roles: sellers, group: 'Sell' },
  { to: '/shifts', label: 'Shifts', icon: Wallet, roles: sellers, group: 'Sell' },
  { to: '/products', label: 'Products', icon: Tag, roles: all, group: 'Stock' },
  { to: '/inventory', label: 'Inventory', icon: Package, roles: ['owner', 'manager', 'cashier'], group: 'Stock' },
  { to: '/transfers', label: 'Transfers', icon: Truck, roles: ['owner', 'manager'], group: 'Stock' },
];

export const navGroups = ['Insights', 'Sell', 'Book', 'Stock'] as const;

export const homeFor = (role: Role) => navItems.find((n) => n.roles.includes(role))?.to ?? '/products';
