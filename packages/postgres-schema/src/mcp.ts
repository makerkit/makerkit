import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { DatabaseService } from './database.service';
import {
  EmptyInputSchema,
  GetAllEnumsOutputSchema,
  GetDatabaseFunctionsOutputSchema,
  GetDatabaseSummaryOutputSchema,
  GetDatabaseTablesOutputSchema,
  GetEnumInfoInputSchema,
  GetEnumInfoOutputSchema,
  GetFunctionDetailsInputSchema,
  GetFunctionDetailsOutputSchema,
  GetSchemaBySectionInputSchema,
  GetSchemaBySectionOutputSchema,
  GetSchemaContentInputSchema,
  GetSchemaContentOutputSchema,
  GetSchemaFilesOutputSchema,
  GetSchemasByTopicInputSchema,
  GetSchemasByTopicOutputSchema,
  GetTableInfoInputSchema,
  GetTableInfoOutputSchema,
  SearchDatabaseFunctionsInputSchema,
  SearchDatabaseFunctionsOutputSchema,
} from './schema';
import {
  READ_ONLY_TOOL,
  buildErrorResponse,
  buildStructuredResponse,
} from './tool-response';

export interface RegisterPostgresSchemaOptions {
  /** Prepended to every tool name. */
  prefix?: string;
}

/**
 * Registers the database tools. The schema-file tools (get_schema_files,
 * get_schema_content, get_schemas_by_topic, get_schema_by_section) are only
 * registered when the service has schema files configured.
 */
