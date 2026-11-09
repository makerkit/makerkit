import { inspectProcess } from './process';
import type { Locks } from './types';

import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type LockDeps = {
  // .makerkit/locks under the project root (survives a reinstall)
  dir: string;
  pid?: number;
  // a live process's start time, null when it's gone (tells a reused pid apart)
  startedOf?: (pid: number) => string | null;
};

/**
 * One file per lock naming its owner: pid and start time. The owner still
 * running (this process too: the MCP server runs overlapping calls) holds
 * it; a gone owner, or a reused pid, frees it.
 */
export function createFileLocks({
  dir,
  pid = process.pid,
  startedOf = (other) => inspectProcess(other)?.started ?? null,
}: LockDeps): Locks {
  const fileOf = (key: string) => join(dir, `${key}.lock`);
  const owner = `${pid} ${startedOf(pid) ?? ''}`;

  // the owner's pid while it still runs, else null
  const holderOf = async (key: string) => {
    const text = await readFile(fileOf(key), 'utf8').catch(() => '');
    const [held = '', started = ''] = text.split(' ');
    const heldBy = Number(held);
    const now = heldBy > 0 ? startedOf(heldBy) : null;

    return now !== null && (!started || now === started) ? heldBy : null;
  };

  // exclusive and whole: the owner is written first, then linked in place
  // (a link fails when the lock exists), so nobody reads a half-made lock
  const create = async (key: string) => {
    const temp = join(
      dir,
      `.${key}.${pid}.${Math.random().toString(36).slice(2)}`,
    );

    await writeFile(temp, owner);

    try {
      await link(temp, fileOf(key));

      return true;
    } catch {
      return false;
    } finally {
      await unlink(temp).catch(() => undefined);
    }
  };

  return {
    async acquire({ key, conflicts }) {
      await mkdir(dir, { recursive: true });

      for (const other of [key, ...conflicts]) {
        const holder = await holderOf(other);

        if (holder) {
          return { ok: false, holder: { key: other, pid: holder } };
        }
      }

      // a file whose owner is gone first goes; a live one wins the race
      if (!(await create(key))) {
        const holder = await holderOf(key);

        if (holder) {
          return { ok: false, holder: { key, pid: holder } };
        }

        await unlink(fileOf(key)).catch(() => undefined);

        if (!(await create(key))) {
          return {
            ok: false,
            holder: { key, pid: (await holderOf(key)) ?? pid },
          };
        }
      }

      // a conflicting run that took its lock while this one was checking
      for (const other of conflicts) {
        const holder = await holderOf(other);

        if (holder) {
          await unlink(fileOf(key)).catch(() => undefined);

          return { ok: false, holder: { key: other, pid: holder } };
        }
      }

      return {
        ok: true,
        release: () => unlink(fileOf(key)).catch(() => undefined),
      };
    },
  };
}

// for runs that never write (check, plan): they never take a lock
export const NO_LOCKS: Locks = {
  acquire: async () => ({ ok: true, release: async () => undefined }),
};
