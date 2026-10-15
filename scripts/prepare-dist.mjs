// Writes the publishable manifest into `dist/`, which is what gets published
// (see `publishConfig.directory`). The tarball keeps the flat layout consumers
// already depend on: `index.js`, `index.mjs` and `index.d.ts` at the root.
import {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
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

// npm cannot install `workspace:` specifiers, and this manifest is published
// as-is, so resolve them the way `pnpm publish` would.
const workspaceVersions = readWorkspaceVersions();

for (const field of [
  'dependencies',
  'peerDependencies',
  'optionalDependencies',
]) {
  for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
    if (spec.startsWith('catalog:')) {
      throw new Error(
        `${manifest.name}: ${field}.${name} uses "${spec}", which npm cannot resolve.`,
      );
    }

    if (!spec.startsWith('workspace:')) {
      continue;
    }

    const version = workspaceVersions.get(name);

    if (!version) {
      throw new Error(`${manifest.name}: ${name} is not a workspace package.`);
    }

    const range = spec.slice('workspace:'.length);

    manifest[field][name] =
      range === '*'
        ? version
        : range === '^' || range === '~'
          ? `${range}${version}`
          : range;
  }
}

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

function readWorkspaceVersions() {
  const versions = new Map();
  const dirs = [
    join(rootDir, 'packages'),
    join(rootDir, 'packages/data-loader/supabase'),
  ];

  for (const dir of dirs) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name, 'package.json');

      if (entry.isDirectory() && existsSync(file)) {
        const { name, version } = JSON.parse(readFileSync(file, 'utf8'));
        versions.set(name, version);
      }
    }
  }

  return versions;
}
