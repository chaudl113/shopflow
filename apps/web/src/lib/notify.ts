import { toast as sonner } from 'vue-sonner';
import { ApiError } from '@/lib/api';

/** Thin wrapper over shadcn's Sonner so call sites can pass API errors directly. */
export const toast = {
  success: (text: string) => sonner.success(text),
  info: (text: string) => sonner.info(text),
  error: (e: unknown) => sonner.error(e instanceof ApiError || e instanceof Error ? e.message : String(e)),
};
