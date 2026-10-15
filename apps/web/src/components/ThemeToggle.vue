<script setup lang="ts">
import { MoonIcon, SunIcon } from '@lucide/vue';
import { computed } from 'vue';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/composables/useTheme';

const mode = useTheme();
const isDark = computed(() => mode.state.value === 'dark');
const toggle = () => (mode.value = isDark.value ? 'light' : 'dark');
</script>

<template>
  <Button variant="ghost" size="icon" :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'" @click="toggle">
    <SunIcon v-if="isDark" />
    <MoonIcon v-else />
  </Button>
</template>
