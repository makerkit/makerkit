import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const rawExecFile = promisify(execFile);

const IS_WINDOWS = process.platform === 'win32';

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunCommandOptions {
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

/**
 * Runs a command and always resolves: a failing command, a missing binary, a
 * timeout or an output overflow all come back as a non-zero exit code with the
 * reason in stderr, so callers can report it instead of crashing.
 */
export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions,
): Promise<CommandResult> {
  const invocation = buildInvocation(command, args);

  try {
    const result = await rawExecFile(invocation.command, invocation.args, {
      ...invocation.options,
      cwd: options.cwd,
      timeout: options.timeoutMs,
      maxBuffer: options.maxOutputBytes,
      encoding: 'utf8',
    });

    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    if (!isExecError(error)) {
      throw error;
    }

    return {
      stdout: error.stdout ?? '',
      // Spawn failures (ENOENT), timeouts and buffer overflows carry the
      // reason only in error.message; never drop it.
      stderr: error.stderr || describeExecFailure(error, options),
      exitCode: typeof error.code === 'number' ? error.code : 1,
    };
  }
}

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

/** The package manager the project uses, from its lockfile. Defaults to npm. */
export function detectPackageManager(rootPath: string): PackageManager {
  const lockfiles: Array<[string, PackageManager]> = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
  ];

  for (const [lockfile, packageManager] of lockfiles) {
    if (existsSync(path.join(rootPath, lockfile))) {
      return packageManager;
    }
  }

  return 'npm';
}

export async function readPackageJson(rootPath: string) {
  const content = await readFile(path.join(rootPath, 'package.json'), 'utf8');

  return JSON.parse(content) as { scripts?: Record<string, string> };
}

interface ExecError extends Error {
  code?: number | string;
  killed?: boolean;
  signal?: string | null;
  stdout?: string;
  stderr?: string;
}

function isExecError(error: unknown): error is ExecError {
  return error instanceof Error && ('code' in error || 'killed' in error);
}

function describeExecFailure(error: ExecError, options: RunCommandOptions) {
  if (error.killed || error.signal === 'SIGTERM') {
    return `Command timed out after ${options.timeoutMs / 1000}s and was killed.`;
  }

  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return `Command output exceeded ${options.maxOutputBytes / (1024 * 1024)}MB and was truncated.`;
  }

  return error.message;
}

// Windows command resolution ----------------------------------------------

const resolvedCommands = new Map<string, string>();

/**
 * On Windows only `.cmd` / `.bat` shims (pnpm, npm, `node_modules/.bin`
 * entries) need `cmd.exe`; native executables are spawned directly so Node
 * keeps escaping their arguments. `shell: true` with an args array does no
 * escaping at all, so the cmd.exe command line is escaped by hand.
 */
function buildInvocation(command: string, args: string[]) {
  if (!IS_WINDOWS) {
    return { command, args, options: {} };
  }

  const resolved = resolveWindowsCommand(command);

  if (!/\.(cmd|bat)$/i.test(resolved)) {
    return { command: resolved, args, options: { windowsHide: true } };
  }

  const commandLine = [
    escapeWindowsCommand(resolved),
    // `.cmd`/`.bat` files are parsed twice by cmd.exe, so meta characters need
    // to survive one extra round of unescaping.
    ...args.map((arg) => escapeWindowsArgument(arg, true)),
  ].join(' ');

  return {
    command: process.env['comspec'] ?? 'cmd.exe',
    args: ['/d', '/s', '/c', `"${commandLine}"`],
    options: { windowsHide: true, windowsVerbatimArguments: true },
  };
}

function resolveWindowsCommand(command: string) {
  const cached = resolvedCommands.get(command);

  if (cached !== undefined) {
    return cached;
  }

  const resolved = lookupWindowsCommand(command);

  // Misses are not cached, so a CLI installed later is still found.
  if (resolved) {
    resolvedCommands.set(command, resolved);
  }

  return resolved ?? command;
}

function lookupWindowsCommand(command: string) {
  const extensions = (process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((extension) => extension.trim())
    .filter(Boolean);

  const probe = (candidate: string) => {
    if (path.extname(candidate) && existsSync(candidate)) {
      return candidate;
    }

    for (const extension of extensions) {
      if (existsSync(candidate + extension)) {
        return candidate + extension;
      }
    }

    return null;
  };

  if (command.includes('/') || command.includes('\\')) {
    return probe(command);
  }

  const searchPath = process.env['PATH'] ?? process.env['Path'] ?? '';

  for (const dir of searchPath.split(path.delimiter).filter(Boolean)) {
    const found = probe(path.join(dir, command));

    if (found) {
      return found;
    }
  }

  return null;
}

// Escaping follows cross-spawn / https://qntm.org/cmd.
const CMD_META_CHARS = /([()\][%!^"`<>&|;, *?])/g;

function escapeWindowsCommand(command: string) {
  return command.replace(CMD_META_CHARS, '^$1');
}

function escapeWindowsArgument(
  argument: string,
  doubleEscapeMetaChars = false,
) {
  // Backslashes before a double quote are doubled, and the quote escaped.
  let escaped = argument.replace(/(\\*)"/g, '$1$1\\"');

  // Trailing backslashes would otherwise escape the closing quote we add.
  escaped = escaped.replace(/(\\*)$/, '$1$1');

  escaped = `"${escaped}"`.replace(CMD_META_CHARS, '^$1');

  if (doubleEscapeMetaChars) {
    escaped = escaped.replace(CMD_META_CHARS, '^$1');
  }

  return escaped;
}
