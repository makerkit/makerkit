import { expect, test } from 'vitest';
import { createSupabaseClient } from '@makerkit/test-utils';
import { buildPostgrestQuery } from './utils';

type Client = Awaited<ReturnType<typeof createSupabaseClient>>;

test(`String Builder: simple select`, async () => {
  const select = buildPostgrestQuery<Client, 'tasks'>(['id', 'name']);

  expect(select).toBe('id,name');
});

test(`String Builder: join select`, async () => {
  const select = buildPostgrestQuery<Client, 'tasks'>(['id', 'name', 'user_id.onboarded']);

  expect(select).toBe('id,name,user_id !inner (onboarded)');
});

test(`String Builder: multiple join select`, async () => {
  const select = buildPostgrestQuery<Client, 'tasks'>(['id', 'name', 'user_id.onboarded', 'user_id.id']);

  expect(select).toBe('id,name,user_id !inner (onboarded,id)');
});