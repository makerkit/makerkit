import { defineStep, done, failed, todo } from './define';
import type {
  CheckResult,
  Confirm,
  StepContext,
  StepDefinition,
} from './types';

import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  mkdir,
  open,
  readFile,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export type ProcessSpec = {
  command: string;
  args: string[];
  cwd: string;
  // extra env (secrets go here, never in args)
  env?: Record<string, string>;
  // what people read (`pnpm dev`), else the command line
  label?: string;
};

// what a process step needs from the system; fakes in tests
export type Processes = {
  // .makerkit/processes: `<id>.json` (pid + command) and `<id>.log`
  dir: string;
  // starts `spec` detached, output to `log`; returns its pid
  start(spec: ProcessSpec, log: string): Promise<number>;
  isAlive(pid: number): boolean;
  // any process left in the group `pid` leads (it outlives its leader)
  groupAlive(pid: number): boolean;
  // its command line and start time (tells a reused pid apart); null when
  // it can't be read
  inspect(pid: number): ProcessInfo | null;
  // SIGTERM (or SIGKILL when `force`) to the process and its children
  signal(pid: number, force: boolean): void;
  wait(ms: number, signal?: AbortSignal): Promise<void>;
  // this boot of the computer (pids start over after a restart); null when
  // it can't be told
  boot?: () => string | null;
};

export type ProcessInfo = { command: string; started: string };

type PidFile = {
  pid: number;
  command: string;
  args: string[];
  started?: string | null;
  // where this start's output begins in the log (readyLine reads from here)
  logFrom?: number;
  // the boot it started in: a file from another boot is never ours
  boot?: string | null;
};

/**
 * A step that keeps running (dev server, webhook forwarding): apply()
 * starts it detached and returns once it's healthy, check() is "ours and
 * alive and healthy", stop() ends it. Only a process whose pid file this
 * repo wrote and whose command line still matches is ever signalled: never
 * by port.
 */
export function defineProcessStep<D>({
  id,
  title,
  spec,
  healthy,
  readyLine,
  processes,
  confirm = { level: 'run' },
  readyWithinMs = 60_000,
  elsewhere,
  ...rest
}: {
  id: string;
  title: string;
  spec: (deps: D) => ProcessSpec;
  processes: (deps: D) => Processes;
  confirm?: Confirm;
  readyWithinMs?: number;
  // when none of ours runs: what's there instead (a copy started by hand
  // in this repo: done; another program on its port: the owner's step);
  // null when nothing is
  elsewhere?: (ctx: StepContext<D>) => Promise<CheckResult | null>;
} & Pick<StepDefinition<D>, 'needs' | 'onlyWhenNamed'> &
  (
    | {
        // answers like it should (an HTTP probe): honour `signal`, time out
        healthy: (ctx: StepContext<D>) => Promise<boolean>;
        readyLine?: never;
      }
    | {
        // nothing to probe: ready once its own output has this line
        readyLine: RegExp;
        healthy?: never;
      }
  )) {
  // our process answers: the probe, or the ready line since it started
  const answering = async (
    ctx: StepContext<D>,
    running: PidFile | null,
  ): Promise<boolean> => {
    if (healthy) {
      return healthy(ctx);
    }

    return (
      running !== null &&
      readyLine.test(await logSince(processes(ctx.deps), id, running))
    );
  };

  return defineStep<D>({
    id,
    title,
    confirm,
    ...rest,
    async check(ctx) {
      const { deps } = ctx;
      const system = processes(deps);
      const running = await ownProcess(system, id);

      if (!running) {
        const shown = labelOf(spec(deps));
        const other = await elsewhere?.(ctx);

        if (other) {
          return other;
        }

        if (await answering(ctx, null)) {
          return failed('another copy is already using its port', {
            fix: `stop the other copy (another terminal running \`${shown}\`?), then start it again`,
          });
        }

        return todo('not running', {
          changes: [`start \`${shown}\` in the background`],
        });
      }

      if (!(await answering(ctx, running))) {
        return failed(`running (process ${running.pid}) but not answering`, {
          fix: `stop it and start it again; its output is in ${logOf(system, id)}`,
        });
      }

      return {
        ...done(`running (process ${running.pid})`),
        process: { pid: running.pid },
      };
    },
    async apply(ctx) {
      const { deps, signal } = ctx;
      const system = processes(deps);
      const started = spec(deps);
      const log = logOf(system, id);

      await mkdir(system.dir, { recursive: true });

      const logFrom = await stat(log).then(
        (info) => info.size,
        () => 0,
      );
      const pid = await system.start(started, log);
      const file: PidFile = {
        pid,
        command: started.command,
        args: started.args,
        started: system.inspect(pid)?.started ?? null,
        logFrom,
        boot: system.boot?.() ?? null,
      };

      await writeFile(pidFileOf(system, id), JSON.stringify(file));

      for (const deadline = Date.now() + readyWithinMs; ;) {
        // cancelled: it keeps starting; check() reports it on the next run
        signal.throwIfAborted();

        // ours first: a probe can answer for another copy on the same port
        if (!system.isAlive(pid)) {
          await unlink(pidFileOf(system, id)).catch(() => undefined);

          throw new Error(`it stopped before it was ready; see ${log}`);
        }

        if (await answering(ctx, file)) {
          return;
        }

        if (Date.now() > deadline) {
          throw new Error(
            `not ready after ${readyWithinMs / 1000}s; see ${log}`,
          );
        }

        await system.wait(500, signal);
      }
    },
    async stop(ctx) {
      const system = processes(ctx.deps);
      const running = await ownProcess(system, id);

      if (running) {
        await end(system, running.pid);
      } else {
        // a copy the kit didn't start is stopped where it runs, never here
        const other = await elsewhere?.(ctx);

        if (other?.state === 'done') {
          throw new Error(
            [other.message, other.fix].filter(Boolean).join(': '),
          );
        }
      }

      // gone (or never ours): the file goes
      await unlink(pidFileOf(system, id)).catch(() => undefined);
    },
  });
}

