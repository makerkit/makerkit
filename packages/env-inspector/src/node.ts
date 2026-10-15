import type { EnvInspectorDeps } from './env-inspector.service';
import type { EnvInspectorSettings } from './types';

import { existsSync, readFileSync } from 'node:fs';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface EnvInspectorNodeOptions {
  settings?: EnvInspectorSettings;
}

/** Filesystem dependencies for a project on disk at `rootPath`. */
export function createEnvInspectorDeps(
  rootPath = process.cwd(),
  options: EnvInspectorNodeOptions = {},
): EnvInspectorDeps {
  return {
    rootPath: path.resolve(rootPath),
    settings: options.settings,
    readFile(filePath) {
      return readFile(filePath, 'utf8');
    },
    writeFile(filePath, content) {
      return writeFile(filePath, content, 'utf8');
    },
    async fileExists(filePath) {
      try {
        await access(filePath);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export interface FindWorkspaceRootOptions {
  /**
   * Files that mark a workspace root. A package.json with a `workspaces`
   * field also counts. Default: pnpm-workspace.yaml, lerna.json, nx.json.
   */
  markers?: readonly string[];
  /** How many directories to check, starting with `startPath`. Default: 6. */
  maxDepth?: number;
}

export const DEFAULT_WORKSPACE_MARKERS = [
  'pnpm-workspace.yaml',
  'lerna.json',
  'nx.json',
] as const;

/**
 * Walks up from `startPath` to the monorepo root. Returns `startPath` when no
 * root is found within `maxDepth` directories (e.g. a single-app project).
 */
export function findWorkspaceRoot(
  startPath: string,
  options: FindWorkspaceRootOptions = {},
) {
  const markers = options.markers ?? DEFAULT_WORKSPACE_MARKERS;
  const maxDepth = options.maxDepth ?? 6;
  let current = startPath;

  for (let depth = 0; depth < maxDepth; depth++) {
    if (isWorkspaceRoot(current, markers)) {
      return current;
    }

    const parent = path.join(current, '..');

    if (parent === current) {
      break;
    }

    current = parent;
  }

  return startPath;
}

function isWorkspaceRoot(dir: string, markers: readonly string[]) {
  if (markers.some((marker) => existsSync(path.join(dir, marker)))) {
    return true;
  }

  const packageJsonPath = path.join(dir, 'package.json');

  if (!existsSync(packageJsonPath)) {
    return false;
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      workspaces?: unknown;
    };

    return packageJson.workspaces !== undefined;
  } catch {
    return false;
  }
}
