import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/worker-index.ts'],
  format: ['esm'],
  platform: 'node',
  external: ['puppeteer-core'],
  dts: true,
  clean: true,
});
