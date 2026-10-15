import type { EnvInspectorDeps } from '../env-inspector.service';
import type { EnvInspectorSettings } from '../types';

import path from 'node:path';

// The service resolves absolute paths, so the fixtures are anchored the same
// way and canonicalized to forward slashes to stay platform-independent.
export const toPosix = (filePath: string) => filePath.split(path.sep).join('/');

export const ROOT = toPosix(path.resolve('/repo'));
export const WEB_DIR = `${ROOT}/apps/web`;

/** The settings a Makerkit kit passes: one app at apps/web. */
export const WEB_APP = [{ name: 'web', path: 'apps/web' }] as const;

/** In-memory files keyed by forward-slash absolute path. */
export function createMemoryDeps(
  files: Record<string, string> = {},
  settings?: EnvInspectorSettings,
) {
  const store: Record<string, string> = Object.fromEntries(
    Object.entries(files).map(([filePath, content]) => [
      toPosix(filePath),
      content,
    ]),
  );

  const deps: EnvInspectorDeps = {
    rootPath: ROOT,
    settings,
    async readFile(filePath) {
      const key = toPosix(filePath);

      if (!(key in store)) {
        throw new Error(`ENOENT: no such file: ${filePath}`);
      }

      return store[key]!;
    },
    async writeFile(filePath, content) {
      store[toPosix(filePath)] = content;
    },
    async fileExists(filePath) {
      return toPosix(filePath) in store;
    },
  };

  return { deps, store };
}
