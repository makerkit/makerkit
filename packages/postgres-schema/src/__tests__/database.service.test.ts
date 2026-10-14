import { describe, expect, it } from 'vitest';

import { type DatabaseDeps, createDatabaseService } from '../database.service';

const normalize = (path: string) => path.replace(/\\/g, '/');

const ACCOUNTS_SQL = `
/*
 * Section: Accounts
 * We create the accounts table
 */
create table if not exists public.accounts (
  id uuid primary key,
  name varchar(255) not null
);

create index ix_accounts_name on public.accounts(name);

-- Check whether the user has a role on the account
create or replace function public.has_role_on_account(account_id uuid)
returns boolean
language sql
security definer
as $$ select true; $$;
`;

const NOTES_SQL = `
/*
 * Section: Notes
 * We create the notes table
 */
create type public.note_visibility as enum ('private', 'shared');

create table if not exists public.notes (
  id uuid primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  title text not null
);
`;

type QueryFn = DatabaseDeps['query'];

function createDeps(
  files: Record<string, string> = {
    '03-accounts.sql': ACCOUNTS_SQL,
    '20-notes.sql': NOTES_SQL,
  },
  query: QueryFn = async () => {
    throw new Error('database unreachable');
  },
): DatabaseDeps {
  return {
    rootPath: '/repo',
    settings: {
      includeSchemas: ['public', 'kit'],
      functionPurposes: {
        has_role_on_account: 'Check if user has access to a specific account',
      },
      schemaFiles: {
        dir: 'apps/web/supabase/schemas',
        topicMap: { '03-accounts.sql': 'accounts' },
      },
    },
    async readdir() {
      return Object.keys(files);
    },
    async readFile(path) {
      const name = normalize(path).split('/').pop() ?? '';
      const content = files[name];

      if (content === undefined) throw new Error('ENOENT');

      return content;
    },
    async stat() {
      return { mtime: new Date('2026-01-01T00:00:00Z') };
    },
    query,
  };
}

describe('DatabaseService schema files', () => {
  it('lists schema files with parsed metadata', async () => {
    const service = createDatabaseService(createDeps());
    const result = await service.listSchemaFiles();

    expect(result.total).toBe(2);
    expect(normalize(result.schemas_dir)).toBe(
      '/repo/apps/web/supabase/schemas',
    );
    expect(result.files[0]).toMatchObject({
      name: '03-accounts.sql',
      section: 'Accounts',
      topic: 'accounts',
      tables: ['accounts'],
      functions: ['has_role_on_account'],
      lastModified: '2026-01-01T00:00:00.000Z',
    });
    expect(result.files[1]?.dependencies).toEqual(['accounts']);
  });

  it('reads a schema file and rejects traversal', async () => {
    const service = createDatabaseService(createDeps());

    const result = await service.getSchemaContent({ fileName: '20-notes.sql' });
    expect(result.content).toContain('create table');

    await expect(
      service.getSchemaContent({ fileName: '../.env' }),
    ).rejects.toThrow(/Invalid schema file name/);
    await expect(
      service.getSchemaContent({ fileName: 'missing.sql' }),
    ).rejects.toThrow(/not found/);
  });

  it('finds files by topic and section', async () => {
    const service = createDatabaseService(createDeps());

    const byTopic = await service.getSchemasByTopic({ topic: 'accounts' });
    expect(byTopic.files.map((f) => f.name)).toEqual(['03-accounts.sql']);
    expect(byTopic.available_topics).toContain('billing');

    const bySection = await service.getSchemaBySection({ section: 'notes' });
    expect(bySection.file?.name).toBe('20-notes.sql');
    expect(bySection.available_sections).toEqual(['Accounts', 'Notes']);

    const missing = await service.getSchemaBySection({ section: 'nope' });
    expect(missing.file).toBeNull();
  });
});

