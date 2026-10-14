// Writes the publishable manifest into `dist/`, which is what gets published
// (see `publishConfig.directory`). The tarball keeps the flat layout consumers
// already depend on: `index.js`, `index.mjs` and `index.d.ts` at the root.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const packageDir = process.cwd();
const distDir = join(packageDir, 'dist');
const rootDir = new URL('..', import.meta.url).pathname;

const manifest = JSON.parse(
  readFileSync(join(packageDir, 'package.json'), 'utf8'),
);

// Build-time only; also holds `catalog:` specifiers npm cannot resolve.
delete manifest.scripts;
delete manifest.publishConfig;
delete manifest.devDependencies;

writeFileSync(
  join(distDir, 'package.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);

for (const [source, target] of [
  [join(packageDir, 'README.md'), 'README.md'],
  [join(rootDir, 'LICENSE'), 'LICENSE'],
]) {
  if (existsSync(source)) {
    copyFileSync(source, join(distDir, target));
  }
}
