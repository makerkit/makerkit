import { SupabaseClient } from '@supabase/supabase-js';
import { DataLoader, supabaseDataLoader } from '@makerkit/data-loader-supabase-core';
import { objectToCamel, ObjectToCamel } from 'ts-case-convert/lib/caseConvert';

const PAGE_SIZE = 10;

type TransformData<
  Data extends object,
  CamelCase extends boolean
> = CamelCase extends true ? ObjectToCamel<Data> : Data;

type ReturnData<
  Database extends DataLoader.GenericDatabase,
  TableName extends keyof DataLoader.Tables<Database>,
  Query extends DataLoader.Query<Database, TableName> = DataLoader.StarOperator,
  Single extends boolean = false,
  CamelCase extends boolean = false,
> = Single extends true ?
  TransformData<DataLoader.Data<Database, TableName, Query>, CamelCase> | undefined :
  Array<TransformData<DataLoader.Data<Database, TableName, Query>, CamelCase>>;

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
> extends DataLoader.DataLoaderProps<Client, TableName, Query, Single> {
  camelCase?: CamelCase;

  children: (props: {
    data: ReturnData<DataLoader.ExtractDatabase<Client>, TableName, Query, Single, CamelCase>,
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
  Query extends DataLoader.Query<DataLoader.ExtractDatabase<Client>, TableName> = DataLoader.StarOperator,
  Single extends boolean = false,
  CamelCase extends boolean = false,
>(props: ServerDataLoaderProps<Client, TableName, Query, Single, CamelCase>) {
  const { data, count, page, pageCount, pageSize } = await fetchData<
    Client,
    TableName,
    Query,
    Single
  >(props);

  const transformedData = (props.camelCase ?
    Array.isArray(data) ? data.map(objectToCamel) : data ? objectToCamel(data) : undefined : data) as ReturnData<DataLoader.ExtractDatabase<Client>, TableName, Query, Single, CamelCase>;

  return props.children({
    data: transformedData,
    count,
    page,
    pageCount,
    pageSize,
  });
}

async function fetchData<
  Client extends SupabaseClient<DataLoader.GenericDatabase>,
  TableName extends keyof DataLoader.Tables<DataLoader.ExtractDatabase<Client>>,
  Query extends DataLoader.Query<DataLoader.ExtractDatabase<Client>, TableName> = DataLoader.StarOperator,
  Single extends boolean = false,
>(
  props: DataLoader.DataLoaderProps<Client, TableName, Query, Single>,
) {
  const { data, count } = await supabaseDataLoader<
    Client,
    TableName,
    Query,
    Single
  >(props);

  const pageSize = props.limit ?? PAGE_SIZE;
  const pageCount = Math.ceil(count / pageSize);

  return {
    data,
    count: count ?? 0,
    page: props.page ?? 1,
    pageCount,
    pageSize,
  };
}
