import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createSystemProcesses,
  defineProcessStep,
  type Processes,
} from '../process';

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kit-processes-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const spec = { command: 'pnpm', args: ['dev'], cwd: '/repo' };
const idle = new AbortController().signal;

// a fake system: processes are pids in a map with their command line
function fakeSystem({ readyAfter = 0, dies = false, unkillable = false } = {}) {
  const alive = new Map<number, string>();
  // leader gone, children left: pids whose group still has members
  const orphans = new Set<number>();
  const started = new Map<number, string>();
  const signals: [number, boolean][] = [];
  let polls = 0;
  let next = 100;
  const system: Processes = {
    dir,
    start: async ({ command, args }) => {
      const pid = next++;

      // dies: exits at once (a busy port)
      if (!dies) {
        alive.set(pid, `node /usr/bin/${command} ${args.join(' ')}`);
      }

      started.set(pid, `t${pid}`);

      return pid;
    },
    isAlive: (pid) => alive.has(pid),
    groupAlive: (pid) => alive.has(pid) || orphans.has(pid),
    inspect: (pid) =>
      alive.has(pid)
        ? { command: alive.get(pid)!, started: started.get(pid) ?? '' }
        : null,
    signal: (pid, force) => {
      signals.push([pid, force]);

      if (!unkillable) {
        alive.delete(pid);
        orphans.delete(pid);
      }
    },
    wait: async () => undefined,
  };
  const healthy = async () => alive.size > 0 && polls++ >= readyAfter;

  return { system, alive, orphans, started, signals, healthy };
}

function stepWith(fake: ReturnType<typeof fakeSystem>, readyWithinMs = 60_000) {
  return defineProcessStep<null>({
    id: 'dev-server',
    title: 'Start the app',
    spec: () => spec,
    healthy: fake.healthy,
    processes: () => fake.system,
    readyWithinMs,
  });
}

const ctx = { deps: null, signal: idle };

