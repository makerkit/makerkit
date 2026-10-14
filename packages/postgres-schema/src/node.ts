import postgres from 'postgres';

import type { DatabaseDeps, PostgresSchemaSettings } from './database.service';

import { readFile, readdir, stat } from 'node:fs/promises';
import { Socket } from 'node:net';

export interface PostgresSchemaNodeOptions {
  /** Connection string. Defaults to the DATABASE_URL environment variable. */
  databaseUrl?: string;
  settings?: PostgresSchemaSettings;
}

/**
 * Filesystem and database dependencies for a project at `rootPath`. The
 * database client is created on first use, and every query first checks the
 * port, so a stopped database fails in milliseconds instead of waiting for
 * reconnect attempts. Call `close()` when done to release the connection.
 */
export function createPostgresSchemaDeps(
  rootPath = process.cwd(),
  options: PostgresSchemaNodeOptions = {},
): DatabaseDeps {
  let client: ReturnType<typeof postgres> | null = null;

  const resolveTarget = () => {
    const url = options.databaseUrl ?? process.env['DATABASE_URL'];

    if (!url) {
      throw new Error(
        'No database URL. Set DATABASE_URL or pass databaseUrl to createPostgresSchemaDeps.',
      );
    }

    const parsed = new URL(url);

    return {
      url,
      host: parsed.hostname || '127.0.0.1',
      port: Number(parsed.port) || 5432,
    };
  };

  return {
    rootPath,
    settings: options.settings,
    readdir(path) {
      return readdir(path);
    },
    readFile(path) {
      return readFile(path, 'utf8');
    },
    async stat(path) {
      const result = await stat(path);
      return { mtime: result.mtime };
    },
    async query(text, params = []) {
      const { url, host, port } = resolveTarget();

      if (!(await isPortOpen(host, port))) {
        throw new Error(`Database is not reachable at ${host}:${port}`);
      }

      client ??= postgres(url, {
        prepare: false,
        max: 3,
        idle_timeout: 30,
        connect_timeout: 5,
      });

      const rows = await client.unsafe(text, params as never[]);

      return [...rows] as Record<string, unknown>[];
    },
    async close() {
      const current = client;
      client = null;

      await current?.end({ timeout: 5 });
    },
  };
}

function isPortOpen(host: string, port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = new Socket();

    const finish = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };

    socket.setTimeout(300);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}
