import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  server: {
    port: 5201,
    strictPort: true,
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:3201' },
  },
  preview: { port: 5201, strictPort: true, proxy: { '/api': process.env.API_URL ?? 'http://localhost:3201' } },
  test: { environment: 'jsdom' },
});
