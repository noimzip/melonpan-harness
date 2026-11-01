import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'node:crypto': path.resolve(__dirname, './src/shims/crypto-shim.ts'),
      'node:path': path.resolve(__dirname, './src/shims/path-shim.ts'),
      'node:fs/promises': path.resolve(__dirname, './src/shims/empty-shim.ts'),
      'node:fs': path.resolve(__dirname, './src/shims/empty-shim.ts'),
      'node:child_process': path.resolve(__dirname, './src/shims/empty-shim.ts'),
      'node:url': path.resolve(__dirname, './src/shims/empty-shim.ts'),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  define: {
    'process.env': {},
  },
});
