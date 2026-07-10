import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  dts: true,
  sourcemap: true,
  clean: true,
  noExternal: ['fastify', 'zod'],
  outExtension: () => ({ js: '.cjs' }),
});
