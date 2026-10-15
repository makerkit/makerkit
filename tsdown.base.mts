import type { UserConfig } from 'tsdown';

/**
 * Builds a package into the flat `dist/` layout its consumers already import:
 * `<entry>.mjs` (ESM), `<entry>.js` (CJS) and one `<entry>.d.ts`.
 * `dependencies` and `peerDependencies` stay external automatically.
 */
export function libraryConfig(entry: Record<string, string>): UserConfig[] {
  const shared = {
    entry,
    outDir: 'dist',
    platform: 'neutral',
    tsconfig: 'tsconfig.lib.json',
  } satisfies UserConfig;

  return [
    {
      ...shared,
      clean: true,
      format: 'esm',
      dts: false,
      outExtensions: () => ({ js: '.mjs' }),
    },
    {
      ...shared,
      clean: false,
      format: 'cjs',
      dts: true,
      outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
    },
  ];
}
