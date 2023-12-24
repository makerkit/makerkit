import type { QueryData, SupabaseClient } from '@supabase/supabase-js';
import type { PostgrestFilterBuilder } from '@supabase/postgrest-js';

import type { GetResult } from '@supabase/postgrest-js/dist/module/select-query-parser';
import { GenericSchema } from '@supabase/postgrest-js/dist/module/types';

export namespace DataLoader {
  export type GenericDatabase = {
    public: GenericSchema;
  };

  type Eq = 'eq';
  type Neq = 'neq';
  type Lt = 'lt';
  type Gt = 'gt';
  type Lte = 'lte';
  type Gte = 'gte';
  type Like = 'like';
  type Ilike = 'ilike';
  type In = 'in';
  type Contains = 'contains';
  type ContainedBy = 'containedBy';
  type RangeGt = 'rangeGt';
  type RangeLt = 'rangeLt';
  type RangeGte = 'rangeGte';
  type RangeLte = 'rangeLte';
  type TextSearch = 'textSearch';
  type Not = 'not';
  type Or = 'or';
  type Is = 'is';

  type Keys<A> = keyof A;
  type Values<A> = A[Keys<A>];

  export type Operators =
    | Eq
    | Neq
    | Lt
    | Gt
    | Lte
    | Gte
    | Like
    | Ilike
    | In
    | Contains
    | ContainedBy
    | RangeGt
    | RangeLt
    | RangeGte
    | RangeLte
    | TextSearch
    | Not
    | Or
    | Is;

  export type StarOperator = '*';

  export type Tables<Database extends GenericDatabase> =
    Database['public']['Tables'];

  export type Table<
    Database extends GenericDatabase,
    TableName extends keyof Tables<Database>,
  > = Tables<Database>[TableName] & {
    Relationships: Array<{
      foreignKeyName: string;
      columns: string[];
      isOneToOne: boolean;
      referencedRelation: string;
      referencedColumns: string[];
    }>;
  };

  export type Row<
    Database extends GenericDatabase,
    TableName extends keyof Tables<Database>,
  > = Table<Database, TableName>['Row'];

  export type Relationships<
    Database extends GenericDatabase,
    TableName extends keyof Tables<Database>,
  > = Table<Database, TableName>['Relationships'];

  type Relationship<
    Database extends GenericDatabase,
    TableName extends keyof Tables<Database>,
  > = Relationships<Database, TableName>[number];

  type ReferencedRelation<
    Database extends GenericDatabase,
    TableName extends keyof Tables<Database>,
  > = Relationship<Database, TableName>['referencedRelation'];

  type ReferencedRelationObject<
    Database extends GenericDatabase,
    TableName extends keyof Tables<Database>,
    SubTable extends keyof Tables<Database>,
  > = Extract<
    Relationships<Database, TableName>[number],
    {
      referencedRelation: SubTable;
    }
  >;

  export type RelationFieldsRow<
    Database extends GenericDatabase,
    TableName extends keyof Tables<Database>,
    SubTable extends ReferencedRelation<Database, TableName>,
  > = {
    table: SubTable;
    relation: ReferencedRelationObject<
      Database,
      TableName,
      SubTable
    >['referencedRelation'];
    relationName: `${Extract<
      ReferencedRelationObject<
        Database,
        TableName,
        SubTable
      >['referencedRelation'],
      string
    >}`;
    target: keyof Row<Database, SubTable>;
    value: Row<Database, SubTable>[keyof Row<Database, SubTable>];
    field: `${Extract<
      ReferencedRelationObject<
        Database,
        TableName,
        SubTable
      >['columns'][number],
      string
    >}.${Extract<keyof Row<Database, SubTable>, string>}`;
  };

  type KeysFromNestedProps<
    Database extends GenericDatabase,
    TableName extends keyof Tables<Database>,
  > = Values<{
    [K in ReferencedRelation<Database, TableName>]: RelationFieldsRow<
      Database,
      TableName,
      K
    >['field'];
  }>;

  type SelectionFields<
    Database extends GenericDatabase,
    TableName extends keyof Tables<Database>,
  > = keyof Row<Database, TableName> | KeysFromNestedProps<Database, TableName>;

  export type TableSelection<
    Database extends GenericDatabase,
    TableName extends keyof Tables<Database>,
  > = Array<SelectionFields<Database, TableName>>;

  export type Query<
    Database extends GenericDatabase,
    TableName extends keyof Tables<Database>,
  > =
    // | string TODO: enable when joins fixed in postgrest-js
    StarOperator | TableSelection<Database, TableName>;

  export type CountType = 'exact' | 'estimated';

  export type TableNames<Database extends GenericDatabase> =
    keyof Tables<Database>;

  type ExtractSubTable<
    Database extends GenericDatabase,
    TableName extends keyof Tables<Database>,
    Column extends string,
  > = Extract<
    Relationship<Database, TableName>,
    {
      columns: [Column];
    }
  >['referencedRelation'];

  type GetValueFromNestedProps<
    Database extends GenericDatabase,
    TableName extends keyof Tables<Database>,
    Property extends SelectionFields<Database, TableName>,
  > = Property extends keyof Row<Database, TableName>
    ? Row<Database, TableName>[Property]
    : Property extends KeysFromNestedProps<Database, TableName>
    ? Property extends `${infer P}.${infer R}`
      ? R extends keyof Row<Database, ExtractSubTable<Database, TableName, P>>
        ? Row<Database, ExtractSubTable<Database, TableName, P>>[R]
        : never
      : never
    : never;

