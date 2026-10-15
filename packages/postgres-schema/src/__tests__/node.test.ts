import { afterEach, describe, expect, it } from 'vitest';

import { type DatabaseDeps, createDatabaseService } from '../database.service';
import { createPostgresSchemaDeps, probeTarget } from '../node';

// Set to a database that has the repo's test schema (supabase/migrations),
// e.g. the local Supabase started with `pnpm supabase:start`.
const DATABASE_URL = process.env['TEST_DATABASE_URL'];

const opened: DatabaseDeps[] = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((deps) => deps.close?.()));
});

function open(databaseUrl: string) {
  const deps = createPostgresSchemaDeps(process.cwd(), { databaseUrl });
  opened.push(deps);

  return createDatabaseService(deps);
}

describe('createPostgresSchemaDeps', () => {
  it('fails fast when the database is not running', async () => {
    const service = open('postgresql://postgres:postgres@127.0.0.1:1/postgres');
    const startedAt = Date.now();

    const { tables } = await service.getTables();

    expect(tables).toEqual([]);
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });
});

describe('probeTarget', () => {
  it('reads host and port from postgres:// and postgresql:// URLs', () => {
    expect(probeTarget('postgresql://u:p@db.example.com:6543/app')).toEqual({
      host: 'db.example.com',
      port: 6543,
    });
    expect(probeTarget('postgres://u:p@localhost/app')).toEqual({
      host: 'localhost',
      port: 5432,
    });
  });

  it('strips the brackets from IPv6 hosts', () => {
    expect(probeTarget('postgresql://u:p@[::1]:54322/postgres')).toEqual({
      host: '::1',
      port: 54322,
    });
  });

  it('skips the probe when postgres.js resolves the host itself', () => {
    // Unix socket, host left to PGHOST, several hosts, unparseable URL.
    expect(
      probeTarget('postgresql://u@%2Fvar%2Frun%2Fpostgresql/app'),
    ).toBeNull();
    expect(probeTarget('postgresql:///app')).toBeNull();
    expect(probeTarget('postgresql://u:p@h1:5432,h2:5432/app')).toBeNull();
    expect(probeTarget('not a url')).toBeNull();
  });

  it('keeps encoded special characters in the password out of the host', () => {
    expect(
      probeTarget('postgresql://u:p%40ss%23word@127.0.0.1:5432/app'),
    ).toEqual({ host: '127.0.0.1', port: 5432 });
  });
});

describe.skipIf(!DATABASE_URL)('against a live database', () => {
  it('lists tables and describes columns and foreign keys', async () => {
    const service = open(DATABASE_URL!);

    const { tables } = await service.getTables();
    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining(['tasks', 'users']),
    );

    const tasks = await service.getTableInfo({
      schema: 'public',
      tableName: 'tasks',
    });

    expect(tasks.source).toBe('database');
    expect(tasks.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['id', 'user_id', 'name', 'done']),
    );
    expect(tasks.foreignKeys).toEqual([
      expect.objectContaining({
        columns: ['user_id'],
        referencedTable: 'users',
      }),
    ]);
  });
});
