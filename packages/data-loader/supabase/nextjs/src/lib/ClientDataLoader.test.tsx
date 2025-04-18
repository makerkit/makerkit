import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, waitFor } from '@testing-library/react';
import { createSupabaseClient } from '@makerkit/test-utils';
import { ClientDataLoader } from './ClientDataLoader';
import { useSupabaseQuery } from './use-supabase-query';

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: vi.fn(),
}));

const createWrapper = () => {
  const queryClient = new QueryClient();

  return ({ children }: React.PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

test('Fetch a full table as an authed user', async (ctx) => {
  const client = await createSupabaseClient({ auth: true });

  const response = renderHook(
    () =>
      useSupabaseQuery({
        client,
        table: 'tasks',
      }),
    {
      wrapper: createWrapper(),
    },
  );

  await waitFor(() => {
    return ctx.expect(response.result.current.isLoading).toEqual(false);
  });

  ctx.expect(response.result.current.data).toEqual([
    {
      done: false,
      due_date: '2023-12-26T00:17:16+00:00',
      id: 3,
      name: 'Test the SDK',
      user_id: '5ebd5119-7b9a-4722-9463-e945878db095',
    },
  ]);
});

test('Fetch a full table as an anon user', async (ctx) => {
  const client = await createSupabaseClient({ auth: false });

  const response = renderHook(
    () =>
      useSupabaseQuery({
        client,
        table: 'tasks',
        select: ['name'],
      }),
    {
      wrapper: createWrapper(),
    },
  );

  await waitFor(() => {
    return ctx.expect(response.result.current.isLoading).toEqual(false);
  });

  ctx.expect(response.result.current.data).toEqual([]);
});

test('Fetch a partial table', async (ctx) => {
  const client = await createSupabaseClient({ auth: true });

  const response = renderHook(
    () =>
      useSupabaseQuery({
        client,
        table: 'tasks',
        select: ['id', 'name'],
      }),
    {
      wrapper: createWrapper(),
    },
  );

  await waitFor(() => {
    return ctx.expect(response.result.current.isLoading).toEqual(false);
  });

  ctx.expect(response.result.current.data).toEqual([
    {
      id: 3,
      name: 'Test the SDK',
    },
    {
      wrapper: createWrapper(),
    },
  ]);
});

test('Fetch a camelCase table', async (ctx) => {
  const client = await createSupabaseClient({ auth: true });

  const response = renderHook(
    () =>
      useSupabaseQuery({
        client,
        table: 'tasks',
        select: ['id', 'user_id'],
        camelCase: true,
      }),
    {
      wrapper: createWrapper(),
    },
  );

  await waitFor(() => {
    return ctx.expect(response.result.current.isLoading).toEqual(false);
  });

  ctx.expect(response.result.current.data).toEqual([
    {
      id: 3,
      userId: '5ebd5119-7b9a-4722-9463-e945878db095',
    },
  ]);
});

test('Fetch a single item camelCase table', async (ctx) => {
  const client = await createSupabaseClient({ auth: true });

  const response = renderHook(
    () =>
      useSupabaseQuery({
        client,
        table: 'tasks',
        select: ['id', 'user_id'],
        camelCase: true,
        single: true,
      }),
    {
      wrapper: createWrapper(),
    },
  );

  await waitFor(() => {
    return ctx.expect(response.result.current.isLoading).toEqual(false);
  });

  ctx.expect(response.result.current.data).toEqual({
    id: 3,
    userId: '5ebd5119-7b9a-4722-9463-e945878db095',
  });
});

test('Fetch a partial table with a join', async (ctx) => {
  const client = await createSupabaseClient({ auth: true });

  const response = renderHook(
    () =>
      useSupabaseQuery({
        client,
        table: 'tasks',
        select: ['id', 'name', 'user_id.onboarded', 'user_id.display_name'],
        where: {
          user_id: {
            eq: '5ebd5119-7b9a-4722-9463-e945878db095',
          },
        },
      }),
    {
      wrapper: createWrapper(),
    },
  );

  await waitFor(() => {
    return ctx.expect(response.result.current.isLoading).toEqual(false);
  });

  ctx.expect(response.result.current.data).toEqual([
    {
      id: 3,
      name: 'Test the SDK',
      user_id: {
        onboarded: true,
        display_name: null,
      },
    },
  ]);
});

test('Fetch a partial table with text filter', async () => {
  const client = await createSupabaseClient({ auth: true });

  const response = renderHook(
    () =>
      useSupabaseQuery({
        client,
        table: 'tasks',
        select: ['id', 'name'],
        where: {
          user_id: {
            eq: '5ebd5119-7b9a-4722-9463-e945878db095',
          },
          name: {
            textSearch: "'SDK'",
          },
        },
      }),
    {
      wrapper: createWrapper(),
    },
  );

  await waitFor(() => {
    return expect(response.result.current.isLoading).toEqual(false);
  });

  expect(response.result.current.data).toEqual([
    {
      id: 3,
      name: 'Test the SDK',
    },
  ]);
});

test('Fetch a partial table with range filter', async () => {
  const client = await createSupabaseClient({ auth: true });

  const response = renderHook(
    () =>
      useSupabaseQuery({
        client,
        table: 'tasks',
        select: ['id', 'name'],
        where: {
          id: {
            gte: 0,
            lte: 3,
          },
        },
      }),
    {
      wrapper: createWrapper(),
    },
  );

  await waitFor(() => {
    return expect(response.result.current.isLoading).toEqual(false);
  });

  expect(response.result.current.data).toEqual([
    {
      id: 3,
      name: 'Test the SDK',
    },
  ]);
});

test('Fetch a single item with ClientDataLoader', async (ctx) => {
  const client = await createSupabaseClient({ auth: true });
  const Wrapper = createWrapper();

  const page = render(
    <Wrapper>
      <ClientDataLoader client={client} table={'tasks'} select={['id']} single>
        {(props) => {
          return (
            <>
              <span data-testid={'task'} data-value={props.result.data?.id} />
              <span
                data-testid={'loading'}
                data-value={props.isLoading.toString()}
              />
            </>
          );
        }}
      </ClientDataLoader>
    </Wrapper>,
  );

  await vi.waitFor(() => {
    return ctx
      .expect(page.getByTestId('loading').dataset['value']?.trim())
      .toEqual('false');
  });

  ctx.expect(page.getByTestId('task').dataset['value']?.trim()).toEqual('3');
});

test('Use a function in the where clause', async (ctx) => {
  const client = await createSupabaseClient({ auth: true });
  const Wrapper = createWrapper();

  const page = render(
    <Wrapper>
      <ClientDataLoader
        client={client}
        table={'tasks'}
        select={['id']}
        single
        where={(queryBuilder) => {
          return queryBuilder.eq('id', 3);
        }}
      >
        {(props) => {
          return (
            <>
              <span data-testid={'task'} data-value={props.result.data?.id} />
              <span
                data-testid={'loading'}
                data-value={props.isLoading.toString()}
              />
            </>
          );
        }}
      </ClientDataLoader>
    </Wrapper>,
  );

  await vi.waitFor(() => {
    return ctx
      .expect(page.getByTestId('loading').dataset['value']?.trim())
      .toEqual('false');
  });

  ctx.expect(page.getByTestId('task').dataset['value']?.trim()).toEqual('3');
});
