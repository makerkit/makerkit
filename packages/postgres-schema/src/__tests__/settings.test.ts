import { describe, expect, it } from 'vitest';

import {
  type DatabaseDeps,
  type PostgresSchemaSettings,
  createDatabaseService,
} from '../database.service';
import { registerPostgresSchemaTools } from '../mcp';
import { createFakeMcpServer } from '../testing/fake-mcp-server';

type Row = Record<string, unknown>;

/** A fake database that answers by query type and records the parameters. */
function createDeps(
  settings: PostgresSchemaSettings | undefined,
  tables: Row[] = [],
  columns: Row[] = [],
) {
  const calls: Array<{ text: string; params: unknown[] }> = [];

  const deps: DatabaseDeps = {
    rootPath: '/repo',
    settings,
    async readdir() {
      return [];
    },
    async readFile() {
      throw new Error('ENOENT');
    },
    async stat() {
      return { mtime: new Date('2026-01-01T00:00:00Z') };
    },
    async query(text, params = []) {
      calls.push({ text, params });

      if (text.includes('information_schema.tables')) return tables;
      if (text.includes('information_schema.columns')) return columns;

      return [];
    },
  };

  return { deps, calls };
}

const PRISMA_TABLES = [
  { table_name: 'User', table_schema: 'public' },
  { table_name: '_prisma_migrations', table_schema: 'public' },
];

const USER_COLUMNS = [
  {
    column_name: 'id',
    data_type: 'text',
    is_nullable: 'NO',
    column_default: null,
    is_primary_key: true,
    is_foreign_key: false,
    referenced_table: null,
    referenced_column: null,
  },
];

describe('settings', () => {
  it('passes the configured schemas to the queries', async () => {
    const { deps, calls } = createDeps({ includeSchemas: ['public', 'app'] });

    await createDatabaseService(deps).getTables();

    expect(calls[0]?.params).toEqual([['public', 'app']]);
  });

  it('defaults to the public schema', async () => {
    const { deps, calls } = createDeps(undefined);

    await createDatabaseService(deps).getTables();

    expect(calls[0]?.params).toEqual([['public']]);
  });

  it('leaves excluded tables out of listings', async () => {
    const { deps } = createDeps(
      { excludeTables: ['_prisma_migrations'] },
      PRISMA_TABLES,
    );

    const { tables } = await createDatabaseService(deps).getTables();

    expect(tables.map((table) => table.name)).toEqual(['User']);
  });
});

describe('getTableInfo without schema files', () => {
  it('describes a table that exists only in the live database', async () => {
    const { deps } = createDeps(undefined, PRISMA_TABLES, USER_COLUMNS);

    const info = await createDatabaseService(deps).getTableInfo({
      schema: 'public',
      tableName: 'User',
    });

    expect(info).toMatchObject({
      name: 'User',
      schema: 'public',
      source: 'database',
      sourceFile: 'database',
      columns: [expect.objectContaining({ name: 'id' })],
    });
  });

  it('accepts schema.table in the table name', async () => {
    const { deps, calls } = createDeps(undefined, [], USER_COLUMNS);

    const info = await createDatabaseService(deps).getTableInfo({
      schema: 'public',
      tableName: 'billing.invoices',
    });

    expect(info).toMatchObject({ schema: 'billing', name: 'invoices' });
    expect(
      calls.find((call) => call.text.includes('information_schema.columns'))
        ?.params,
    ).toEqual(['billing', 'invoices']);
  });

  it('says the table was not found without mentioning schema files', async () => {
    const { deps } = createDeps(undefined);

    await expect(
      createDatabaseService(deps).getTableInfo({
        schema: 'public',
        tableName: 'nope',
      }),
    ).rejects.toThrow(/^Table public\.nope not found$/);
  });
});

describe('registerPostgresSchemaTools', () => {
  it('registers only the live-database tools without schema files', () => {
    const fake = createFakeMcpServer();
    const { deps } = createDeps(undefined);

    registerPostgresSchemaTools(fake.server, createDatabaseService(deps));

    expect(fake.tools.map((tool) => tool.name).sort()).toEqual([
      'get_all_enums',
      'get_database_functions',
      'get_database_summary',
      'get_database_tables',
      'get_enum_info',
      'get_function_details',
      'get_table_info',
      'search_database_functions',
    ]);
  });

  it('adds the schema-file tools when schema files are configured, with a prefix', () => {
    const fake = createFakeMcpServer();
    const { deps } = createDeps({ schemaFiles: { dir: 'supabase/schemas' } });

    registerPostgresSchemaTools(fake.server, createDatabaseService(deps), {
      prefix: 'db_',
    });

    expect(fake.tools).toHaveLength(12);
    expect(fake.tools.map((tool) => tool.name)).toContain(
      'db_get_schema_files',
    );
  });
});
