<script setup lang="ts">
import 'vue-sonner/style.css';
import { Toaster } from '@/components/ui/sonner';
import { useTheme } from '@/composables/useTheme';

useTheme();
</script>

<template>
  <RouterView />
  <Toaster rich-colors position="top-center" />
</template>
