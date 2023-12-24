import { SupabaseClient } from '@supabase/supabase-js';
import { DataLoader } from './data-loader-types';

/**
 * Builds a query for a Supabase data provider.
 *
 */
export async function supabaseDataLoader<
  Client extends SupabaseClient<DataLoader.GenericDatabase>,
  TableName extends keyof DataLoader.Tables<DataLoader.ExtractDatabase<Client>>,
  Query extends DataLoader.Query<DataLoader.ExtractDatabase<Client>, TableName> = DataLoader.StarOperator,
  Single extends boolean | undefined = false,
>(
  props: DataLoader.DataLoaderProps<Client, TableName, Query, Single>,
) {
  type Data = DataLoader.Data<DataLoader.ExtractDatabase<Client>, TableName, Query>;

  const {
    client,
    table,
    where,
    sort,
    select = '*',
    page = 1,
    limit = 8,
    count = 'exact',
  } = props;

  let selectString: string;

  if (Array.isArray(select)) {
    const selectedProperties = select as Array<string>;
    const joins = new Map<string, string[]>();

    const value = [];

    for (let n = 0; n < selectedProperties.length; n++) {
      const property = selectedProperties[n];

      if (property.split('.').length > 1) {
        const [table, column] = property.split('.');

        joins.set(table, [...(joins.get(table) ?? []), column]);
      } else {
        value.push(property);
      }
    }

    for (const [table, columns] of Array.from(joins.entries())) {
      value.push(`${table} !inner (${columns.join(',')})`);
    }

    selectString = value.join(',');
  } else {
    selectString = select;
  }

  const tableRef = client.from(table as string);

  let query = tableRef.select(selectString, {
    count: count ?? 'exact',
  });

  if (where) {
    const properties = Object.keys(where) as Array<
      keyof DataLoader.Row<DataLoader.ExtractDatabase<Client>, TableName>
    >;

    for (const property of properties) {
      const operatorMap = where[property];

      if (!operatorMap) {
        continue;
      }

      const operators = Object.keys(
        operatorMap ?? {},
      ) as DataLoader.Operators[];

      for (const operator of operators) {
        // we need to cast this to a string
        const propertyName = property as string;

        switch (operator) {
          case 'eq': {
            const value = operatorMap[operator];
            if (value === undefined || value === null) continue;

            query = query.eq(propertyName, value);

            break;
          }

          case 'neq': {
            const value = operatorMap[operator];
            if (value === undefined || value === null) continue;

            query = query.neq(propertyName, value);

            break;
          }

          case 'in': {
            const value = operatorMap[operator];
            if (value === undefined) continue;

            query = query.in(propertyName, value);

            break;
          }

          case 'like': {
            const value = operatorMap[operator];
            if (value === undefined) continue;

            query = query.like(propertyName, value);
            break;
          }

          case 'ilike': {
            const value = operatorMap[operator];
            if (value === undefined) continue;

            query = query.ilike(propertyName, value);
            break;
          }

          case 'gt': {
            const value = operatorMap[operator];
            if (value === undefined) continue;

            query = query.gt(propertyName, value);
            break;
          }

          case 'lt': {
            const value = operatorMap[operator];
            if (value === undefined) continue;

            query = query.lt(propertyName, value);
            break;
          }

          case 'gte': {
            const value = operatorMap[operator];
            if (value === undefined) continue;

            query = query.gte(propertyName, value);
            break;
          }

          case 'lte': {
            const value = operatorMap[operator];
            if (value === undefined) continue;

            query = query.lte(propertyName, value);
            break;
          }

          case 'textSearch': {
            const value = operatorMap[operator];
            if (value === undefined) continue;

            query = query.textSearch(propertyName, value);
            break;
          }

          case 'containedBy': {
            const value = operatorMap[operator];
            if (!Array.isArray(value)) continue;

            query = query.containedBy(propertyName, value);
            break;
          }

          case 'contains': {
            const value = operatorMap[operator];
            if (!Array.isArray(value)) continue;

            query = query.contains(propertyName, value);
            break;
          }

          case 'not': {
            const value = operatorMap[
              operator
            ] as DataLoader.GetOperatorOperation<
              DataLoader.ExtractDatabase<Client>,
              TableName,
              typeof property,
              'not'
            >;

            if (value === undefined) continue;

            for (const key in value) {
              if (key in value) {
                const operatorKey = key as keyof typeof value;
                const operatorValue = value[operatorKey];

                query = query.not(propertyName, key, operatorValue);
              }
            }

            break;
          }

          case 'is': {
            const value = operatorMap[operator];
            if (value === undefined) continue;

            query = query.is(propertyName, value);

            break;
          }
        }
      }
    }
  }

  // do not apply pagination and sorting
  // if the user wants a single item
  if (!props.single) {
    if (sort) {
      for (const key in sort) {
        query = query.order(key, { ascending: sort[key] === 'asc' });
      }
    }

    if (page && limit) {
      const startOffset = (page - 1) * limit;
      const endOffset = startOffset + limit;

      query = query.range(startOffset, endOffset);
    }

    if (limit) {
      query = query.limit(limit);
    }
  }

  if (props.single) {
    const response = await query;
    const value = (response.data ?? undefined) as Data | undefined;

    return {
      data: value,
      count: response.count ?? 0,
    } as {
      data: Single extends true
        ? Data | undefined
        : Data[]
      count: number;
    };
  }

  const response = await query;

  return {
    data: response.data ?? [],
    count: response.count ?? 0,
  } as {
    data: Single extends true
      ? Data | undefined
      : Data[];
    count: number;
  };
}
