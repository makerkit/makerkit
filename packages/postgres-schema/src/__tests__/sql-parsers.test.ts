import { describe, expect, it } from 'vitest';

import {
  determineTopic,
  extractDependencies,
  extractFunctionNames,
  extractFunctionsFromContent,
  extractQualifiedTableNames,
  extractSectionHeader,
  extractTableDefinition,
  extractTableNames,
  parseColumns,
  parseEnumDefinitions,
  parseEnums,
  parseForeignKeys,
  parseIndexes,
  parseParameterList,
} from '../sql-parsers';

const SCHEMA = `
/*
 * -------------------------------------------------------
 * Section: Notes
 * We create the schema for notes
 * -------------------------------------------------------
 */

create type public.note_visibility as enum ('private', 'shared');

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  title varchar(255) not null,
  body text,
  visibility public.note_visibility default 'private',
  created_at timestamptz not null default now(),
  constraint notes_title_len check (char_length(title) > 0),
  foreign key (account_id) references public.accounts(id) on delete cascade
);

create index if not exists ix_notes_account_id on public.notes(account_id);
create unique index ix_notes_slug on public.notes using btree (account_id, title);

-- Returns notes for the current account
create or replace function public.list_notes(target_account_id uuid, lim int default 10)
returns setof public.notes
language sql
security invoker
as $$
  select * from public.notes where account_id = target_account_id limit lim;
$$;

create function kit.purge_notes() returns void language plpgsql security definer as $$
begin
  delete from public.notes;
end;
$$;
`;

describe('extractSectionHeader', () => {
  it('reads section and description from the header comment', () => {
    expect(extractSectionHeader(SCHEMA)).toEqual({
      section: 'Notes',
      description: 'We create the schema for notes',
    });
  });

  it('falls back when the header is absent', () => {
    expect(extractSectionHeader('create table x();')).toEqual({
      section: 'Unknown',
      description: 'No description available',
    });
  });
});

describe('name extraction', () => {
  it('extracts tables, functions and dependencies', () => {
    expect(extractTableNames(SCHEMA)).toEqual(['notes']);
    expect(extractFunctionNames(SCHEMA)).toEqual(['list_notes', 'purge_notes']);
    expect(extractDependencies(SCHEMA)).toEqual(['accounts']);
  });

  it('ignores references to auth.users', () => {
    expect(extractDependencies('references auth.users(id)')).toEqual([]);
  });
});

describe('table parsing', () => {
  const definition = extractTableDefinition(SCHEMA, 'public', 'notes')!;

  it('extracts the create statement', () => {
    expect(definition).toMatch(/^create table if not exists public\.notes/);
    expect(definition.endsWith(');')).toBe(true);
    expect(extractTableDefinition(SCHEMA, 'public', 'missing')).toBeNull();
  });

  it('parses columns with constraints', () => {
    const columns = parseColumns(definition);
    const byName = Object.fromEntries(columns.map((c) => [c.name, c]));

    expect(Object.keys(byName)).toEqual([
      'id',
      'account_id',
      'title',
      'body',
      'visibility',
      'created_at',
    ]);
    expect(byName.id).toMatchObject({ isPrimaryKey: true, nullable: false });
    expect(byName.account_id).toMatchObject({
      isForeignKey: true,
      nullable: false,
      referencedTable: 'accounts',
      referencedColumn: 'id',
    });
    expect(byName.body?.nullable).toBe(true);
    expect(byName.visibility?.defaultValue).toBe("'private'");
  });

  it('parses table-level foreign keys', () => {
    expect(parseForeignKeys(definition)).toEqual([
      {
        name: 'fk_accounts_account_id',
        columns: ['account_id'],
        referencedTable: 'accounts',
        referencedColumns: ['id'],
        onDelete: 'cascade',
        onUpdate: undefined,
      },
    ]);
  });

  it('parses indexes including unique and method', () => {
    const indexes = parseIndexes(SCHEMA, 'notes');

    expect(indexes).toHaveLength(2);
    expect(indexes[0]).toMatchObject({
      name: 'ix_notes_account_id',
      columns: ['account_id'],
      unique: false,
      type: 'btree',
    });
    expect(indexes[1]).toMatchObject({
      name: 'ix_notes_slug',
      columns: ['account_id', 'title'],
      unique: true,
    });
  });
});

describe('parseEnums', () => {
  it('parses enum types with values', () => {
    expect(parseEnums(SCHEMA, '01-enums.sql')).toEqual({
      note_visibility: {
        name: 'note_visibility',
        values: ['private', 'shared'],
        sourceFile: '01-enums.sql',
      },
    });
  });
});

describe('extractFunctionsFromContent', () => {
  it('extracts functions with schema, security level and parameters', () => {
    const functions = extractFunctionsFromContent(SCHEMA, 'notes.sql');

    expect(functions).toHaveLength(2);
    expect(functions[0]).toMatchObject({
      name: 'list_notes',
      schema: 'public',
      securityLevel: 'invoker',
      returnType: 'setof public.notes',
      description: 'Returns notes for the current account',
      sourceFile: 'notes.sql',
    });
    expect(functions[0]?.parameters).toEqual([
      { name: 'target_account_id', type: 'uuid', defaultValue: undefined },
      { name: 'lim', type: 'int', defaultValue: '10' },
    ]);
    expect(functions[1]).toMatchObject({
      name: 'purge_notes',
      schema: 'kit',
      securityLevel: 'definer',
    });
  });
});

