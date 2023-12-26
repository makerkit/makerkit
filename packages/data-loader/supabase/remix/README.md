# Remix Data Loader SDK for Supabase

## Installation

The Data Loader SDK is provided as an independent (and open-source) package - `@makerkit/data-loader-supabase-remix`.

To install it, run the following command:

```bash
npm i @makerkit/data-loader-supabase-remix
```

To import the Data Loader SDK, you can use multiple approaches.

1. **Client Components** - i.e. to be used in SPA/SSR
2. **React Hook** - i.e. to be used in React Client Components
3. **Directly** using the `fetchDataFromSupabase` function. Useful for server-side code - e.g. in actions and loaders

## Initialize React Query in your app

Before being able to use the Data Loader, make sure to initialize React Query in your app.

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
}
```

In your case `App` will be your Remix root component.

## Usage

Let's see how to use the Data Loader SDK.

### Client Components

Use the `ClientDataLoader` components to fetch data from Supabase.

```tsx
import { ClientDataLoader } from '@makerkit/data-loader-supabase-nextjs';
```

These are ideal when you want to fetch the data in both the server and the client.

NB: at the moment Remix doesn't support RSC - but it will soon. This is why `ClientDataLoader` is pre-emptively named this way. We expect to release a `ServerDataLoader` component once Remix supports RSC (React Server Components).

### useSupabaseQuery React Hook

Alternatively, you can use a **React Hook** - which can only be used in React Client Components:

```tsx
import useSupabase from '~/core/supabase/use-supabase';
import { useSupabaseQuery } from '@makerkit/data-loader-supabase-nextjs';

function OrganizationsTable() {
  const client = useSupabase();

  const { data, isLoading, error } = useSupabaseQuery({
    client,
    table: 'organizations',
    select: '*',
  });

  if (isLoading) {
    return <span>Loading...</span>;
  }

  if (error) {
    return <span>Error: {error.message}</span>;
  }

  return (
    <DataTable
      data={data}
      columns={[
        {
          header: 'ID',
          accessorKey: 'id',
        },
        {
          header: 'Name',
          accessorKey: 'name',
        },
      ]}
    />
  );
}
```

### Directly from the "getDataFromSupabaseTable" function

Underneath the hood, the `ClientDataLoader` component uses the `fetchDataFromSupabase` function - which can be used directly to fetch data from Supabase.

The `fetchDataFromSupabase` function is exported from the `@makerkit/data-loader-supabase-core` package - which is a dependency of the `@makerkit/data-loader-supabase-remix` package.

You can use this anywhere you want - e.g. in a React Hook, in a React Component, in Loaders/Actions, etc. This is why you will need to pass the appropriate Supabase Client to the function.

```tsx
import getSupabaseServerClient from '~/core/supabase/server-client';
import { json } from '@remix-run/node';
import { fetchDataFromSupabase } from '@makerkit/data-loader-supabase-core';

export async function loader() {
  const client = getSupabaseServerClient();

  const { data, count, pageSize, pageCount } = await fetchDataFromSupabase({
    client,
    table: 'organizations',
    select: '*',
    where: {
      name: {
        textSearch: `'makerkit'`,
      },
    },
  });

  return json({
    data,
    count,
    pageSize,
    pageCount,
  });
}
```

## Usage

The Data Loader SDK provides the `ClientDataLoader` component. This component uses React Query under the hood and exposes the properties `data`, `loading` and `error` - since the loading state is something you need to worry about as it's handled by the client and the data is not available when the component is rendered.

### API

The component accepts the following properties:

Required:

- `client` - the Supabase Client to use to fetch data. This is required.
- `table` - the table to fetch data from. This is autocompleted thanks to the Typescript types exported by the Supabase JS Client. This is required.

Optional:

- `select` - the columns to fetch listed as an array. You can also use first-level joins - e.g. `['id', 'name', 'organization_id.name']`. The `*` wildcard is also supported - as in `'*'` (not an array). In this case, all the columns will be fetched.
- `where` - the where clause to use to filter the data. This will change based on the table you're fetching data from.
- `sort` - the order clause to use to order the data. This will change based on the table you're fetching data from.
- `page` - the page to use to paginate the data.
- `limit` - the limit clause to use to limit the data - i.e. the page size.
- `single` - whether to return a single object or an array of objects. This is useful when you're fetching a single object - e.g. a user by its id. By default, just like the Supabase JS Client, it returns an array of objects. Unlike the Supabase JS Client, it will not throw an error when 0 or many objects are returned.
- `count` - the count type to use to count the data. You can use either `exact` or `estimated`. By default, it uses `exact`.

### ClientDataLoader

Let's see how to use the `ClientDataLoader` component. We will build a simple table that lists all the organizations the user can read.

The below is the list of properties returned by the component's children function:

- `result`:
  - `data` - the data fetched from Supabase. In this case, an array of objects with all the columns of the `organizations` table.
  - `count` - the total number of rows in the table. In this case, the total number of rows in the `organizations` table.
  - `pageSize` - the page size used to paginate the data. In this case, the default page size.
  - `pageCount` - the total number of pages used to paginate the data. In this case, the total number of pages used to paginate the `organizations` table.
- `isLoading` - whether the data is loading or not.
- `error` - the error, if any.
- `onPageChange` - the function to call when the page changes. This is useful when you want to use the `page` property to paginate the data.

Let's see how to use the `ClientDataLoader` component.

```tsx
import useSupabase from '~/core/supabase/use-supabase';
import { ClientDataLoader } from '@makerkit/data-loader-supabase-remix';