describe('process steps', () => {
  it('starts detached, writes a pid file, returns once healthy, then checks done', async () => {
    const fake = fakeSystem({ readyAfter: 2 });
    const step = stepWith(fake);

    expect((await step.check(ctx)).state).toBe('todo');

    await step.apply?.(ctx);

    expect(
      JSON.parse(await readFile(join(dir, 'dev-server.json'), 'utf8')),
    ).toEqual({
      pid: 100,
      command: 'pnpm',
      args: ['dev'],
      started: 't100',
      logFrom: 0,
      boot: null,
    });
    expect(await step.check(ctx)).toMatchObject({
      state: 'done',
      message: 'running (process 100)',
    });
    expect(step.kind).toBe('process');
  });

  it('fails apply when the process dies before it is ready', async () => {
    const fake = fakeSystem({ readyAfter: 5, dies: true });

    await expect(stepWith(fake).apply?.(ctx)).rejects.toThrow(/stopped before/);
  });

  it('fails apply when it is not ready in time', async () => {
    const fake = fakeSystem({ readyAfter: Number.POSITIVE_INFINITY });

    await expect(stepWith(fake, -1).apply?.(ctx)).rejects.toThrow(/not ready/);
  });

  it('stops the process it started when it is not ready in time', async () => {
    const fake = fakeSystem({ readyAfter: Number.POSITIVE_INFINITY });

    await expect(stepWith(fake, -1).apply?.(ctx)).rejects.toThrow(/not ready/);
    expect(fake.signals).toEqual([[100, false]]);
    expect(fake.alive.size).toBe(0);
    await expect(readFile(join(dir, 'dev-server.json'))).rejects.toThrow();
  });

  it('keeps the pid file when the late process cannot be stopped', async () => {
    const fake = fakeSystem({
      readyAfter: Number.POSITIVE_INFINITY,
      unkillable: true,
    });

    await expect(stepWith(fake, -1).apply?.(ctx)).rejects.toThrow(/not ready/);
    expect(
      JSON.parse(await readFile(join(dir, 'dev-server.json'), 'utf8')),
    ).toMatchObject({ pid: 100 });
  });

  it('reports a live but unanswering process as failed with where its output is', async () => {
    const fake = fakeSystem({ readyAfter: Number.POSITIVE_INFINITY });

    fake.alive.set(7, 'node /usr/bin/pnpm dev');
    await writeFile(
      join(dir, 'dev-server.json'),
      JSON.stringify({ pid: 7, ...spec }),
    );

    expect(await stepWith(fake).check(ctx)).toMatchObject({
      state: 'failed',
      fix: expect.stringContaining('dev-server.log'),
    });
  });

  it('stops only its own process: matching command line, by pid', async () => {
    const fake = fakeSystem();
    const step = stepWith(fake);

    await step.apply?.(ctx);
    await step.stop?.(ctx);

    expect(fake.signals).toEqual([[100, false]]);
    expect((await step.check(ctx)).state).toBe('todo');
  });

  it('never signals a reused pid running something else; drops the stale file', async () => {
    const fake = fakeSystem({ readyAfter: Number.POSITIVE_INFINITY });

    fake.alive.set(7, '/usr/bin/postgres -D data');
    await writeFile(
      join(dir, 'dev-server.json'),
      JSON.stringify({ pid: 7, ...spec }),
    );

    const step = stepWith(fake);

    expect((await step.check(ctx)).state).toBe('todo');

    await step.stop?.(ctx);

    expect(fake.signals).toEqual([]);
    expect(fake.alive.has(7)).toBe(true);
    await expect(readFile(join(dir, 'dev-server.json'))).rejects.toThrow();
  });

  it('never takes a reused pid with the same command line but another start time for its own', async () => {
    const fake = fakeSystem({ readyAfter: Number.POSITIVE_INFINITY });

    fake.alive.set(7, 'node /usr/bin/pnpm dev');
    fake.started.set(7, 'later');
    await writeFile(
      join(dir, 'dev-server.json'),
      JSON.stringify({ pid: 7, ...spec, started: 'earlier' }),
    );

    const step = stepWith(fake);

    expect((await step.check(ctx)).state).toBe('todo');
    await step.stop?.(ctx);
    expect(fake.signals).toEqual([]);
  });

  it('fails when something else already answers where it would run', async () => {
    const fake = fakeSystem();

    fake.alive.set(9, 'node someone-elses-vite');

    expect(await stepWith(fake).check(ctx)).toMatchObject({
      state: 'failed',
      message: expect.stringContaining('another copy'),
    });
  });

  it('never trusts a probe answering for another copy while its own process died', async () => {
    const fake = fakeSystem({ dies: true });

    fake.alive.set(9, 'node someone-elses-vite');

    await expect(stepWith(fake).apply?.(ctx)).rejects.toThrow(/stopped before/);
  });

  it('stops the children left when the leader already exited', async () => {
    const fake = fakeSystem();

    fake.orphans.add(7);
    await writeFile(
      join(dir, 'dev-server.json'),
      JSON.stringify({ pid: 7, ...spec, started: 't7' }),
    );

    await stepWith(fake).stop?.(ctx);

    expect(fake.signals).toEqual([[7, false]]);
    expect(fake.orphans.has(7)).toBe(false);
  });

  it('never signals a group left from an earlier boot of the computer (pid reused)', async () => {
    const fake = fakeSystem();
    const system = { ...fake.system, boot: () => 'boot-2' };
    const step = defineProcessStep<null>({
      id: 'dev-server',
      title: 'Start the app',
      spec: () => spec,
      healthy: fake.healthy,
      processes: () => system,
    });

    // a stale file from before a restart; its pid now leads another group
    fake.orphans.add(7);
    await writeFile(
      join(dir, 'dev-server.json'),
      JSON.stringify({ pid: 7, ...spec, started: 't7', boot: 'boot-1' }),
    );

    expect((await step.check(ctx)).state).toBe('todo');
    await step.stop?.(ctx);
    expect(fake.signals).toEqual([]);
  });

  it('escalates to SIGKILL and fails, keeping the pid file, when it will not die', async () => {
    const fake = fakeSystem({ unkillable: true });
    const step = stepWith(fake);

    await step.apply?.(ctx);
    await expect(step.stop?.(ctx)).rejects.toThrow(/still running/);

    expect(fake.signals).toEqual([
      [100, false],
      [100, true],
    ]);
    expect((await step.check(ctx)).state).toBe('done');
  });

  it('stops waiting when the run is cancelled', async () => {
    const fake = fakeSystem({ readyAfter: Number.POSITIVE_INFINITY });
    const cancel = new AbortController();

    cancel.abort();

    await expect(
      stepWith(fake).apply?.({ deps: null, signal: cancel.signal }),
    ).rejects.toThrow();
  });
});

describe('createSystemProcesses', () => {
  it('starts a real detached process, recognises it, and stops it', async () => {
    const system = createSystemProcesses(dir);
    const step = defineProcessStep<null>({
      id: 'sleeper',
      title: 'Sleeper',
      spec: () => ({
        command: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)'],
        cwd: dir,
      }),
      healthy: async () => true,
      processes: () => system,
    });

    await step.apply?.(ctx);

    const { pid } = JSON.parse(
      await readFile(join(dir, 'sleeper.json'), 'utf8'),
    );

    expect(system.isAlive(pid)).toBe(true);
    expect((await step.check(ctx)).state).toBe('done');

    await step.stop?.(ctx);

    expect(system.isAlive(pid)).toBe(false);
  });
});

describe('process steps ready by a log line', () => {
  it("reads only this start's output: an earlier run's Ready doesn't count", async () => {
    const fake = fakeSystem();
    const log = join(dir, 'listen.log');
    const step = defineProcessStep<null>({
      id: 'listen',
      title: 'Forward events',
      spec: () => spec,
      readyLine: /Ready!/,
      processes: () => ({
        ...fake.system,
        // the new process says Ready a moment after it starts
        start: async (started, out) => {
          const pid = await fake.system.start(started, out);

          setTimeout(
            () => void writeFile(log, 'old\nReady!\nnew\nReady!\n'),
            5,
          );

          return pid;
        },
        wait: () => new Promise((resolve) => setTimeout(resolve, 10)),
      }),
      readyWithinMs: 2_000,
    });
    const ctx = { deps: null, signal: idle };

    await writeFile(log, 'old\nReady!\n');

    // nothing of ours runs: an old Ready is not someone else answering
    expect((await step.check(ctx)).state).toBe('todo');

    await step.apply?.(ctx);

    expect((await step.check(ctx)).state).toBe('done');
  });
});
