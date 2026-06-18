import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/worker-index.ts'],
  format: ['esm'],
  platform: 'node',
  external: ['puppeteer-core'],
  noExternal: ['@remote-codex/plugin-xyz-viewer'],
  dts: true,
  clean: true,
});
