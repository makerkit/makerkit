---
'@makerkit/postgres-schema': minor
---

Initial release: database schema tools for coding agents (tables, columns, foreign keys, indexes, functions, enums) for any Postgres database, extracted from the Makerkit kits' MCP servers. Reads the live database first; declarative SQL schema files are optional and enable four extra tools. Included schemas, excluded tables, the default schema, function descriptions and the schema-file topic map are settings.

Fixes found before release: foreign keys to other schemas (e.g. `auth.users`) and composite foreign keys are reported correctly, and columns in a composite key are no longer listed twice; index columns keep key order, expression indexes are listed, and only the primary-key index is skipped; same-named enums in different schemas are no longer merged; `get_table_info` honours `defaultSchema`, accepts quoted names (`public."User"`), and no longer mixes up same-named tables across schemas in schema files; schema-file parsing handles quoted identifiers, `$function$` bodies and one-line tables; IPv6, unix-socket and multi-host database URLs no longer make the database look unreachable.