  export type GetOperatorOperation<
    Database extends GenericDatabase,
    TableName extends keyof Tables<Database>,
    Property extends SelectionFields<Database, TableName>,
    Operator extends Operators,
  > = Operator extends Eq
    ? GetValueFromNestedProps<Database, TableName, Property>
    : Operator extends Lt
    ? GetValueFromNestedProps<Database, TableName, Property>
    : Operator extends Gt
    ? GetValueFromNestedProps<Database, TableName, Property>
    : Operator extends Lte
    ? GetValueFromNestedProps<Database, TableName, Property>
    : Operator extends Gte
    ? GetValueFromNestedProps<Database, TableName, Property>
    : Operator extends Like
    ? string
    : Operator extends Ilike
    ? string
    : Operator extends In
    ? Array<GetValueFromNestedProps<Database, TableName, Property>>
    : Operator extends Contains
    ? GetValueFromNestedProps<Database, TableName, Property>
    : Operator extends ContainedBy
    ? Array<GetValueFromNestedProps<Database, TableName, Property>>
    : Operator extends RangeGt
    ? GetValueFromNestedProps<Database, TableName, Property>
    : Operator extends RangeLt
    ? GetValueFromNestedProps<Database, TableName, Property>
    : Operator extends RangeGte
    ? GetValueFromNestedProps<Database, TableName, Property>
    : Operator extends RangeLte
    ? GetValueFromNestedProps<Database, TableName, Property>
    : Operator extends TextSearch
    ? string
    : Operator extends Not
    ? {
        [k in Exclude<Operators, Not>]?: GetOperatorOperation<
          Database,
          TableName,
          Property,
          k
        >;
      }
    : Operator extends Is
    ? boolean | null
    : never;

  export type FilterOperation<
    Database extends GenericDatabase,
    TableName extends keyof Tables<Database>,
    Property extends SelectionFields<Database, TableName>,
  > = {
    [k in Operators]?: GetOperatorOperation<Database, TableName, Property, k>;
  };

  export type SortBy<
    Database extends GenericDatabase,
    Table extends TableNames<Database>,
  > = {
    [key in keyof Row<Database, Table>]?: 'asc' | 'desc';
  };

  type ExtractNested<T> = T extends `${infer P}.${infer R}`
    ? {
        original: never;
        parent: P;
        field: R;
      }
    : {
        original: T;
        parent: never;
        field: never;
      };

  type MappedField<
    Database extends GenericDatabase,
    TableName extends keyof Tables<Database>,
    Field extends
      | keyof Row<Database, TableName>
      | KeysFromNestedProps<Database, TableName>,
  > = {
    [key in ExtractNested<Field>['parent']]: {
      [inner in Field extends RelationFieldsRow<
        Database,
        TableName,
        ExtractSubTable<Database, TableName, key>
      >['field']
        ? ExtractNested<Field>['field'] extends keyof Row<
            Database,
            ExtractSubTable<Database, TableName, key>
          >
          ? ExtractNested<Field>['field']
          : never
        : never]: inner extends keyof Row<
        Database,
        ExtractSubTable<Database, TableName, key>
      >
        ? Row<Database, ExtractSubTable<Database, TableName, key>>[inner]
        : never;
    };
  } & {
    [key in ExtractNested<Field>['original'] extends keyof Row<
      Database,
      TableName
    >
      ? ExtractNested<Field>['original']
      : never]: Row<Database, TableName>[key];
  };

  export type Data<
    Database extends GenericDatabase,
    TableName extends keyof Tables<Database>,
    Selection extends Query<Database, TableName> = StarOperator,
  > = Selection extends StarOperator
    ? Row<Database, TableName>
    : Selection extends string
    ? QueryData<
        PostgrestFilterBuilder<
          Database['public'],
          Row<Database, TableName>,
          GetResult<
            Database['public'],
            Row<Database, TableName>,
            TableName,
            Relationships<Database, TableName>,
            Selection
          >,
          Relationships<Database, TableName>
        >
      >
    : Selection extends Array<SelectionFields<Database, TableName>>
    ? MappedField<Database, TableName, Selection[number]>
    : never;

  export type Filter<
    Database extends GenericDatabase,
    Table extends TableNames<Database>,
  > = {
    [key in SelectionFields<Database, Table>]?: FilterOperation<
      Database,
      Table,
      key
    >;
  };

  export interface DataLoaderProps<
    Client extends SupabaseClient<DataLoader.GenericDatabase>,
    TableName extends DataLoader.TableNames<ExtractDatabase<Client>>,
    Query extends DataLoader.Query<ExtractDatabase<Client>, TableName> = StarOperator,
    Single extends boolean | undefined = false,
  > {
    client: Client;
    table: TableName;
    where?: DataLoader.Filter<ExtractDatabase<Client>, TableName>;
    sort?: DataLoader.SortBy<ExtractDatabase<Client>, TableName>;
    page?: number;
    limit?: number;
    count?: DataLoader.CountType;
    select?: Query;
    single?: Single;
  }

  export type ExtractDatabase<Client> = Client extends SupabaseClient<
      infer Database extends DataLoader.GenericDatabase
    >
    ? Database
    : never;
}
