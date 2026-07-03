import path from 'node:path';
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync } from 'node:fs';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const require = createRequire(import.meta.url);

export default defineConfig(({ mode }) => {
  if (process.env.VITEST || mode === 'test') {
    process.env.NODE_ENV = 'test';
  }

  const threadUiRoot = path.resolve(__dirname, '../../../../remote-codex-thread-ui');
  const xyzViewerRoot = path.join(threadUiRoot, 'packages/plugin-xyz-viewer');
  const xyzViewerEntry = path.join(xyzViewerRoot, 'src/index.ts');
  const xyzViewerStyles = path.join(xyzViewerRoot, 'src/styles.css');
  const lucideReactEntry = require.resolve('lucide-react', { paths: [__dirname] });
  const threeDmolEntry = require.resolve('3dmol', { paths: [__dirname] });
  const threeDmolSource = require.resolve('3dmol/build/3Dmol-min.js', {
    paths: [__dirname],
  });

  return {
    base: './',
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
    resolve: {
      alias: {
        '@remote-codex/plugin-xyz-viewer/styles.css': xyzViewerStyles,
        '@remote-codex/plugin-xyz-viewer': xyzViewerEntry,
        '3dmol': threeDmolEntry,
        'lucide-react': lucideReactEntry,
      },
    },
    optimizeDeps: {
      include: ['@remote-codex/thread-ui'],
    },
    server: {
      fs: {
        allow: [path.resolve(__dirname, '../../..'), threadUiRoot],
      },
    },
    test: {
      environment: 'jsdom',
      env: {
        NODE_ENV: 'test',
      },
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      chunkSizeWarningLimit: 2800,
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  };
});
