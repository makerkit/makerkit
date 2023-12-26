import { useQuery } from '@tanstack/react-query';
import {
  DataLoader,
  fetchDataFromSupabase,
} from '@makerkit/data-loader-supabase-core';

import { SupabaseClient } from '@supabase/supabase-js';

/**
 * @name useSupabaseQuery
 * @description Fetches table data from a data provider and returns the retrieved data,
 * count, error status, and loading status.
 */
export function useSupabaseQuery<
  Client extends SupabaseClient<DataLoader.GenericDatabase>,
  TableName extends keyof DataLoader.Tables<DataLoader.ExtractDatabase<Client>>,
  Selection extends DataLoader.Query<
    DataLoader.ExtractDatabase<Client>,
    TableName
  > = DataLoader.StarOperator,
  Single extends boolean = false,
  CamelCase extends boolean = false
>(
  props: DataLoader.DataLoaderProps<Client, TableName, Selection, Single, CamelCase>,
): {
  data: DataLoader.TransformData<
    DataLoader.Data<DataLoader.ExtractDatabase<Client>, TableName, Selection>,
    CamelCase,
    Single
  >;
  count: number;
  error: Error | null;
  isLoading: boolean;
} {
  const queryKey = [
    props.table,
    props.select ?? '*',
    props.where,
    props.count,
    props.limit,
    props.page,
    props.single,
    props.sort,
  ].filter(Boolean);

  const { data, error, isLoading } = useQuery<{
    data: DataLoader.TransformData<
      DataLoader.Data<DataLoader.ExtractDatabase<Client>, TableName, Selection>,
      CamelCase,
      Single
    >;
    count: number;
  }>({
    queryKey,
    queryFn: () =>
      fetchDataFromSupabase<Client, TableName, Selection, Single, CamelCase>(props),
  });

  if (!data) {
    return {
      data: (props.single ? undefined : []) as DataLoader.TransformData<
        DataLoader.Data<DataLoader.ExtractDatabase<Client>, TableName, Selection>,
        CamelCase,
        Single
      >,
      count: 0,
      error,
      isLoading,
    };
  }

  return {
    data: data.data,
    count: data.count,
    error,
    isLoading,
  };
}
