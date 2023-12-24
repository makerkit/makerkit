'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { SupabaseClient } from '@supabase/supabase-js';

import { DataLoader } from '@makerkit/data-loader-supabase-core';
import { useTableFetcher } from './use-table-fetcher';

const PAGE_SIZE = 10;

interface DataLoaderProps<
  Client extends SupabaseClient<DataLoader.GenericDatabase>,
  TableName extends keyof DataLoader.Tables<DataLoader.ExtractDatabase<Client>>,
  Query extends DataLoader.Query<DataLoader.ExtractDatabase<Client>, TableName> = DataLoader.StarOperator,
  Single extends boolean = false,
> extends DataLoader.DataLoaderProps<Client, TableName, Query, Single> {
  client: Client;

  children: (props: {
    result: {
      data: Single extends true
        ? DataLoader.Data<DataLoader.ExtractDatabase<Client>, TableName, Query> | undefined
        : Array<DataLoader.Data<DataLoader.ExtractDatabase<Client>, TableName, Query>>;
      count: number;
      page: number;
      pageSize: number;
      pageCount: number;
    };

    error: Error | null;
    isLoading: boolean;
    onPageChange: (page: number) => void;
  }) => React.ReactElement;
}

/**
 * Creates a data provider for a client.
 *
 * @param {DataLoaderProps} props - The properties for the data provider.
 * @constructor
 */
export function ClientDataLoader<
  Client extends SupabaseClient<DataLoader.GenericDatabase>,
  TableName extends keyof DataLoader.Tables<DataLoader.ExtractDatabase<Client>>,
  Query extends DataLoader.Query<DataLoader.ExtractDatabase<Client>, TableName> = DataLoader.StarOperator,
  Single extends boolean = false,
>(props: DataLoaderProps<Client, TableName, Query, Single>) {
  const { data, count, error, isLoading } = useTableFetcher<
    Client,
    TableName,
    Query,
    Single
  >(props);

  const onPageChange = useRouterParamsChange();
  const pageSize = props.limit ?? PAGE_SIZE;
  const pageCount = Math.ceil(count / (props.limit ?? PAGE_SIZE));

  return props.children({
    result: {
      data,
      count,
      pageCount,
      page: props.page ?? 1,
      pageSize,
    },
    error,
    isLoading,
    onPageChange,
  });
}

function useRouterParamsChange() {
  const router = useRouter();

  return useCallback(
    (page: number) => {
      const url = new URL(window.location.href);
      url.searchParams.set('page', String(page));

      router.push(url.pathname);
    },
    [router],
  );
}