interface SearchParams {
  page: string;
}

const OrganizationsTable = ({
  searchParams,
}: {
  searchParams: SearchParams;
}) => {
  const client = useSupabase();
  const page = Number(searchParams.page) || 1;

  return (
    <ClientDataLoader
      client={client}
      table="organizations"
      page={page} // the page to fetch
      select="*" // all the columns - can be omitted
      limit={10} // retrieve 10 organizations per page
    >
      {({ result, isLoading }) => {
        const { data, count, pageSize, pageCount } = result;

        if (isLoading) {
          return <span>Loading...</span>;
        }

        return (
          <DataTable
            data={data}
            count={count}
            pageSize={pageSize}
            pageCount={pageCount}
            columns={[
              {
                header: 'ID',
                accessorKey: 'id',
              },
              {
                header: 'Name',
                accessorKey: 'name',
              },
            ]}
          />
        );
      }}
    </ClientDataLoader>
  );
};
```

### Filters

Let's see how to use the `where` property. We can use nearly all the supported operators by the Supabase JS Client.

Below, we pass `where` to the `ClientDataLoader` component to filter the organizations by their name. We use the `textSearch` operator to search for the word `supabase` in the `name` column.

```tsx
import { ClientDataLoader } from '@makerkit/data-loader-supabase-remix';

<ClientDataLoader
  client={client} // the Supabase Client
  table="organizations"
  select="*"
  where={{
    name: {
      textSearch: `'supabase'`,
    },
  }}
/>;
```

We can also use other operators - e.g. `in` to filter the organizations by their id - i.e. to fetch only the organizations with the ids `1`, `2` and `3`.

```tsx
import { ClientDataLoader } from '@makerkit/data-loader-supabase-nextjs';

<ClientDataLoader
  client={client} // the Supabase Client
  table="organizations"
  select="*"
  where={{
    id: {
      in: [1, 2, 3],
    },
  }}
/>;
```

Alternatively, we can use the `eq` operator to filter the organizations by their id - i.e. to fetch only the organizations with the id `1`.

```tsx
import { ClientDataLoader } from '@makerkit/data-loader-supabase-remix';

<ClientDataLoader
  client={client}
  table="organizations"
  select="*"
  where={{
    id: {
      eq: 1,
    },
  }}
/>;
```

### Select

Let's see how to use the `select` property.

Below, we pass `select` to the `ClientDataLoader` component to select only the `id` and `name` columns.

```tsx
import { ClientDataLoader } from '@makerkit/data-loader-supabase-remix';

<ClientDataLoader
  client={client}
  table="organizations"
  select={['id', 'name']}
/>;
```

Let's assume we want to fetch the organization name of the `tasks` table, which has a `organization_id` column that references the `organizations` table. We can use first-level joins to fetch the organization name.

```tsx
import { ClientDataLoader } from '@makerkit/data-loader-supabase-remix';

<ClientDataLoader
  client={client}
  table="tasks"
  select={['id', 'name', 'organization_id.name']}
/>;
```

The data returned will be an array of objects with the following structure:

```json
[
  {
    "id": 1,
    "name": "Task 1",
    "organization_id": {
      "name": "Organization 1"
    }
  },
  {
    "id": 2,
    "name": "Task 2",
    "organization_id": {
      "name": "Organization 2"
    }
  }
]
```

The `*` wildcard is also supported - as in `*` (not an array). In this case, all the columns will be fetched.

```tsx
import { ClientDataLoader } from '@makerkit/data-loader-supabase-remix';

<ClientDataLoader client={client} table="organizations" select="*" />;
```

You don't have to provide it - as it's the default value. The following is equivalent to the previous example.

```tsx
import { ClientDataLoader } from '@makerkit/data-loader-supabase-remix';

<ClientDataLoader client={client} table="organizations" />;
```

### Single Object

Let's see how to use the `single` property. We can use this property to unwrap the data returned by the `ServerDataLoader` component - since it returns an array of objects by default.

Below, we pass `single` to the `ServerDataLoader` component to fetch a single organization by its id.

```tsx
import { ClientDataLoader } from '@makerkit/data-loader-supabase-remix';

<ClientDataLoader
  table="organizations"
  select={['id', 'name']}
  single
  where={{
    id: {
      eq: 1,
    },
  }}
/>;
```

The data returned will be an object with the following structure:

```json
{
  "id": 1,
  "name": "Organization 1"
}
```

Bear in mind, a value can be `undefined` when not found - so you need to handle this case.

### Camel Case

Let's see how to use the `camelCase` property. We can use this property to convert the column names to camel case - since normally your Postgres column names are snake case.

Below, we pass `camelCase` to the `ServerDataLoader` component to convert the column names to camel case.

Assuming the `organizations` table has a `organization_name` column, the data returned will be an array of objects with the following structure:

```json
[
  {
    "id": 1,
    "organizationName": "Organization 1"
  },
  {
    "id": 2,
    "organizationName": "Organization 2"
  }
]
```

Check out the following example:

```tsx
import { ServerDataLoader } from '@makerkit/data-loader-supabase-remix';

function Component() {
  return (
    <ServerDataLoader
      client={client}
      table="organizations"
      select={['id', 'organization_name']}
      camelCase
    >
      {({ data }) => {
        return (
          <div>
            <span>{data.id}</span>
            <span>{data.organizationName}</span>
          </div>
        );
      }}
    </ServerDataLoader>
  );
}
```

The TypeScript types are also updated accordingly - so you can be sure that the data you're fetching is the data you're expecting.
