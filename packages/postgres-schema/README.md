# @makerkit/postgres-schema

Lets coding agents read your Postgres schema instead of guessing it: tables, columns, primary and foreign keys, indexes, functions (with security definer/invoker) and enums. It reads the live database, and can also read declarative SQL schema files such as Supabase's `supabase/schemas`.

Works with any Postgres database: Supabase, Neon, RDS, local Docker, and apps using Drizzle or Prisma.

## Tools

| Tool | Returns |
|---|---|
| `get_database_summary` | Counts, tables, enums and functions in one call |
| `get_database_tables` | Every table in the included schemas |
| `get_table_info` | Columns, foreign keys and indexes for one table (`schema.table` accepted) |
| `get_database_functions` / `get_function_details` / `search_database_functions` | Functions with parameters, return type and security level |
| `get_all_enums` / `get_enum_info` | Enum types and their values |
| `get_schema_files` / `get_schema_content` / `get_schemas_by_topic` / `get_schema_by_section` | Your SQL schema files (only when `schemaFiles` is configured) |

When the database is not running, the tools fall back to the schema files if you configured them.

## Use from code

```ts
import { createDatabaseService } from '@makerkit/postgres-schema';
import { createPostgresSchemaDeps } from '@makerkit/postgres-schema/node';

const deps = createPostgresSchemaDeps(process.cwd(), {
  databaseUrl: process.env.DATABASE_URL,
});

const db = createDatabaseService(deps);
const users = await db.getTableInfo({ schema: 'public', tableName: 'users' });

await deps.close?.();
```

### Settings

```ts
createPostgresSchemaDeps(root, {
  databaseUrl,
  settings: {
    includeSchemas: ['public'], // default
    excludeTables: ['_prisma_migrations'],
    schemaFiles: { dir: 'supabase/schemas' },
    functionPurposes: { has_role_on_account: 'Check access to an account' },
  },
});
```

## Add the tools to an MCP server

Requires `@modelcontextprotocol/sdk`.

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createDatabaseService } from '@makerkit/postgres-schema';
import { registerPostgresSchemaTools } from '@makerkit/postgres-schema/mcp';
import { createPostgresSchemaDeps } from '@makerkit/postgres-schema/node';

const server = new McpServer({ name: 'postgres-schema', version: '1.0.0' });

registerPostgresSchemaTools(
  server,
  createDatabaseService(createPostgresSchemaDeps(process.cwd())),
);
```

## License

MIT