export function registerPostgresSchemaTools(
  server: McpServer,
  service: DatabaseService,
  options: RegisterPostgresSchemaOptions = {},
) {
  const name = (tool: string) => `${options.prefix ?? ''}${tool}`;

  if (service.hasSchemaFiles) {
    server.registerTool(
      name('get_schema_files'),
      {
        title: 'List schema files',
        description:
          'List the declarative schema files (source of truth for the current database state) with their tables, functions and topics.',
        inputSchema: EmptyInputSchema,
        outputSchema: GetSchemaFilesOutputSchema,
        annotations: READ_ONLY_TOOL,
      },
      async () => {
        try {
          return buildStructuredResponse(await service.listSchemaFiles());
        } catch (error) {
          return buildErrorResponse(name('get_schema_files'), error);
        }
      },
    );

    server.registerTool(
      name('get_schema_content'),
      {
        title: 'Read a schema file',
        description:
          'Read one declarative schema file by name (current database state).',
        inputSchema: GetSchemaContentInputSchema,
        outputSchema: GetSchemaContentOutputSchema,
        annotations: READ_ONLY_TOOL,
      },
      async (input) => {
        try {
          const parsed = GetSchemaContentInputSchema.parse(input);

          return buildStructuredResponse(
            await service.getSchemaContent(parsed),
          );
        } catch (error) {
          return buildErrorResponse(name('get_schema_content'), error);
        }
      },
    );

    server.registerTool(
      name('get_schemas_by_topic'),
      {
        title: 'Find schema files by topic',
        description:
          'Find schema files by topic (accounts, auth, billing, permissions, teams, notifications, storage, admin). Fastest way to locate relevant SQL.',
        inputSchema: GetSchemasByTopicInputSchema,
        outputSchema: GetSchemasByTopicOutputSchema,
        annotations: READ_ONLY_TOOL,
      },
      async (input) => {
        try {
          const parsed = GetSchemasByTopicInputSchema.parse(input);

          return buildStructuredResponse(
            await service.getSchemasByTopic(parsed),
          );
        } catch (error) {
          return buildErrorResponse(name('get_schemas_by_topic'), error);
        }
      },
    );

    server.registerTool(
      name('get_schema_by_section'),
      {
        title: 'Find a schema file by section',
        description:
          'Get the schema file whose header declares the given section name (Accounts, Permissions, ...).',
        inputSchema: GetSchemaBySectionInputSchema,
        outputSchema: GetSchemaBySectionOutputSchema,
        annotations: READ_ONLY_TOOL,
      },
      async (input) => {
        try {
          const parsed = GetSchemaBySectionInputSchema.parse(input);

          return buildStructuredResponse(
            await service.getSchemaBySection(parsed),
          );
        } catch (error) {
          return buildErrorResponse(name('get_schema_by_section'), error);
        }
      },
    );
  }

  server.registerTool(
    name('get_database_functions'),
    {
      title: 'List database functions',
      description:
        'List database functions in the public and kit schemas with parameters, return type, SECURITY DEFINER/INVOKER and source file. Uses the live database when available, schema files otherwise.',
      inputSchema: EmptyInputSchema,
      outputSchema: GetDatabaseFunctionsOutputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async () => {
      try {
        return buildStructuredResponse(await service.getFunctions());
      } catch (error) {
        return buildErrorResponse(name('get_database_functions'), error);
      }
    },
  );

  server.registerTool(
    name('get_function_details'),
    {
      title: 'Describe a database function',
      description:
        'Get one database function by name (optionally schema-qualified). SECURITY DEFINER functions bypass RLS; treat them carefully.',
      inputSchema: GetFunctionDetailsInputSchema,
      outputSchema: GetFunctionDetailsOutputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async (input) => {
      try {
        const parsed = GetFunctionDetailsInputSchema.parse(input);

        return buildStructuredResponse(
          await service.getFunctionDetails(parsed),
        );
      } catch (error) {
        return buildErrorResponse(name('get_function_details'), error);
      }
    },
  );

  server.registerTool(
    name('search_database_functions'),
    {
      title: 'Search database functions',
      description:
        'Search database functions by name, description, purpose or return type.',
      inputSchema: SearchDatabaseFunctionsInputSchema,
      outputSchema: SearchDatabaseFunctionsOutputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async (input) => {
      try {
        const parsed = SearchDatabaseFunctionsInputSchema.parse(input);

        return buildStructuredResponse(await service.searchFunctions(parsed));
      } catch (error) {
        return buildErrorResponse(name('search_database_functions'), error);
      }
    },
  );

  server.registerTool(
    name('get_database_summary'),
    {
      title: 'Database overview',
      description:
        'Overview of tables, enums and functions grouped by topic. Good first call before deeper lookups.',
      inputSchema: EmptyInputSchema,
      outputSchema: GetDatabaseSummaryOutputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async () => {
      try {
        return buildStructuredResponse(await service.getSummary());
      } catch (error) {
        return buildErrorResponse(name('get_database_summary'), error);
      }
    },
  );

  server.registerTool(
    name('get_database_tables'),
    {
      title: 'List tables',
      description:
        'List project tables in the public and kit schemas with their source schema file and topic.',
      inputSchema: EmptyInputSchema,
      outputSchema: GetDatabaseTablesOutputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async () => {
      try {
        return buildStructuredResponse(await service.getTables());
      } catch (error) {
        return buildErrorResponse(name('get_database_tables'), error);
      }
    },
  );

  server.registerTool(
    name('get_table_info'),
    {
      title: 'Describe a table',
      description:
        'Columns, foreign keys, indexes and the CREATE TABLE statement for one table. Live database data when available, schema-file parsing otherwise.',
      inputSchema: GetTableInfoInputSchema,
      outputSchema: GetTableInfoOutputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async (input) => {
      try {
        const parsed = GetTableInfoInputSchema.parse(input);

        return buildStructuredResponse(await service.getTableInfo(parsed));
      } catch (error) {
        return buildErrorResponse(name('get_table_info'), error);
      }
    },
  );

  server.registerTool(
    name('get_enum_info'),
    {
      title: 'Describe an enum',
      description: 'Get one enum type with all of its values.',
      inputSchema: GetEnumInfoInputSchema,
      outputSchema: GetEnumInfoOutputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async (input) => {
      try {
        const parsed = GetEnumInfoInputSchema.parse(input);

        return buildStructuredResponse(await service.getEnumInfo(parsed));
      } catch (error) {
        return buildErrorResponse(name('get_enum_info'), error);
      }
    },
  );

  server.registerTool(
    name('get_all_enums'),
    {
      title: 'List enums',
      description: 'List every enum type in the public schema with its values.',
      inputSchema: EmptyInputSchema,
      outputSchema: GetAllEnumsOutputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async () => {
      try {
        return buildStructuredResponse(await service.listEnums());
      } catch (error) {
        return buildErrorResponse(name('get_all_enums'), error);
      }
    },
  );
}