describe('parseParameterList', () => {
  it('handles pg_get_function_arguments output', () => {
    expect(
      parseParameterList(
        'account_id uuid, permission_name public.app_permissions, OUT result boolean',
      ),
    ).toEqual([
      { name: 'account_id', type: 'uuid', defaultValue: undefined },
      {
        name: 'permission_name',
        type: 'public.app_permissions',
        defaultValue: undefined,
      },
      { name: 'result', type: 'boolean', defaultValue: undefined },
    ]);
  });

  it('returns an empty list for no arguments', () => {
    expect(parseParameterList('')).toEqual([]);
  });
});

describe('determineTopic', () => {
  it('maps known files and infers from content', () => {
    expect(
      determineTopic('03-accounts.sql', '', { '03-accounts.sql': 'accounts' }),
    ).toBe('accounts');
    expect(determineTopic('99-custom.sql', 'create table subscription_x')).toBe(
      'billing',
    );
    expect(determineTopic('99-custom.sql', 'create table widgets')).toBe(
      'general',
    );
  });
});

describe('quoted identifiers', () => {
  const QUOTED = `
create table if not exists public."UserProfile" (
  "userId" text not null references public."User"("id"),
  bio text
);
create or replace function public."getProfile"() returns void language sql as $$ select 1; $$;
`;

  it('captures the quoted table and function name, not the schema', () => {
    expect(extractTableNames(QUOTED)).toEqual(['UserProfile']);
    expect(extractQualifiedTableNames(QUOTED)).toEqual([
      { schema: 'public', name: 'UserProfile' },
    ]);
    expect(extractFunctionNames(QUOTED)).toEqual(['getProfile']);
    expect(extractDependencies(QUOTED)).toEqual(['User']);
  });

  it('finds and parses a quoted table definition', () => {
    const definition = extractTableDefinition(QUOTED, 'public', 'UserProfile');

    expect(definition).not.toBeNull();
    expect(parseColumns(definition!)[0]).toMatchObject({
      name: 'userId',
      nullable: false,
      referencedTable: 'User',
      referencedColumn: 'id',
    });
  });
});

describe('schema-qualified lookups', () => {
  const TWO_SCHEMAS = `
create table kit.notes (id uuid primary key, kit_only text);
create table notes (id uuid primary key, title text);
create index ix_kit_notes on kit.notes (kit_only);
create index ix_notes_title on notes (title);
`;

  it('keeps tables and indexes from another schema out', () => {
    expect(extractQualifiedTableNames(TWO_SCHEMAS)).toEqual([
      { schema: 'kit', name: 'notes' },
      { schema: null, name: 'notes' },
    ]);

    expect(extractTableDefinition(TWO_SCHEMAS, 'public', 'notes')).toMatch(
      /^create table notes/,
    );
    expect(
      extractTableDefinition(TWO_SCHEMAS, 'billing', 'notes', false),
    ).toBeNull();

    expect(
      parseIndexes(TWO_SCHEMAS, 'notes', 'public').map((index) => index.name),
    ).toEqual(['ix_notes_title']);
    expect(
      parseIndexes(TWO_SCHEMAS, 'notes', 'kit', false).map(
        (index) => index.name,
      ),
    ).toEqual(['ix_kit_notes']);
  });

  it('keeps public.users as a dependency and drops auth.users only', () => {
    expect(
      extractDependencies(
        'user_id uuid references auth.users(id), profile references public.users(id)',
      ),
    ).toEqual(['users']);
    expect(extractDependencies('id uuid references auth.users')).toEqual([]);
  });
});

describe('function extraction edge cases', () => {
  it('reads $function$ bodies, $1 parameters and parenthesised types', () => {
    const functions = extractFunctionsFromContent(
      `
CREATE OR REPLACE FUNCTION public.find_user(email varchar(255), price numeric(10, 2) = 0)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  select id from public.users where email = $1;
$function$;
`,
      'dump.sql',
    );

    expect(functions).toHaveLength(1);
    expect(functions[0]).toMatchObject({
      name: 'find_user',
      returnType: 'uuid',
      securityLevel: 'definer',
      parameters: [
        { name: 'email', type: 'varchar(255)' },
        { name: 'price', type: 'numeric(10, 2)', defaultValue: '0' },
      ],
    });
  });

  it('only uses the comment directly above a function as its description', () => {
    const functions = extractFunctionsFromContent(SCHEMA, 'notes.sql');

    expect(functions[1]).toMatchObject({
      name: 'purge_notes',
      description: 'No description available',
    });
  });
});

describe('parseEnumDefinitions', () => {
  it('keeps the schema and values containing commas or quotes', () => {
    expect(
      parseEnumDefinitions("create type kit.label as enum ('a, b', 'it''s');"),
    ).toEqual([{ schema: 'kit', name: 'label', values: ['a, b', "it's"] }]);
  });
});
