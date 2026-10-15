import { defineStore } from 'pinia';
import { ref } from 'vue';
import { ApiError } from '@/lib/api';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
}

export const useToast = defineStore('toast', () => {
  const items = ref<Toast[]>([]);
  let seq = 0;
  function push(kind: Toast['kind'], text: string) {
    const id = ++seq;
    items.value.push({ id, kind, text });
    setTimeout(() => (items.value = items.value.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3500);
  }
  const success = (t: string) => push('success', t);
  const info = (t: string) => push('info', t);
  const error = (e: unknown) => push('error', e instanceof ApiError || e instanceof Error ? e.message : String(e));
  return { items, success, info, error };
});
