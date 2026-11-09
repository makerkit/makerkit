import { afterEach, describe, expect, it } from 'vitest';

import { createFileLocks } from '../locks';

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
  });
}

describe('createFileLocks', () => {
  it('writes the owner PID and frees the lock on release', async () => {
    dir = await mkdtemp(join(tmpdir(), 'kit-locks-'));

    const lock = await (
      await locksFor(100, [])
    ).acquire({ key: 'setup', conflicts: [] });

    expect(lock.ok).toBe(true);
    expect(await readFile(join(dir, 'setup.lock'), 'utf8')).toBe('100 t100');

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
    expect(await readFile(join(dir, 'setup.lock'), 'utf8')).toBe('200 t200');
  });

  it('takes over a lock whose pid was reused by another process', async () => {
    dir = await mkdtemp(join(tmpdir(), 'kit-locks-'));
    await writeFile(join(dir, 'setup.lock'), '100 t-before-reboot');

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
});
