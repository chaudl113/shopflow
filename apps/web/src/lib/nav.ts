import type { Role } from '@/stores/session';

export interface NavItem {
  to: string;
  label: string;
  icon: string;
  roles: Role[];
}

const all: Role[] = ['owner', 'manager', 'cashier', 'staff'];

export const navItems: NavItem[] = [
  { to: '/products', label: 'Products', icon: '🏷️', roles: all },
  { to: '/inventory', label: 'Inventory', icon: '📦', roles: ['owner', 'manager', 'cashier'] },
];

export const homeFor = (role: Role) => navItems.find((n) => n.roles.includes(role))?.to ?? '/products';