/**
 * The pid file's process, if it's still the one this repo started: same
 * command line and start time; or its leader is gone but its group lives
 * on (a group id isn't reused while the group has members).
 */
async function ownProcess(system: Processes, id: string) {
  const file = await readPidFile(system, id);

  if (!file) {
    return null;
  }

  // written before a restart: its pid (or group) is someone else's now
  const boot = system.boot?.();

  if (file.boot && boot && file.boot !== boot) {
    return null;
  }

  if (!system.isAlive(file.pid)) {
    return system.groupAlive(file.pid) ? file : null;
  }

  const info = system.inspect(file.pid);
  const matches =
    info !== null &&
    info.command.includes(basename(file.command)) &&
    file.args.every((arg) => info.command.includes(arg)) &&
    (!file.started || info.started === file.started);

  return matches ? file : null;
}

// SIGTERM to the whole group, SIGKILL after 5s; throws if it outlives both
async function end(system: Processes, pid: number) {
  for (const force of [false, true]) {
    system.signal(pid, force);

    for (let tries = 0; tries < 20; tries++) {
      if (!system.groupAlive(pid)) {
        return;
      }

      await system.wait(250);
    }
  }

  throw new Error(`process ${pid} is still running after SIGKILL`);
}

async function readPidFile(system: Processes, id: string) {
  const text = await readFile(pidFileOf(system, id), 'utf8').catch(() => '');

  try {
    const file = JSON.parse(text) as PidFile;

    return Number.isInteger(file.pid) && file.pid > 0 ? file : null;
  } catch {
    return null;
  }
}

// this start's output only: the log keeps earlier runs
async function logSince(system: Processes, id: string, file: PidFile) {
  const text = await readFile(logOf(system, id)).catch(() => Buffer.alloc(0));

  return text.subarray(file.logFrom ?? 0).toString('utf8');
}

const labelOf = ({ label, command, args }: ProcessSpec) =>
  label ?? [command, ...args].join(' ');

const pidFileOf = (system: Processes, id: string) =>
  join(system.dir, `${id}.json`);

const logOf = (system: Processes, id: string) => join(system.dir, `${id}.log`);

// the real system: detached process groups, /proc or ps for command lines
export function createSystemProcesses(dir: string): Processes {
  return {
    dir,
    async start({ command, args, cwd, env }, log) {
      const output = await open(log, 'a');

      try {
        const child = spawn(command, args, {
          cwd,
          env: { ...process.env, ...env },
          detached: true,
          stdio: ['ignore', output.fd, output.fd],
        });

        await new Promise<void>((resolve, reject) => {
          child.once('spawn', resolve);
          child.once('error', reject);
        });

        child.unref();

        return child.pid!;
      } finally {
        await output.close();
      }
    },
    isAlive: isProcessAlive,
    groupAlive: (pid) => isProcessAlive(-pid),
    boot: bootId,
    inspect: inspectProcess,
    signal(pid, force) {
      const name = force ? 'SIGKILL' : 'SIGTERM';

      try {
        // detached: the pid leads its own group (pnpm and its children)
        process.kill(-pid, name);
      } catch {
        try {
          process.kill(pid, name);
        } catch {
          // already gone
        }
      }
    },
    async wait(ms, signal) {
      await sleep(ms, undefined, { signal }).catch(() => undefined);
    },
  };
}

/**
 * Linux: /proc (start time = field 22 of stat, after the ")" of the name);
 * elsewhere one `ps` (lstart is 24 characters wide, then the command).
 */
export function inspectProcess(pid: number): ProcessInfo | null {
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const started = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
      const command = readFileSync(`/proc/${pid}/cmdline`, 'utf8');

      return started
        ? { started, command: command.replaceAll('\0', ' ').trim() }
        : null;
    }

    const line = execFileSync(
      'ps',
      ['-o', 'lstart=', '-o', 'command=', '-p', String(pid)],
      {
        encoding: 'utf8',
      },
    );

    return line.trim()
      ? { started: line.slice(0, 24).trim(), command: line.slice(24).trim() }
      : null;
  } catch {
    return null;
  }
}

// Linux: the kernel's boot id; macOS: the boot time; null elsewhere
let boot: string | null | undefined;

export function bootId() {
  if (boot !== undefined) {
    return boot;
  }

  try {
    boot =
      process.platform === 'linux'
        ? readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()
        : execFileSync('sysctl', ['-n', 'kern.boottime'], {
            encoding: 'utf8',
          }).trim();
  } catch {
    boot = null;
  }

  return boot || null;
}

export function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
