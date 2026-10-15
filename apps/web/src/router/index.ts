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

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('@/views/LoginView.vue'), meta: { public: true } },
    {
      path: '/',
      component: AppShell,
      children: [
        { path: '', redirect: () => homeFor(useSession().user?.role ?? 'staff') },
        { path: 'products', component: () => import('@/views/ProductsView.vue') },
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
