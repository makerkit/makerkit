import { afterEach, describe, expect, it } from 'vitest';

import { createFileLocks } from '../locks';

import { writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir = '';

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function locksFor(pid: number, alive: number[]) {
  dir ||= await mkdtemp(join(tmpdir(), 'kit-locks-'));

  return createFileLocks({
    dir,
    pid,
    startedOf: (other) =>
      other === pid || alive.includes(other) ? `t${other}` : null,
    isAlive: (other) => other === pid || alive.includes(other),
  });
}

const ownerOf = async (key: string) =>
  JSON.parse(await readFile(join(dir, `${key}.lock`), 'utf8'));

describe('createFileLocks', () => {
  it('writes the owner PID and frees the lock on release', async () => {
    dir = await mkdtemp(join(tmpdir(), 'kit-locks-'));

    const lock = await (
      await locksFor(100, [])
    ).acquire({ key: 'setup', conflicts: [] });

    expect(lock.ok).toBe(true);
    expect(await ownerOf('setup')).toMatchObject({ pid: 100, started: 't100' });

    if (lock.ok) {
      await lock.release();
    }

    await expect(readFile(join(dir, 'setup.lock'), 'utf8')).rejects.toThrow();
  });

  it('refuses a key or a conflicting key held by a live process', async () => {
    dir = await mkdtemp(join(tmpdir(), 'kit-locks-'));
    await (await locksFor(100, [])).acquire({ key: 'setup', conflicts: [] });

    const other = await locksFor(200, [100]);

    expect(await other.acquire({ key: 'setup', conflicts: [] })).toEqual({
      ok: false,
      holder: { key: 'setup', pid: 100 },
    });
    expect(
      await other.acquire({ key: 'setup.seed', conflicts: ['setup'] }),
    ).toEqual({ ok: false, holder: { key: 'setup', pid: 100 } });
  });

  it('lets one of two overlapping runs in, never both (one MCP server)', async () => {
    dir = await mkdtemp(join(tmpdir(), 'kit-locks-'));

    const locks = await locksFor(100, []);

    for (let round = 0; round < 30; round++) {
      const both = await Promise.all([
        locks.acquire({ key: 'billing', conflicts: [] }),
        locks.acquire({ key: 'billing', conflicts: [] }),
      ]);

      expect(both.filter((lock) => lock.ok)).toHaveLength(1);

      for (const lock of both) {
        if (lock.ok) {
          await lock.release();
        }
      }
    }
  });

  it('takes over a lock whose process is gone', async () => {
    dir = await mkdtemp(join(tmpdir(), 'kit-locks-'));
    await (await locksFor(100, [])).acquire({ key: 'setup', conflicts: [] });

    const lock = await (
      await locksFor(200, [])
    ).acquire({ key: 'setup', conflicts: [] });

    expect(lock.ok).toBe(true);
    expect(await ownerOf('setup')).toMatchObject({ pid: 200, started: 't200' });
  });

  it('takes over a lock whose pid was reused by another process', async () => {
    dir = await mkdtemp(join(tmpdir(), 'kit-locks-'));
    await writeFile(
      join(dir, 'setup.lock'),
      JSON.stringify({ pid: 100, started: 't-before-reboot' }),
    );

    const lock = await (
      await locksFor(200, [100])
    ).acquire({ key: 'setup', conflicts: [] });

    expect(lock.ok).toBe(true);
  });

  it('refuses a second run in the same process (MCP calls overlap) until the first releases', async () => {
    dir = await mkdtemp(join(tmpdir(), 'kit-locks-'));

    const locks = await locksFor(100, [100]);
    const first = await locks.acquire({ key: 'setup', conflicts: [] });
    const step = await locks.acquire({
      key: 'setup.dev-server',
      conflicts: ['setup'],
    });

    expect(first.ok).toBe(true);
    expect(step).toEqual({
      ok: false,
      holder: { key: 'setup', pid: 100 },
    });

    if (first.ok) {
      await first.release();
    }

    expect(
      (await locks.acquire({ key: 'setup.dev-server', conflicts: ['setup'] }))
        .ok,
    ).toBe(true);
  });

  it('takes over an old-format or garbled lock file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'kit-locks-'));
    await writeFile(join(dir, 'setup.lock'), '100 t100');
    await writeFile(join(dir, 'billing.lock'), '{not json');

    const locks = await locksFor(200, [100]);

    expect((await locks.acquire({ key: 'setup', conflicts: [] })).ok).toBe(
      true,
    );
    expect((await locks.acquire({ key: 'billing', conflicts: [] })).ok).toBe(
      true,
    );
  });

  it('holds a lock whose start time has spaces (macOS ps lstart)', async () => {
    dir = await mkdtemp(join(tmpdir(), 'kit-locks-'));

    const startedOf = (pid: number) =>
      [100, 200].includes(pid) ? `Wed Nov 18 12:31:37 2026 #${pid}` : null;
    const first = createFileLocks({ dir, pid: 100, startedOf });
    const second = createFileLocks({ dir, pid: 200, startedOf });

    expect((await first.acquire({ key: 'setup', conflicts: [] })).ok).toBe(
      true,
    );
    expect(await second.acquire({ key: 'setup', conflicts: [] })).toEqual({
      ok: false,
      holder: { key: 'setup', pid: 100 },
    });
  });

  it('falls back to liveness when no start time can be read (Windows)', async () => {
    dir = await mkdtemp(join(tmpdir(), 'kit-locks-'));

    const alive = new Set([100, 200]);
    const locksAs = (pid: number) =>
      createFileLocks({
        dir,
        pid,
        startedOf: () => null,
        isAlive: (other) => alive.has(other),
      });

    expect(
      (await locksAs(100).acquire({ key: 'setup', conflicts: [] })).ok,
    ).toBe(true);
    expect(await locksAs(200).acquire({ key: 'setup', conflicts: [] })).toEqual(
      { ok: false, holder: { key: 'setup', pid: 100 } },
    );

    alive.delete(100);

    expect(
      (await locksAs(200).acquire({ key: 'setup', conflicts: [] })).ok,
    ).toBe(true);
  });

  it('never deletes a fresh lock that replaced the stale one it saw', async () => {
    dir = await mkdtemp(join(tmpdir(), 'kit-locks-'));
    await writeFile(
      join(dir, 'setup.lock'),
      JSON.stringify({ pid: 100, started: 't100' }),
    );

    const fresh = JSON.stringify({ pid: 300, started: 't300' });
    let looks = 0;
    // pid 100 is gone; while 200 decides it's stale, 300 takes the lock over
    const locks = createFileLocks({
      dir,
      pid: 200,
      startedOf: (pid) => {
        if (pid === 100 && ++looks === 2) {
          writeFileSync(join(dir, 'setup.lock'), fresh);
        }

        return pid === 200 || pid === 300 ? `t${pid}` : null;
      },
      isAlive: (pid) => pid === 200 || pid === 300,
    });

    expect(await locks.acquire({ key: 'setup', conflicts: [] })).toEqual({
      ok: false,
      holder: { key: 'setup', pid: 300 },
    });
    expect(await readFile(join(dir, 'setup.lock'), 'utf8')).toBe(fresh);
  });

  it('releases only a lock it still owns', async () => {
    dir = await mkdtemp(join(tmpdir(), 'kit-locks-'));

    const lock = await (
      await locksFor(100, [])
    ).acquire({ key: 'setup', conflicts: [] });
    const other = JSON.stringify({ pid: 300, started: 't300' });

    await writeFile(join(dir, 'setup.lock'), other);

    if (lock.ok) {
      await lock.release();
    }

    expect(await readFile(join(dir, 'setup.lock'), 'utf8')).toBe(other);
  });
});
