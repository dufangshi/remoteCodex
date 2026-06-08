import path from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  if (process.env.VITEST || mode === 'test') {
    process.env.NODE_ENV = 'test';
  }

  const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:8787';
  const wsProxyTarget = process.env.VITE_WS_PROXY_TARGET ?? 'ws://127.0.0.1:8787';

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '0.0.0.0',
      allowedHosts: [
        'fonshs-macbook-pro.tailaf4fa.ts.net',
        'debug.lnz-study.com',
      ],
      fs: {
        allow: [path.resolve(__dirname, '../..')]
      },
      proxy: {
        '/api': apiProxyTarget,
        '/healthz': apiProxyTarget,
        '/ws': {
          target: wsProxyTarget,
          ws: true
        }
      }
    },
    preview: {
      host: '0.0.0.0'
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      server: {
        deps: {
          inline: [
            '@remote-codex/thread-ui',
            '@remote-codex/plugin-xyz-viewer',
          ],
        },
      },
      env: {
        NODE_ENV: 'test',
      },
    }
  };
});
