import { createRouter, createWebHistory } from 'vue-router';
import AppShell from '@/components/AppShell.vue';
import { homeFor } from '@/lib/nav';
import { useSession, type Role } from '@/stores/session';

declare module 'vue-router' {
  interface RouteMeta {
    roles?: Role[];
    public?: boolean;
  }
}

const sellers: Role[] = ['owner', 'manager', 'cashier'];

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('@/views/LoginView.vue'), meta: { public: true } },
    { path: '/book/:slug', component: () => import('@/views/PublicBookingView.vue'), meta: { public: true } },
    { path: '/receipt/:id', component: () => import('@/views/ReceiptView.vue') },
    {
      path: '/',
      component: AppShell,
      children: [
        { path: '', redirect: () => homeFor(useSession().user?.role ?? 'staff') },
        { path: 'dashboard', component: () => import('@/views/DashboardView.vue'), meta: { roles: ['owner', 'manager'] } },
        { path: 'pos', component: () => import('@/views/PosView.vue'), meta: { roles: sellers } },
        { path: 'sales', component: () => import('@/views/SalesView.vue'), meta: { roles: sellers } },
        { path: 'shifts', component: () => import('@/views/ShiftsView.vue'), meta: { roles: sellers } },
        { path: 'bookings', component: () => import('@/views/BookingsView.vue') },
        { path: 'products', component: () => import('@/views/ProductsView.vue') },
        { path: 'transfers', component: () => import('@/views/TransfersView.vue'), meta: { roles: ['owner', 'manager'] } },
        { path: 'inventory', component: () => import('@/views/InventoryView.vue'), meta: { roles: ['owner', 'manager', 'cashier'] } },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach(async (to) => {
  const session = useSession();
  if (!session.ready) await session.restore();
  if (to.meta.public) return true;
  if (!session.user) return { path: '/login', query: { next: to.fullPath } };
  if (to.meta.roles && !to.meta.roles.includes(session.user.role)) return homeFor(session.user.role);
  return true;
});
