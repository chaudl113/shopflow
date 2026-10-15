import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api, tokenStore } from '@/lib/api';

export type Role = 'owner' | 'manager' | 'cashier' | 'staff';
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  bookable: boolean;
  storeIds: string[];
}
export interface Store {
  id: string;
  code: string;
  slug: string;
  name: string;
  kind: 'store' | 'warehouse';
  address: string;
  phone: string;
  timezone: string;
  taxRateBps: number;
  allowNegativeStock: boolean;
  bookingEnabled: boolean;
}

const STORE_KEY = 'shopflow.storeId';

export const useSession = defineStore('session', () => {
  const user = ref<User | null>(null);
  const stores = ref<Store[]>([]);
  const storeId = ref<string | null>(localStorage.getItem(STORE_KEY));
  const ready = ref(false);

  const currentStore = computed(() => stores.value.find((s) => s.id === storeId.value) ?? null);
  const can = (...roles: Role[]) => !!user.value && roles.includes(user.value.role);

  async function loadStores() {
    stores.value = (await api.get<{ stores: Store[] }>('/stores')).stores;
    if (!stores.value.some((s) => s.id === storeId.value)) {
      selectStore(stores.value.find((s) => s.kind === 'store')?.id ?? stores.value[0]?.id ?? null);
    }
  }

  function selectStore(id: string | null) {
    storeId.value = id;
    if (id) localStorage.setItem(STORE_KEY, id);
    else localStorage.removeItem(STORE_KEY);
  }

  async function restore() {
    try {
      if (tokenStore.get()) {
        user.value = (await api.get<{ user: User }>('/auth/me')).user;
        await loadStores();
      }
    } catch {
      tokenStore.set(null);
      user.value = null;
    } finally {
      ready.value = true;
    }
  }

  async function login(email: string, password: string) {
    const res = await api.post<{ token: string; user: User }>('/auth/login', { email, password });
    tokenStore.set(res.token);
    user.value = res.user;
    await loadStores();
  }

  /** Public demo only: sign in to a shared demo account without a password. */
  async function loginDemo(as: 'owner' | 'manager' | 'cashier' | 'stylist') {
    const res = await api.post<{ token: string; user: User }>('/auth/demo', { as });
    tokenStore.set(res.token);
    user.value = res.user;
    await loadStores();
  }

  function logout() {
    tokenStore.set(null);
    user.value = null;
    stores.value = [];
  }

  return { user, stores, storeId, currentStore, ready, can, restore, login, loginDemo, logout, selectStore, loadStores };
});
