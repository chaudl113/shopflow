import { ref } from 'vue';
import { api } from '@/lib/api';

export interface AppMeta {
  /** Public demo: one-click sign-in, shared accounts that cannot be changed. */
  demo: boolean;
  bookingPage: { slug: string; name: string } | null;
}

const meta = ref<AppMeta | null>(null);
let loading: Promise<AppMeta> | null = null;

/** What the server says about this deployment. Fetched once and shared. */
export function useAppMeta() {
  loading ??= api
    .get<AppMeta>('/meta')
    .catch((): AppMeta => ({ demo: false, bookingPage: null }))
    .then((m) => (meta.value = m));
  return { meta, ready: loading };
}
