import useQuery from 'swr';
import {
  DataLoader,
  supabaseDataLoader,
} from '@makerkit/data-loader-supabase-core';
import { SupabaseClient } from '@supabase/supabase-js';

type DataType<Single extends boolean, Data extends object> = Single extends true
  ? Data | undefined
  : Data[];

/**
 * @name useTableFetcher
 * @description Fetches table data from a data provider and returns the retrieved data,
 * count, error status, and loading status.
 */
export function useTableFetcher<
  Client extends SupabaseClient<DataLoader.GenericDatabase>,
  TableName extends keyof DataLoader.Tables<DataLoader.ExtractDatabase<Client>>,
  Selection extends DataLoader.Query<
    DataLoader.ExtractDatabase<Client>,
    TableName
  > = DataLoader.StarOperator,
  Single extends boolean = false,
>(
  props: DataLoader.DataLoaderProps<Client, TableName, Selection, Single>,
): {
  data: DataType<
    Single,
    DataLoader.Data<DataLoader.ExtractDatabase<Client>, TableName, Selection>
  >;
  count: number;
  error: Error | null;
  isLoading: boolean;
} {
  const { data, error, isLoading } = useQuery<{
    data: DataType<
      Single,
      DataLoader.Data<DataLoader.ExtractDatabase<Client>, TableName, Selection>
    >;
    count: number;
  }>(() => {
    return supabaseDataLoader<Client, TableName, Selection, Single>(props);
  });

  if (!data) {
    return {
      data: (props.single ? undefined : []) as DataType<
        Single,
        DataLoader.Data<
          DataLoader.ExtractDatabase<Client>,
          TableName,
          Selection
        >
      >,
      count: 0,
      error,
      isLoading: true,
    };
  }

  return {
    data: data.data,
    count: data.count,
    error,
    isLoading,
  };
}
