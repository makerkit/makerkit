import {
  DataLoader,
  fetchDataFromSupabase,
} from '@makerkit/data-loader-supabase-core';

import { SupabaseClient } from '@supabase/supabase-js';

const PAGE_SIZE = 10;

/**
 * Represents an interface for loading server data using a Data Loader.
 */
export interface ServerDataLoaderProps<
  Client extends SupabaseClient<DataLoader.GenericDatabase>,
  TableName extends keyof DataLoader.Tables<DataLoader.ExtractDatabase<Client>>,
  Query extends DataLoader.Query<
    DataLoader.ExtractDatabase<Client>,
    TableName
  > = DataLoader.StarOperator,
  Single extends boolean = false,
  CamelCase extends boolean = false,
> extends DataLoader.DataLoaderProps<Client, TableName, Query, Single, CamelCase> {
  children: (props: {
    data: DataLoader.TransformData<DataLoader.Data<
      DataLoader.ExtractDatabase<Client>,
      TableName,
      Query
    >, CamelCase, Single>;
    error: Error | null;
    count: number;
    page: number;
    pageSize: number;
    pageCount: number;
  }) => React.ReactElement;
}

/**
 * Retrieves data from the server based on the specified props.
 *
 * @async
 * @param {Object} props - The properties required to fetch the data from the server.
 * @param {string} props.tableName - The name of the table to fetch data from.
 * @param {Object} props.selection - The selection criteria for the data retrieval.
 * @param {Object} props.data - The data retrieved from the server.
 * @param {number} props.count - The total number of items available in the server.
 * @param {number} props.page - The current page number.
 * @param {number} props.pageCount - The total number of pages available.
 * @param {number} props.pageSize - The number of items per page.
 *
 * @throws {Error} - If the data retrieval from the server fails.
 */
export async function ServerDataLoader<
  Client extends SupabaseClient<DataLoader.GenericDatabase>,
  TableName extends keyof DataLoader.Tables<DataLoader.ExtractDatabase<Client>>,
  Query extends DataLoader.Query<
    DataLoader.ExtractDatabase<Client>,
    TableName
  > = DataLoader.StarOperator,
  Single extends boolean = false,
  CamelCase extends boolean = false,
>(props: ServerDataLoaderProps<Client, TableName, Query, Single, CamelCase>) {
  const response = await fetchDataFromSupabase<
    Client,
    TableName,
    Query,
    Single,
    CamelCase
  >(props);

  const pageSize = props.limit ?? PAGE_SIZE;
  const pageCount = Math.ceil(response.count / pageSize);

  return props.children({
    ...response,
    page: props.page ?? 1,
    pageCount,
    pageSize,
  });
}
