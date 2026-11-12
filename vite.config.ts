import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const SERVER_PORT = Number(process.env.PORT || 8787);

export default defineConfig({
  root: 'client',
  publicDir: 'public',
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) },
  },
  server: {
    port: Number(process.env.VITE_PORT || 5173),
    host: true,
    proxy: {
      '/ws': { target: `ws://localhost:${SERVER_PORT}`, ws: true },
      '/api': { target: `http://localhost:${SERVER_PORT}` },
    },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
  test: {
    root: '.',
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
  },
} as any);
