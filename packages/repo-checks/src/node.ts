import { createDepsUpgradeAdvisorService } from './deps-upgrade-advisor/deps-upgrade-advisor.service';
import type { RepoChecksServices } from './mcp';
import {
  type PackageManager,
  detectPackageManager,
  readPackageJson,
  runCommand,
} from './process';
import {
  type RunChecksScripts,
  createRunChecksService,
} from './run-checks/run-checks.service';
import {
  type ScriptCatalog,
  createScriptsService,
} from './scripts/scripts.service';

/** A full-monorepo typecheck can take a while; anything longer is stuck. */
const CHECK_TIMEOUT_MS = 10 * 60 * 1000;

/** Turbo streams every package's output; keep room for a cold run. */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

const OUTDATED_TIMEOUT_MS = 2 * 60 * 1000;

export interface RepoChecksNodeOptions {
  /** Defaults to the one the project's lockfile points to. */
  packageManager?: PackageManager;
  /** Which scripts run_checks runs in check, fix and test mode. */
  scripts?: Partial<RunChecksScripts>;
  /** Extra or overriding script guidance for the script tools. */
  catalog?: ScriptCatalog;
}

/** The repo-checks services for a project on disk at `rootPath`. */
export function createRepoChecksServices(
  rootPath = process.cwd(),
  options: RepoChecksNodeOptions = {},
): RepoChecksServices {
  const packageManager =
    options.packageManager ?? detectPackageManager(rootPath);
  const readRootPackageJson = () => readPackageJson(rootPath);

  return {
    runChecks: createRunChecksService({
      rootPath,
      packageManager,
      scripts: options.scripts,
      readRootPackageJson,
      executeCommand: (command, args) =>
        runCommand(command, args, {
          cwd: rootPath,
          timeoutMs: CHECK_TIMEOUT_MS,
          maxOutputBytes: MAX_OUTPUT_BYTES,
        }),
      now: () => Date.now(),
    }),
    scripts: createScriptsService({
      rootPath,
      readRootPackageJson,
      catalog: options.catalog,
    }),
    depsUpgradeAdvisor: createDepsUpgradeAdvisorService({
      packageManager,
      executeCommand: (command, args) =>
        runCommand(command, args, {
          cwd: rootPath,
          timeoutMs: OUTDATED_TIMEOUT_MS,
          maxOutputBytes: 10 * 1024 * 1024,
        }),
      nowIso: () => new Date().toISOString(),
    }),
  };
}

export { detectPackageManager, type PackageManager } from './process';
