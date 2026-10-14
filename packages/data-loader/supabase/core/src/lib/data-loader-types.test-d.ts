import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from 'database.types';
import { describe, expectTypeOf, test } from 'vitest';

import { fetchDataFromSupabase } from './data-loader';
import type { DataLoader } from './data-loader-types';

type Task = Database['public']['Tables']['tasks']['Row'];
type Client = SupabaseClient<Database>;

// These types silently degraded to `any` when postgrest-js changed its
// internal file layout, so every assertion also guards against `any`.
describe('DataLoader.Data', () => {
  test('star selection returns the full row', () => {
    type Result = DataLoader.Data<Database, 'tasks'>;

    expectTypeOf<Result>().not.toBeAny();
    expectTypeOf<Result>().toEqualTypeOf<Task>();
  });

  test('string selection is parsed by postgrest-js', () => {
    type Result = DataLoader.Data<Database, 'tasks', 'id, name'>;

    expectTypeOf<Result>().not.toBeAny();
    expectTypeOf<Result>().toEqualTypeOf<{ id: number; name: string }>();
  });

  test('array selection maps the picked columns', () => {
    type Result = DataLoader.Data<Database, 'tasks', ['id', 'done']>;

    expectTypeOf<Result>().not.toBeAny();
    expectTypeOf<Result>().toMatchTypeOf<{ id: number; done: boolean }>();
  });
});

describe('fetchDataFromSupabase', () => {
  test('returns typed rows, not any', () => {
    const load = (client: Client) =>
      fetchDataFromSupabase({ client, table: 'tasks', select: 'id, name' });

    type Rows = Awaited<ReturnType<typeof load>>['data'];

    expectTypeOf<Rows>().not.toBeAny();
    expectTypeOf<Rows>().toEqualTypeOf<Array<{ id: number; name: string }>>();
  });

  test('where functions receive a typed builder', () => {
    type Where = NonNullable<
      DataLoader.DataLoaderProps<Client, 'tasks'>['where']
    >;
    type Builder =
      Extract<Where, (...args: never[]) => unknown> extends (
        query: infer Query,
      ) => unknown
        ? Query
        : never;

    expectTypeOf<Builder>().not.toBeAny();
    expectTypeOf<Builder>().toEqualTypeOf<
      DataLoader.QueryBuilder<Client, 'tasks'>
    >();
  });
});
