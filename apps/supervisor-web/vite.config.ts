import path from 'node:path';
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync } from 'node:fs';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const require = createRequire(import.meta.url);

function packageChunk(id: string) {
  if (!id.includes('/node_modules/')) {
    return null;
  }

  if (
    id.includes('/node_modules/react/') ||
    id.includes('/node_modules/react-dom/') ||
    id.includes('/node_modules/react-router-dom/')
  ) {
    return 'react-vendor';
  }

  if (
    id.includes('/node_modules/xterm/') ||
    id.includes('/node_modules/@xterm/')
  ) {
    return 'terminal-vendor';
  }

  if (
    id.includes('/node_modules/react-markdown/') ||
    id.includes('/node_modules/remark-') ||
    id.includes('/node_modules/rehype-') ||
    id.includes('/node_modules/micromark') ||
    id.includes('/node_modules/unified/') ||
    id.includes('/node_modules/katex/')
  ) {
    return 'markdown-vendor';
  }

  if (
    id.includes('/node_modules/react-syntax-highlighter/') ||
    id.includes('/node_modules/refractor/') ||
    id.includes('/node_modules/prismjs/')
  ) {
    return 'syntax-vendor';
  }

  if (
    id.includes('/node_modules/@xyflow/') ||
    id.includes('/node_modules/d3-')
  ) {
    return 'graph-vendor';
  }

  if (
    id.includes('/node_modules/@radix-ui/') ||
    id.includes('/node_modules/lucide-react/')
  ) {
    return 'ui-vendor';
  }

  return null;
}

export default defineConfig(({ mode }) => {
  if (process.env.VITEST || mode === 'test') {
    process.env.NODE_ENV = 'test';
  }

  const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:8787';
  const wsProxyTarget = process.env.VITE_WS_PROXY_TARGET ?? 'ws://127.0.0.1:8787';
  const threeDmolSource = require.resolve('3dmol/build/3Dmol-min.js', {
    paths: [path.resolve(__dirname, '../../packages/plugin-xyz-viewer')],
  });

  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'copy-3dmol-runtime',
        apply: 'build',
        writeBundle(options) {
          const outputDir =
            typeof options.dir === 'string'
              ? options.dir
              : path.resolve(__dirname, 'dist');
          const vendorDir = path.join(outputDir, 'vendor');
          mkdirSync(vendorDir, { recursive: true });
          copyFileSync(threeDmolSource, path.join(vendorDir, '3Dmol-min.js'));
        },
      },
    ],
    optimizeDeps: {
      exclude: ['@remote-codex/thread-ui'],
    },
    server: {
      host: '0.0.0.0',
      allowedHosts: ['fonshs-macbook-pro.tailaf4fa.ts.net'],
      fs: {
        allow: [
          path.resolve(__dirname, '../..'),
          path.resolve(__dirname, '../../../remote-codex-thread-ui'),
        ]
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
      env: {
        NODE_ENV: 'test',
      },
    },
    build: {
      chunkSizeWarningLimit: 550,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (
              id.includes('/remote-codex-thread-ui/packages/thread-ui/') ||
              id.includes('/node_modules/@remote-codex/thread-ui/')
            ) {
              return 'thread-ui';
            }

            return packageChunk(id);
          },
        },
      },
    },
  };
});
