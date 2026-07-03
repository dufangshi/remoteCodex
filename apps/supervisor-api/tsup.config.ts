import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  external: ['puppeteer-core'],
  dts: true,
  clean: true,
});
