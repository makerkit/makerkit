import { createRepoChecksServices } from '@makerkit/repo-checks/node';

import type { PrdDeps, PrdVerificationResult } from './prd.service';

import { randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** Check-only scripts that gate marking a story as completed. */
const DEFAULT_COMPLETION_CHECKS = ['typecheck', 'lint'];

/** Output kept from a failing script, so the reason fits in a tool response. */
const MAX_FAILURE_DETAIL = 300;

export interface NodePrdDepsOptions {
  /** Absolute directory or a path relative to the project root. */
  prdsDir?: string;
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
    prdsDir: options.prdsDir ? resolve(rootPath, options.prdsDir) : undefined,
    readdir(path) {
      return readdir(path);
    },
    readFile(path) {
      return readFile(path, 'utf8');
    },
    async writeFile(path, content) {
      const temporaryPath = `${path}.${randomUUID()}.tmp`;

      try {
        await writeFile(temporaryPath, content, {
          encoding: 'utf8',
          flag: 'wx',
        });
        await rename(temporaryPath, path);
      } finally {
        await rm(temporaryPath, { force: true });
      }
    },
    async mkdir(path) {
      await mkdir(path, { recursive: true });
    },
    unlink(path) {
      return unlink(path);
    },
    fileExists,
    async withWriteLock(path, write) {
      const lockPath = `${path}.lock`;

      try {
        await mkdir(lockPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new Error(
            `PRD write lock is held at "${lockPath}". Reload the PRD and retry. If a writer crashed, verify that no writer is active before removing the lock directory.`,
          );
        }

        throw error;
      }

      try {
        return await write();
      } finally {
        await rmdir(lockPath);
      }
    },
    now() {
      return new Date();
    },
    verifyCompletion:
      options.verifyCompletion ?? createScriptVerifier(rootPath),
  };
}

/**
 * Verifies completion by running the project's package.json scripts with its
 * package manager (via @makerkit/repo-checks), so a failure comes back as
 * file-and-line diagnostics. Scripts the project does not define are skipped,
 * so a repo without e.g. `lint` can still complete stories.
 */
export function createScriptVerifier(
  rootPath: string,
  scripts: string[] = DEFAULT_COMPLETION_CHECKS,
): PrdDeps['verifyCompletion'] {
  return async () => {
    // A project can be just a folder with .prds: nothing to check then
    if (!(await fileExists(join(rootPath, 'package.json')))) {
      return {
        passed: true,
        checks: [],
        errors: 0,
        warnings: 0,
        diagnostics: [],
        messages: ['No package.json: there are no project checks to run.'],
      } satisfies PrdVerificationResult;
    }

    const checks = createRepoChecksServices(rootPath);
    const { scripts: available } = await checks.scripts.list();
    const defined = new Set(available.map((script) => script.name));

    const toRun = scripts.filter((script) => defined.has(script));
    const skipped = scripts.filter((script) => !defined.has(script));

    const messages = skipped.map(
      (script) => `${script}: skipped (no "${script}" script in package.json)`,
    );

    if (toRun.length === 0) {
      return {
        passed: true,
        checks: [],
        errors: 0,
        warnings: 0,
        diagnostics: [],
        messages,
      } satisfies PrdVerificationResult;
    }

    const result = await checks.runChecks.run({ scripts: toRun });

    // Failures the parser found no diagnostics for: report the output tail
    // instead of "0 errors".
    const unexplained = result.checks.filter(
      (check) => check.status !== 'pass' && check.diagnostics.length === 0,
    );

    for (const check of unexplained) {
      const detail = (check.stderr.trim() || check.stdout.trim()).slice(
        -MAX_FAILURE_DETAIL,
      );

      messages.push(
        `${check.script}: ${check.status}${detail ? ` (${detail})` : ''}`,
      );
    }

    return {
      passed: result.overall === 'pass',
      checks: result.scripts_requested,
      errors: result.summary.errors + unexplained.length,
      warnings: result.summary.warnings,
      diagnostics: result.diagnostics.map((diagnostic) => ({
        file: diagnostic.file,
        line: diagnostic.line,
        message: diagnostic.message,
        severity: diagnostic.severity,
      })),
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
