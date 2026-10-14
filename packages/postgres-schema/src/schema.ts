import { z } from 'zod/v3';

// Domain objects keep camelCase because the dev-tool app renders them
// directly and older text responses already serialised these exact shapes.

export const SchemaFileSchema = z.object({
  name: z.string(),
  path: z.string(),
  description: z.string(),
  section: z.string(),
  lastModified: z.string().describe('ISO timestamp'),
  tables: z.array(z.string()),
  functions: z.array(z.string()),
  dependencies: z.array(z.string()),
  topic: z.string(),
});

export const FunctionParameterSchema = z.object({
  name: z.string(),
  type: z.string(),
  defaultValue: z.string().optional(),
});

export const DatabaseFunctionSchema = z.object({
  name: z.string(),
  schema: z.string(),
  parameters: z.array(FunctionParameterSchema),
  returnType: z.string(),
  description: z.string(),
  purpose: z.string(),
  securityLevel: z.enum(['definer', 'invoker']),
  sourceFile: z.string(),
});

export const ProjectTableSchema = z.object({
  name: z.string(),
  schema: z.string(),
  sourceFile: z.string(),
  topic: z.string(),
});

export const TableColumnSchema = z.object({
  name: z.string(),
  type: z.string(),
  nullable: z.boolean(),
  defaultValue: z.string().optional(),
  isPrimaryKey: z.boolean(),
  isForeignKey: z.boolean(),
  referencedTable: z.string().optional(),
  referencedColumn: z.string().optional(),
});

export const TableIndexSchema = z.object({
  name: z.string(),
  columns: z.array(z.string()),
  unique: z.boolean(),
  type: z.string(),
  definition: z.string(),
});

export const TableForeignKeySchema = z.object({
  name: z.string(),
  columns: z.array(z.string()),
  referencedTable: z.string(),
  referencedColumns: z.array(z.string()),
  onDelete: z.string().optional(),
  onUpdate: z.string().optional(),
});

export const TableInfoSchema = z.object({
  name: z.string(),
  schema: z.string(),
  sourceFile: z.string(),
  topic: z.string(),
  columns: z.array(TableColumnSchema),
  foreignKeys: z.array(TableForeignKeySchema),
  indexes: z.array(TableIndexSchema),
  createStatement: z.string().optional(),
  /** Whether column/index data came from the live database or file parsing. */
  source: z.enum(['database', 'schema_files']),
});

export const EnumInfoSchema = z.object({
  name: z.string(),
  values: z.array(z.string()),
  sourceFile: z.string(),
});

// Inputs

export const EmptyInputSchema = z.object({});

export const GetSchemaContentInputSchema = z.object({
  fileName: z.string().min(1).describe('e.g. 03-accounts.sql'),
});

export const GetSchemasByTopicInputSchema = z.object({
  topic: z
    .string()
    .min(1)
    .describe(
      'accounts, auth, billing, permissions, teams, notifications, storage, admin, security, types, configuration',
    ),
});

export const GetSchemaBySectionInputSchema = z.object({
  section: z.string().min(1),
});

export const GetFunctionDetailsInputSchema = z.object({
  functionName: z
    .string()
    .min(1)
    .describe(
      'Function name, optionally schema-qualified (kit.has_permission)',
    ),
});

export const SearchDatabaseFunctionsInputSchema = z.object({
  query: z.string().min(1),
});

export const GetTableInfoInputSchema = z.object({
  schema: z.string().default('public'),
  tableName: z.string().min(1),
});

export const GetEnumInfoInputSchema = z.object({
  enumName: z.string().min(1),
});

// Outputs

export const GetSchemaFilesOutputSchema = z.object({
  files: z.array(SchemaFileSchema),
  total: z.number().int().min(0),
  schemas_dir: z.string(),
  note: z.string(),
});

export const GetSchemaContentOutputSchema = z.object({
  fileName: z.string(),
  path: z.string(),
  content: z.string(),
});

export const GetSchemasByTopicOutputSchema = z.object({
  topic: z.string(),
  files: z.array(SchemaFileSchema),
  total: z.number().int().min(0),
  available_topics: z.array(z.string()),
});

