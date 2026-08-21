import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  external: ['puppeteer-core', 'cross-spawn'],
  dts: true,
  clean: true,
});
