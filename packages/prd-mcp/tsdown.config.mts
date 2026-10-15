import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { bin: 'src/bin.ts' },
  outDir: 'dist',
  platform: 'node',
  format: 'esm',
  dts: false,
  clean: true,
  outExtensions: () => ({ js: '.mjs' }),
});
