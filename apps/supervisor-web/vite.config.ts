import path from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    fs: {
      allow: [path.resolve(__dirname, '../..')]
    },
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/healthz': 'http://127.0.0.1:8787',
      '/ws': {
        target: 'ws://127.0.0.1:8787',
        ws: true
      }
    }
  },
  preview: {
    host: '0.0.0.0'
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts'
  }
});