export const GetSchemaBySectionOutputSchema = z.object({
  section: z.string(),
  file: SchemaFileSchema.nullable(),
  available_sections: z.array(z.string()),
});

export const GetDatabaseFunctionsOutputSchema = z.object({
  functions: z.array(DatabaseFunctionSchema),
  total: z.number().int().min(0),
  source: z.enum(['database', 'schema_files']),
});

export const GetFunctionDetailsOutputSchema = DatabaseFunctionSchema;

export const SearchDatabaseFunctionsOutputSchema = z.object({
  query: z.string(),
  functions: z.array(DatabaseFunctionSchema),
  total: z.number().int().min(0),
});

export const GetDatabaseSummaryOutputSchema = z.object({
  overview: z.object({
    totalTables: z.number().int().min(0),
    totalEnums: z.number().int().min(0),
    totalFunctions: z.number().int().min(0),
  }),
  tables: z.array(ProjectTableSchema),
  enums: z.array(EnumInfoSchema),
  functions: z.array(
    DatabaseFunctionSchema.pick({
      name: true,
      schema: true,
      purpose: true,
      sourceFile: true,
    }),
  ),
  tablesByTopic: z.record(z.string(), z.array(z.string())),
});

export const GetDatabaseTablesOutputSchema = z.object({
  tables: z.array(ProjectTableSchema),
  total: z.number().int().min(0),
});

export const GetTableInfoOutputSchema = TableInfoSchema;

export const GetEnumInfoOutputSchema = EnumInfoSchema;

export const GetAllEnumsOutputSchema = z.object({
  enums: z.array(EnumInfoSchema),
  total: z.number().int().min(0),
});

export type SchemaFile = z.infer<typeof SchemaFileSchema>;
export type FunctionParameter = z.infer<typeof FunctionParameterSchema>;
export type DatabaseFunction = z.infer<typeof DatabaseFunctionSchema>;
export type ProjectTable = z.infer<typeof ProjectTableSchema>;
export type TableColumn = z.infer<typeof TableColumnSchema>;
export type TableIndex = z.infer<typeof TableIndexSchema>;
export type TableForeignKey = z.infer<typeof TableForeignKeySchema>;
export type TableInfo = z.infer<typeof TableInfoSchema>;
export type EnumInfo = z.infer<typeof EnumInfoSchema>;

export type GetSchemaContentInput = z.infer<typeof GetSchemaContentInputSchema>;
export type GetSchemasByTopicInput = z.infer<
  typeof GetSchemasByTopicInputSchema
>;
export type GetSchemaBySectionInput = z.infer<
  typeof GetSchemaBySectionInputSchema
>;
export type GetFunctionDetailsInput = z.infer<
  typeof GetFunctionDetailsInputSchema
>;
export type SearchDatabaseFunctionsInput = z.infer<
  typeof SearchDatabaseFunctionsInputSchema
>;
export type GetTableInfoInput = z.infer<typeof GetTableInfoInputSchema>;
export type GetEnumInfoInput = z.infer<typeof GetEnumInfoInputSchema>;

export type GetSchemaFilesOutput = z.infer<typeof GetSchemaFilesOutputSchema>;
export type GetSchemaContentOutput = z.infer<
  typeof GetSchemaContentOutputSchema
>;
export type GetSchemasByTopicOutput = z.infer<
  typeof GetSchemasByTopicOutputSchema
>;
export type GetSchemaBySectionOutput = z.infer<
  typeof GetSchemaBySectionOutputSchema
>;
export type GetDatabaseFunctionsOutput = z.infer<
  typeof GetDatabaseFunctionsOutputSchema
>;
export type SearchDatabaseFunctionsOutput = z.infer<
  typeof SearchDatabaseFunctionsOutputSchema
>;
export type GetDatabaseSummaryOutput = z.infer<
  typeof GetDatabaseSummaryOutputSchema
>;
export type GetDatabaseTablesOutput = z.infer<
  typeof GetDatabaseTablesOutputSchema
>;
export type GetAllEnumsOutput = z.infer<typeof GetAllEnumsOutputSchema>;