describe('DatabaseService functions', () => {
  it('falls back to schema files when the database is unreachable', async () => {
    const service = createDatabaseService(createDeps());
    const result = await service.getFunctions();

    expect(result.source).toBe('schema_files');
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0]).toMatchObject({
      name: 'has_role_on_account',
      securityLevel: 'definer',
      sourceFile: '03-accounts.sql',
      purpose: 'Check if user has access to a specific account',
    });
  });

  it('uses live rows when available and maps to source files', async () => {
    const service = createDatabaseService(
      createDeps(undefined, async (text) => {
        if (text.includes('pg_proc')) {
          return [
            {
              function_name: 'has_role_on_account',
              schema_name: 'public',
              return_type: 'boolean',
              parameters: 'account_id uuid',
              is_definer: true,
              description: null,
            },
            {
              function_name: 'other_fn',
              schema_name: 'kit',
              return_type: 'void',
              parameters: '',
              is_definer: false,
              description: 'Does things',
            },
          ];
        }

        return [];
      }),
    );

    const result = await service.getFunctions();

    expect(result.source).toBe('database');
    expect(result.functions[0]).toMatchObject({
      name: 'has_role_on_account',
      sourceFile: '03-accounts.sql',
      securityLevel: 'definer',
      parameters: [{ name: 'account_id', type: 'uuid' }],
    });
    expect(result.functions[1]).toMatchObject({
      name: 'other_fn',
      schema: 'kit',
      sourceFile: 'unknown',
      securityLevel: 'invoker',
    });
  });

  it('resolves details by plain or schema-qualified name', async () => {
    const service = createDatabaseService(createDeps());

    expect(
      (
        await service.getFunctionDetails({
          functionName: 'has_role_on_account',
        })
      ).schema,
    ).toBe('public');
    expect(
      (
        await service.getFunctionDetails({
          functionName: 'public.has_role_on_account',
        })
      ).name,
    ).toBe('has_role_on_account');

    await expect(
      service.getFunctionDetails({ functionName: 'kit.has_role_on_account' }),
    ).rejects.toThrow(/not found/);
  });

  it('searches by name, purpose and schema prefix', async () => {
    const service = createDatabaseService(createDeps());

    expect((await service.searchFunctions({ query: 'role' })).total).toBe(1);
    expect((await service.searchFunctions({ query: 'access' })).total).toBe(1);
    expect((await service.searchFunctions({ query: 'kit.role' })).total).toBe(
      0,
    );
  });
});

describe('DatabaseService tables', () => {
  it('lists tables from schema files when offline', async () => {
    const service = createDatabaseService(createDeps());
    const result = await service.getTables();

    expect(result.tables).toEqual([
      {
        name: 'accounts',
        schema: 'public',
        sourceFile: '03-accounts.sql',
        topic: 'accounts',
      },
      {
        name: 'notes',
        schema: 'public',
        sourceFile: '20-notes.sql',
        topic: 'general',
      },
    ]);
  });

  it('describes a table from schema files when offline', async () => {
    const service = createDatabaseService(createDeps());
    const info = await service.getTableInfo({
      schema: 'public',
      tableName: 'notes',
    });

    expect(info.source).toBe('schema_files');
    expect(info.sourceFile).toBe('20-notes.sql');
    expect(info.columns.map((c) => c.name)).toEqual([
      'id',
      'account_id',
      'title',
    ]);
    expect(info.columns[1]?.referencedTable).toBe('accounts');
    expect(info.createStatement).toMatch(
      /create table if not exists public\.notes/,
    );
  });

  it('prefers live column data when the database responds', async () => {
    const service = createDatabaseService(
      createDeps(undefined, async (text, params) => {
        if (text.includes('information_schema.columns')) {
          expect(params).toEqual(['public', 'accounts']);

          return [
            {
              column_name: 'id',
              data_type: 'uuid',
              is_nullable: 'NO',
              column_default: null,
              is_primary_key: true,
              is_foreign_key: false,
              referenced_table: null,
              referenced_column: null,
            },
          ];
        }

        return [];
      }),
    );

    const info = await service.getTableInfo({
      schema: 'public',
      tableName: 'accounts',
    });

    expect(info.source).toBe('database');
    expect(info.columns).toEqual([
      {
        name: 'id',
        type: 'uuid',
        nullable: false,
        defaultValue: undefined,
        isPrimaryKey: true,
        isForeignKey: false,
        referencedTable: undefined,
        referencedColumn: undefined,
      },
    ]);
    // Live query returned no rows for FKs/indexes: empty, not file-parsed.
    expect(info.indexes).toEqual([]);
  });

  it('throws for unknown tables', async () => {
    const service = createDatabaseService(createDeps());

    await expect(
      service.getTableInfo({ schema: 'public', tableName: 'nope' }),
    ).rejects.toThrow(/not found in the database or the schema files/);
  });
});

describe('DatabaseService enums and summary', () => {
  it('parses enums from every schema file when offline', async () => {
    const service = createDatabaseService(createDeps());

    const all = await service.listEnums();
    expect(all.enums).toEqual([
      {
        name: 'note_visibility',
        values: ['private', 'shared'],
        sourceFile: '20-notes.sql',
      },
    ]);

    await expect(service.getEnumInfo({ enumName: 'nope' })).rejects.toThrow(
      /Available enums: note_visibility/,
    );
  });

  it('builds a summary grouped by topic', async () => {
    const service = createDatabaseService(createDeps());
    const summary = await service.getSummary();

    expect(summary.overview).toEqual({
      totalTables: 2,
      totalEnums: 1,
      totalFunctions: 1,
    });
    expect(summary.tablesByTopic).toEqual({
      accounts: ['accounts'],
      general: ['notes'],
    });
  });
});
