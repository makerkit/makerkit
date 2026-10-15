import { describe, expect, it } from 'vitest';

import { type DatabaseDeps, createDatabaseService } from '../database.service';
import { registerPostgresSchemaTools } from '../mcp';
import { createFakeMcpServer } from '../testing/fake-mcp-server';

const SCHEMA_SQL = `
/*
 * Section: Notes
 * We create the notes table
 */
create type public.note_kind as enum ('a', 'b');
create table if not exists public.notes (
  id uuid primary key,
  title text not null
);
create or replace function public.count_notes() returns integer language sql as $$ select 1; $$;
`;

function createDeps(): DatabaseDeps {
  return {
    rootPath: '/repo',
    settings: {
      includeSchemas: ['public', 'kit'],
      schemaFiles: {
        dir: 'apps/web/supabase/schemas',
        topicMap: { '03-accounts.sql': 'accounts' },
      },
    },
    async readdir() {
      return ['20-notes.sql'];
    },
    async readFile() {
      return SCHEMA_SQL;
    },
    async stat() {
      return { mtime: new Date('2026-01-01T00:00:00Z') };
    },
    async query() {
      throw new Error('database unreachable');
    },
  };
}

describe('registerDatabaseTools', () => {
  const fake = createFakeMcpServer();
  registerPostgresSchemaTools(fake.server, createDatabaseService(createDeps()));

  it('registers every database tool as read-only with an output schema', () => {
    expect(fake.tools.map((tool) => tool.name).sort()).toEqual([
      'get_all_enums',
      'get_database_functions',
      'get_database_summary',
      'get_database_tables',
      'get_enum_info',
      'get_function_details',
      'get_schema_by_section',
      'get_schema_content',
      'get_schema_files',
      'get_schemas_by_topic',
      'get_table_info',
      'search_database_functions',
    ]);

    for (const tool of fake.tools) {
      expect(tool.config.annotations?.readOnlyHint).toBe(true);
      expect(tool.config.outputSchema).toBeDefined();
    }
  });

  it('returns structured content that satisfies each output schema', async () => {
    const files = await fake.call('get_schema_files');
    expect(files.structuredContent).toMatchObject({ total: 1 });

    await fake.call('get_schema_content', { fileName: '20-notes.sql' });
    await fake.call('get_schemas_by_topic', { topic: 'notes' });
    await fake.call('get_schema_by_section', { section: 'Notes' });
    await fake.call('get_database_functions');
    await fake.call('get_function_details', { functionName: 'count_notes' });
    await fake.call('search_database_functions', { query: 'count' });
    await fake.call('get_database_summary');
    await fake.call('get_database_tables');

    const table = await fake.call('get_table_info', { tableName: 'notes' });
    expect(table.structuredContent).toMatchObject({
      schema: 'public',
      source: 'schema_files',
    });

    await fake.call('get_enum_info', { enumName: 'note_kind' });
    await fake.call('get_all_enums');
  });

  it('maps service errors to isError responses', async () => {
    const result = await fake.call('get_schema_content', {
      fileName: '../secrets.sql',
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/Invalid schema file name/);

    const missingEnum = await fake.call('get_enum_info', {
      enumName: 'constructor',
    });

    expect(missingEnum.isError).toBe(true);
    expect(JSON.stringify(missingEnum.content)).toMatch(/not found/);
  });
});
