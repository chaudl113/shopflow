import type { Role } from '@/stores/session';

export interface NavItem {
  to: string;
  label: string;
  icon: string;
  roles: Role[];
}

const all: Role[] = ['owner', 'manager', 'cashier', 'staff'];

const sellers: Role[] = ['owner', 'manager', 'cashier'];

export const navItems: NavItem[] = [
  { to: '/pos', label: 'Point of sale', icon: '🛒', roles: sellers },
  { to: '/sales', label: 'Sales & returns', icon: '🧾', roles: sellers },
  { to: '/shifts', label: 'Shifts', icon: '💵', roles: sellers },
  { to: '/products', label: 'Products', icon: '🏷️', roles: all },
  { to: '/inventory', label: 'Inventory', icon: '📦', roles: ['owner', 'manager', 'cashier'] },
  { to: '/transfers', label: 'Transfers', icon: '🚚', roles: ['owner', 'manager'] },
];

export const homeFor = (role: Role) => navItems.find((n) => n.roles.includes(role))?.to ?? '/products';
