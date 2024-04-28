# Next.js Data Loader SDK for Supabase

## Installation

The Data Loader SDK is provided as an independent (and open-source) package - `@makerkit/data-loader-supabase-nextjs`.

To install it, run the following command:

```bash
npm i @makerkit/data-loader-supabase-nextjs
```

To import the Data Loader SDK, you can use multiple approaches.

1. **Server Components** - i.e. to be used in RSCs
2. **Client Components** - i.e. to be used in SPA/SSR
3. **React Hook** - i.e. to be used in React Client Components
4. **Directly** using the `fetchDataFromSupabase` function. Useful for server-side code - e.g. in a Route Handler, or Server Action

## Usage

Let's see how to use the Data Loader SDK.

### Server Components

With **React Server Components** - i.e. to be used in RSCs:

```tsx
import { ServerDataLoader } from '@makerkit/data-loader-supabase-nextjs';
```

These stream compiled JSX directly to the browser and are ideal when you want to fetch the data only on the server and never on the client.

### Client Components

With **React Client Components** - i.e. to be used in SPA/SSR:

```tsx
import { ClientDataLoader } from '@makerkit/data-loader-supabase-nextjs/client';
```

These are ideal when you want to fetch the data in both the server and the client.

### useSupabaseQuery React Hook

Alternatively, you can use a **React Hook** - which can only be used in React Client Components:

```tsx
import useSupabase from '~/core/supabase/use-supabase';
import { useSupabaseQuery } from '@makerkit/data-loader-supabase-nextjs/client';

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

Underneath the hood, the `ServerDataLoader` and `ClientDataLoader` components use the `fetchDataFromSupabase` function - which can be used directly to fetch data from Supabase.

The `fetchDataFromSupabase` function is exported from the `@makerkit/data-loader-supabase-core` package - which is a dependency of the `@makerkit/data-loader-supabase-nextjs` package.

You can use this anywhere you want - e.g. in a React Hook, in a React Component, in a Next.js API Route, etc. This is why you will need to pass the appropriate Supabase Client to the function.

```tsx
import getSupabaseRouteHandlerClient from '~/core/supabase/route-handler-client';
import { NextResponse } from 'next/server';
import { fetchDataFromSupabase } from '@makerkit/data-loader-supabase-core';

export async function GET() {
  const client = getSupabaseRouteHandlerClient();

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

  return NextResponse.json({
    data,
    count,
    pageSize,
    pageCount,
  });
}
```

If you were to use it in a Server Action, you would need to pass the appropriate Supabase Client to the function.

```tsx
'use server';

import getSupabaseServerActionClient from '~/core/supabase/server-action-client';
import { fetchDataFromSupabase } from '@makerkit/data-loader-supabase-core';

export async function serverAction() {
  const client = getSupabaseServerActionClient();

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

  return {
    data,
    count,
    pageSize,
    pageCount,
  };
}
```

## Usage

The Data Loader SDK provides two components:

- `ServerDataLoader` - for React Server Components
- `ClientDataLoader` - for React Client Components

The two works exactly the same way - but you need to choose the one that best fits your needs. The only difference is in what they return.

1. `ServerDataLoader` returns directly the data fetched from Supabase - since the loading state is not something you need to worry about as it's handled by the server and the data is already available when the component is rendered.
2. `ClientDataLoader` uses SWR under the hood and exposes the properties `data`, `loading` and `error` - since the loading state is something you need to worry about as it's handled by the client and the data is not available when the component is rendered.

### API

Both components accept the following properties:

Required:

- `client` - the Supabase Client to use to fetch data. This is required.
- `table` - the table to fetch data from. This is autocompleted thanks to the Typescript types exported by the Supabase JS Client. This is required.

Optional:

- `select` - the columns to fetch listed as an array, a string, or the star operator [`*`]. You can also use first-level joins - e.g. `['id', 'name', 'organization_id.name']`. The `*` wildcard is also supported - as in `'*'` (not an array). In this case, all the columns will be fetched.
- `where` - the where clause to use to filter the data. This will change based on the table you're fetching data from.
- `sort` - the order clause to use to order the data. This will change based on the table you're fetching data from.
- `page` - the page to use to paginate the data.
- `limit` - the limit clause to use to limit the data - i.e. the page size.
- `single` - whether to return a single object or an array of objects. This is useful when you're fetching a single object - e.g. a user by its id. By default, just like the Supabase JS Client, it returns an array of objects. Unlike the Supabase JS Client, it will not throw an error when 0 or many objects are returned.
- `count` - the count type to use to count the data. You can use either `exact` or `estimated`. By default, it uses `exact`.

#### Select

The `select` property accepts the following values:

1. **Array**: An array of strings - e.g. `['id', 'name']`. This is type-safe and autocompleted - up to the first-level joins.
2. **Postgrest.JS DSL**: A string accepted by [PostgREST.js](https://github.com/supabase/postgrest-js) - e.g. `id, name, user_id (name)`. This is not type-safe and not autocompleted - but it's more flexible as you can nest joins as you wish. This relies on PostgREST.js to parse the string and compute the output, so it also inherits the limitations and bugs of PostgREST.js.
3. **The star operator** - to select the whole row, you can pass `*`.
4. **Omit it completely** - to select the whole row, either pass `*` or nothing as this is the default value.

### ServerDataLoader

Let's see how to use the `ServerDataLoader` component.

We will build a simple table that lists all the organizations the user can read.

```tsx
import getSupabaseServerComponentClient from '~/core/supabase/server-component-client';
import DataTable from '~/core/ui/DataTable';
import { ServerDataLoader } from '@makerkit/data-loader-supabase-nextjs';

