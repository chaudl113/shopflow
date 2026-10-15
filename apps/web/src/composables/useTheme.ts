import { useColorMode } from '@vueuse/core';

/** Light/dark/auto, persisted in localStorage; toggles the `.dark` class used by the shadcn tokens. */
export const useTheme = () => useColorMode({ storageKey: 'shopflow.theme', initialValue: 'auto' });
