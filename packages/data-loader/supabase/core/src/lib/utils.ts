import { SupabaseClient } from '@supabase/supabase-js';
import { DataLoader } from './data-loader-types';

/**
 * Builds a SQL query string for Postgrest based on the specified select parameter.
 */
export function buildPostgrestQuery<
  Client extends SupabaseClient<DataLoader.GenericDatabase>,
  TableName extends keyof DataLoader.Tables<DataLoader.ExtractDatabase<Client>>,
>(
  select: DataLoader.Query<DataLoader.ExtractDatabase<Client>, TableName>,
  defaultSelect: string = '*',
) {
  if (!select) {
    return defaultSelect;
  }

  let selectString: string = defaultSelect;

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
      value.push(`${table} (${columns.join(',')})`);
    }

    selectString = value.join(',');
  } else {
    selectString = select;
  }

  return selectString;
}
