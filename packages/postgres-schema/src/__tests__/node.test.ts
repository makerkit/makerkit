import { afterEach, describe, expect, it } from 'vitest';

import { type DatabaseDeps, createDatabaseService } from '../database.service';
import { createPostgresSchemaDeps } from '../node';

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
