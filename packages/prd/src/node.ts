import type { PrdDeps, PrdVerificationResult } from './prd.service';

import { spawn } from 'node:child_process';
import {
  access,
  mkdir,
  readFile,
  readdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

/** Check-only scripts that gate marking a story as completed. */
const DEFAULT_COMPLETION_CHECKS = ['typecheck', 'lint'];

/** Output kept from a failing script, so the reason fits in a tool response. */
const MAX_FAILURE_DETAIL = 300;

export interface NodePrdDepsOptions {
  /**
   * Decides whether a story may be marked completed. Defaults to running the
   * project's `typecheck` and `lint` scripts (see `createScriptVerifier`).
   */
  verifyCompletion?: PrdDeps['verifyCompletion'];
}

/** PRD dependencies backed by the local filesystem, rooted at `rootPath`. */
export function createNodePrdDeps(
  rootPath = process.cwd(),
  options: NodePrdDepsOptions = {},
): PrdDeps {
  return {
    rootPath,
    readdir(path) {
      return readdir(path);
    },
    readFile(path) {
      return readFile(path, 'utf8');
    },
    writeFile(path, content) {
      return writeFile(path, content, 'utf8');
    },
    async mkdir(path) {
      await mkdir(path, { recursive: true });
    },
    unlink(path) {
      return unlink(path);
    },
    fileExists,
    now() {
      return new Date();
    },
    verifyCompletion:
      options.verifyCompletion ?? createScriptVerifier(rootPath),
  };
}

/**
 * Verifies completion by running package.json scripts with the project's
 * package manager. Scripts the project does not define are skipped, so a repo
 * without e.g. `lint` can still complete stories.
 */
export function createScriptVerifier(
  rootPath: string,
  scripts: string[] = DEFAULT_COMPLETION_CHECKS,
): PrdDeps['verifyCompletion'] {
  return async () => {
    const defined = await readScriptNames(rootPath);
    const toRun = scripts.filter((script) => defined.has(script));
    const skipped = scripts.filter((script) => !defined.has(script));
    const packageManager = await detectPackageManager(rootPath);

    const messages = skipped.map(
      (script) => `${script}: skipped (no "${script}" script in package.json)`,
    );

    let errors = 0;

    for (const script of toRun) {
      const result = await runScript(packageManager, script, rootPath);

      if (result.exitCode !== 0) {
        errors += 1;

        const detail = result.output.trim().slice(-MAX_FAILURE_DETAIL);
        messages.push(`${script}: fail${detail ? ` (${detail})` : ''}`);
      }
    }

    return {
      passed: errors === 0,
      checks: toRun,
      errors,
      warnings: 0,
      diagnostics: [],
      messages,
    } satisfies PrdVerificationResult;
  };
}

async function fileExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readScriptNames(rootPath: string) {
  try {
    const manifest = JSON.parse(
      await readFile(join(rootPath, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };

    return new Set(Object.keys(manifest.scripts ?? {}));
  } catch {
    return new Set<string>();
  }
}

async function detectPackageManager(rootPath: string) {
  const lockfiles: Array<[string, string]> = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
    ['yarn.lock', 'yarn'],
  ];

  for (const [lockfile, packageManager] of lockfiles) {
    if (await fileExists(join(rootPath, lockfile))) {
      return packageManager;
    }
  }

  return 'npm';
}

function runScript(packageManager: string, script: string, cwd: string) {
  return new Promise<{ exitCode: number; output: string }>((resolve) => {
    const child = spawn(packageManager, ['run', script], {
      cwd,
      shell: process.platform === 'win32',
    });

    let output = '';

    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', (error) =>
      resolve({ exitCode: 1, output: error.message }),
    );
    child.on('close', (code) => resolve({ exitCode: code ?? 1, output }));
  });
}
