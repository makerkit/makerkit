import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type DatabaseDeps, createDatabaseService } from '../database.service';
import { createPostgresSchemaDeps } from '../node';

// Creates two throwaway schemas ("pg_" names are reserved by Postgres) with same-named objects to check that the
// catalog queries stay inside the requested schema. Dropped afterwards.
const DATABASE_URL = process.env['TEST_DATABASE_URL'];

const suffix = Math.random().toString(36).slice(2, 8);
const A = `schema_test_${suffix}_a`;
const B = `schema_test_${suffix}_b`;

describe.skipIf(!DATABASE_URL)(
  'catalog queries against a live database',
  () => {
    let admin: ReturnType<typeof postgres>;
    let deps: DatabaseDeps;

    const service = () => createDatabaseService(deps);

    beforeAll(async () => {
      admin = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} });

      await admin.unsafe(`
      create schema ${A};
      create schema ${B};

      create type ${A}.mood as enum ('happy', 'sad');
      create type ${B}.mood as enum ('other');

      create table ${A}.parent (a int, b int, primary key (a, b));

      create table ${A}.child (
        id int constraint child_pk primary key,
        pa int,
        pb int,
        owner uuid references auth.users (id) on delete cascade,
        mood ${A}.mood,
        tags text[],
        foreign key (pa, pb) references ${A}.parent (a, b)
      );

      create index child_apikey on ${A}.child (pb, pa);
      create index child_grouppkey on ${A}.child (owner);
      create index child_expr_idx on ${A}.child ((id + 1));

      create table ${A}."Widget" (id int primary key);

      create table ${B}.child (id int primary key, other text);
      create index child_other_idx on ${B}.child (other);
    `);

      deps = createPostgresSchemaDeps(process.cwd(), {
        databaseUrl: DATABASE_URL,
        settings: {
          includeSchemas: [A, B],
          defaultSchema: A,
          excludeTables: [`${B}.child`],
        },
      });
    });

    afterAll(async () => {
      await deps?.close?.();
      await admin?.unsafe(
        `drop schema if exists ${A} cascade; drop schema if exists ${B} cascade;`,
      );
      await admin?.end();
    });

    it('lists tables across schemas and honours schema.table exclusions', async () => {
      const { tables } = await service().getTables();

      expect(
        tables.map((table) => `${table.schema}.${table.name}`).sort(),
      ).toEqual([`${A}.Widget`, `${A}.child`, `${A}.parent`]);
    });

    it('lists each column once, even when it is part of a composite foreign key', async () => {
      const info = await service().getTableInfo({ tableName: 'child' });

      expect(info.schema).toBe(A);
      expect(info.columns.map((column) => column.name)).toEqual([
        'id',
        'pa',
        'pb',
        'owner',
        'mood',
        'tags',
      ]);
      expect(info.columns.find((c) => c.name === 'owner')).toMatchObject({
        isForeignKey: true,
        referencedTable: 'users',
        referencedColumn: 'id',
      });
      expect(info.columns.find((c) => c.name === 'pb')).toMatchObject({
        isForeignKey: true,
        referencedTable: 'parent',
        referencedColumn: 'b',
      });
    });

    it('reports cross-schema and composite foreign keys', async () => {
      const info = await service().getTableInfo({ tableName: 'child' });
      const byTable = Object.fromEntries(
        info.foreignKeys.map((fk) => [fk.referencedTable, fk]),
      );

      expect(info.foreignKeys).toHaveLength(2);
      expect(byTable['users']).toMatchObject({
        columns: ['owner'],
        referencedColumns: ['id'],
        onDelete: 'CASCADE',
      });
      expect(byTable['parent']).toMatchObject({
        columns: ['pa', 'pb'],
        referencedColumns: ['a', 'b'],
      });
    });

    it('keeps index column order and filters only the primary key index', async () => {
      const info = await service().getTableInfo({ tableName: 'child' });
      const byName = Object.fromEntries(
        info.indexes.map((index) => [index.name, index]),
      );

      // child_pk is the primary key under a name LIKE '%_pkey' does not catch.
      expect(Object.keys(byName).sort()).toEqual([
        'child_apikey',
        'child_expr_idx',
        'child_grouppkey',
      ]);
      expect(byName['child_apikey']?.columns).toEqual(['pb', 'pa']);
      expect(byName['child_expr_idx']?.columns).toEqual(['(id + 1)']);
    });

    it('does not mix up same-named tables in other schemas (regression guard)', async () => {
      const info = await service().getTableInfo({ tableName: `${B}.child` });

      expect(info.columns.map((column) => column.name)).toEqual([
        'id',
        'other',
      ]);
      expect(info.indexes.map((index) => index.name)).toEqual([
        'child_other_idx',
      ]);
    });

    it('accepts quoted identifiers', async () => {
      const info = await service().getTableInfo({ tableName: `${A}."Widget"` });

      expect(info).toMatchObject({ schema: A, name: 'Widget' });
      expect(info.columns.map((column) => column.name)).toEqual(['id']);
    });

    it('keeps same-named enums from different schemas apart', async () => {
      const { enums } = await service().listEnums();

      expect(enums).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'mood', values: ['happy', 'sad'] }),
          expect.objectContaining({ name: `${B}.mood`, values: ['other'] }),
        ]),
      );
    });
  },
);