const OrganizationsTable = () => {
  const client = getSupabaseServerComponentClient();

  return (
    <ServerDataLoader
      client={client}
      table="organizations"
      select={['id', 'name']}
    >
      {({ data, count, pageSize, pageCount }) => {
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
    </ServerDataLoader>
  );
};
```

We used the following properties:

1. `table` - the table to fetch data from. In this case, `organizations`.
2. `select` - the columns to fetch. In this case, `["id", "name"]` - i.e. the `id` and `name` columns of the `organizations` table.

The `ServerDataLoader` component returns the following properties:

1. `data` - the data fetched from Supabase. In this case, an array of objects with all the columns of the `organizations` table.
2. `count` - the total number of rows in the table. In this case, the total number of rows in the `organizations` table.
3. `pageSize` - the page size used to paginate the data. In this case, the default page size.
4. `pageCount` - the total number of pages used to paginate the data. In this case, the total number of pages used to paginate the `organizations` table.

### ClientDataLoader

Let's see how to use the `ClientDataLoader` component.

We will build a simple table that lists all the organizations the user can read. It works much the same way as the `ServerDataLoader` component - but it returns the following properties:

1. `result`:
1. `data` - the data fetched from Supabase. In this case, an array of objects with all the columns of the `organizations` table.
1. `count` - the total number of rows in the table. In this case, the total number of rows in the `organizations` table.
1. `pageSize` - the page size used to paginate the data. In this case, the default page size.
1. `pageCount` - the total number of pages used to paginate the data. In this case, the total number of pages used to paginate the `organizations` table.
1. `isLoading` - whether the data is loading or not.
1. `error` - the error, if any.
1. `onPageChange` - the function to call when the page changes. This is useful when you want to use the `page` property to paginate the data.

```tsx
import useSupabase from '~/core/supabase/use-supabase';
import { ClientDataLoader } from '@makerkit/data-loader-supabase-nextjs/client';

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
import { ClientDataLoader } from '@makerkit/data-loader-supabase-nextjs/client';

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
import { ClientDataLoader } from '@makerkit/data-loader-supabase-nextjs/client';

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
import { ClientDataLoader } from '@makerkit/data-loader-supabase-nextjs/client';

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
import { ClientDataLoader } from '@makerkit/data-loader-supabase-nextjs/client';

<ClientDataLoader
  client={client}
  table="organizations"
  select={['id', 'name']}
/>;
```

Let's assume we want to fetch the organization name of the `tasks` table, which has a `organization_id` column that references the `organizations` table. We can use first-level joins to fetch the organization name.

```tsx
import { ClientDataLoader } from '@makerkit/data-loader-supabase-nextjs/client';

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
import { ClientDataLoader } from '@makerkit/data-loader-supabase-nextjs/client';

<ClientDataLoader client={client} table="organizations" select="*" />;
```

You don't have to provide it - as it's the default value. The following is equivalent to the previous example.

```tsx
import { ClientDataLoader } from '@makerkit/data-loader-supabase-nextjs/client';

<ClientDataLoader client={client} table="organizations" />;
```

### Single Object

Let's see how to use the `single` property. We can use this property to unwrap the data returned by the `ServerDataLoader` component - since it returns an array of objects by default.

Below, we pass `single` to the `ClientDataLoader` component to fetch a single organization by its id.

```tsx
import { ClientDataLoader } from '@makerkit/data-loader-supabase-nextjs/client';

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

Below, we pass `camelCase` to the `ClientDataLoader` component to convert the column names to camel case.

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
import { ServerDataLoader } from '@makerkit/data-loader-supabase-nextjs/client';

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

### Provide the SWR configuration

To offer you more flexibility, you can also pass the `useSupabaseQuery` [SWR](https://swr.vercel.app/) configuration using the `config` property.

```tsx
import { useSupabaseQuery } from '@makerkit/data-loader-supabase-nextjs/client';

const { data, isLoading, error } = useSupabaseQuery({
  client,
  table: 'organizations',
  select: '*',
  config: {
    refreshWhenOffline: false,
    revalidateOnMount: false,
  },
});
```

You can check out the [SWR documentation](https://swr.vercel.app/docs/api) to see all the available options.

You an also pass the `useSupabaseQuery` React Query configuration to the `ClientDataLoader` component.

```tsx
import { ClientDataLoader } from '@makerkit/data-loader-supabase-nextjs/client';

<ClientDataLoader
  client={client}
  table="organizations"
  select="*"
  config={{
    refreshWhenOffline: false,
    revalidateOnMount: false,
  }}
/>;
```