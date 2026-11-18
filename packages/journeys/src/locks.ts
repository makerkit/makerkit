import { inspectProcess, isProcessAlive } from './process';
import type { Locks } from './types';

import { randomUUID } from 'node:crypto';
import {
  link,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

export type FileLocksOptions = {
  // .makerkit/locks under the project root (survives a reinstall)
  dir: string;
  pid?: number;
  // a live process's start time, null when it's gone or can't be read (tells
  // a reused pid apart)
  startedOf?: (pid: number) => string | null;
  // whether a pid runs: used when no start time can be read (Windows)
  isAlive?: (pid: number) => boolean;
};

type Owner = { pid: number; started: string | null; token: string };

// tries at create-or-take-over before giving up (other runs keep racing in)
const ATTEMPTS = 3;

/**
 * One file per lock naming its owner (JSON: pid, start time, a token per
 * acquisition). The owner still running (this process too: the MCP server
 * runs overlapping calls) holds it; a gone owner, a reused pid or a file
 * that doesn't parse frees it. Without a start time, a live pid holds it.
 */
export function createFileLocks({
  dir,
  pid = process.pid,
  startedOf = (other) => inspectProcess(other)?.started ?? null,
  isAlive = isProcessAlive,
}: FileLocksOptions): Locks {
  const fileOf = (key: string) => join(dir, `${key}.lock`);
  const tempOf = (key: string) => join(dir, `.${key}.${pid}.${randomUUID()}`);
  const started = startedOf(pid);

  const holds = ({ pid: held, started: then }: Owner) => {
    const now = startedOf(held);

    if (now === null || then === null) {
      return isAlive(held);
    }

    return now === then;
  };

  // the file's text and, while its owner still runs, the owner's pid
  const read = async (key: string) => {
    const text = await readFile(fileOf(key), 'utf8').catch(() => '');
    const owner = ownerOf(text);

    if (owner && holds(owner)) {
      return { text, holder: owner.pid };
    }

    return { text, holder: null };
  };

  // exclusive and whole: the owner is written first, then linked in place
  // (a link fails when the lock exists), so nobody reads a half-made lock
  const create = async (key: string, owner: string) => {
    const temp = tempOf(key);

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

  // moved aside first (atomic), so only the stale file seen goes: one that
  // replaced it meanwhile is put back
  const takeOver = async (key: string, stale: string) => {
    const aside = tempOf(key);

    try {
      await rename(fileOf(key), aside);
    } catch {
      return;
    }

    const moved = await readFile(aside, 'utf8').catch(() => stale);

    if (moved !== stale) {
      await link(aside, fileOf(key)).catch(() => undefined);
    }

    await unlink(aside).catch(() => undefined);
  };

  // deletes the lock only while it's still this acquisition's
  const release = async (key: string, owner: string) => {
    const text = await readFile(fileOf(key), 'utf8').catch(() => '');

    if (text === owner) {
      await unlink(fileOf(key)).catch(() => undefined);
    }
  };

  return {
    async acquire({ key, conflicts }) {
      await mkdir(dir, { recursive: true });

      for (const other of [key, ...conflicts]) {
        const { holder } = await read(other);

        if (holder) {
          return { ok: false, holder: { key: other, pid: holder } };
        }
      }

      const owner = JSON.stringify({ pid, started, token: randomUUID() });
      let created = false;

      for (let attempt = 0; attempt < ATTEMPTS && !created; attempt++) {
        created = await create(key, owner);

        if (!created) {
          const { text, holder } = await read(key);

          if (holder) {
            return { ok: false, holder: { key, pid: holder } };
          }

          await takeOver(key, text);
        }
      }

      if (!created) {
        const { holder } = await read(key);

        return { ok: false, holder: { key, pid: holder ?? pid } };
      }

      // a conflicting run that took its lock while this one was checking
      for (const other of conflicts) {
        const { holder } = await read(other);

        if (holder) {
          await release(key, owner);

          return { ok: false, holder: { key: other, pid: holder } };
        }
      }

      return { ok: true, release: () => release(key, owner) };
    },
  };
}

function ownerOf(text: string): Owner | null {
  try {
    const owner = JSON.parse(text) as Partial<Owner>;
    const valid =
      Number.isInteger(owner.pid) &&
      owner.pid! > 0 &&
      (typeof owner.started === 'string' || owner.started === null);

    return valid ? (owner as Owner) : null;
  } catch {
    return null;
  }
}
