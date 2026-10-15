import type {
  DatabaseFunction,
  EnumInfo,
  FunctionParameter,
  TableColumn,
  TableForeignKey,
  TableIndex,
} from './schema';

/**
 * Regex-based extraction from declarative schema files. These are fallbacks
 * for when the local database is not reachable, and metadata helpers for
 * mapping live objects back to their source file. They are intentionally
 * forgiving rather than a full SQL parser.
 */

const IDENTIFIER = '[a-zA-Z_][a-zA-Z0-9_$]*';

/** An unquoted identifier or a double-quoted one ("User", "my ""odd"" name"). */
const NAME = `(?:"(?:[^"]|"")+"|${IDENTIFIER})`;

/** `name` or `schema.name`, capturing the schema (optional) and the name. */
const QUALIFIED = `(?:(${NAME})\\s*\\.\\s*)?(${NAME})`;

export interface QualifiedName {
  /** Null when the SQL left the name unqualified. */
  schema: string | null;
  name: string;
}

export function unquoteIdentifier(value: string) {
  return value.startsWith('"') && value.endsWith('"') && value.length > 1
    ? value.slice(1, -1).replace(/""/g, '"')
    : value;
}

/**
 * Split `schema.table`, `"My Schema"."Table"` or `table` into its parts,
 * honouring quotes so dots inside quoted names do not split them.
 */
export function splitQualifiedName(value: string): string[] {
  const parts = value.match(/"(?:[^"]|"")*"|[^.]+/g) ?? [];

  return parts.map((part) => unquoteIdentifier(part.trim()));
}

function matchQualified(content: string, prefix: string): QualifiedName[] {
  const seen = new Set<string>();
  const names: QualifiedName[] = [];

  for (const match of content.matchAll(
    new RegExp(`${prefix}${QUALIFIED}`, 'gi'),
  )) {
    const schema = match[1] ? unquoteIdentifier(match[1]) : null;
    const name = unquoteIdentifier(match[2]!);
    const key = `${schema ?? ''}.${name}`;

    if (seen.has(key)) continue;

    seen.add(key);
    names.push({ schema, name });
  }

  return names;
}

const CREATE_TABLE_PREFIX =
  'create\\s+(?:(?:global\\s+|local\\s+)?(?:temp|temporary|unlogged)\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?';

/** Tables declared in the file, with the schema they were qualified with. */
export function extractQualifiedTableNames(content: string): QualifiedName[] {
  return matchQualified(content, CREATE_TABLE_PREFIX);
}

export function extractTableNames(content: string): string[] {
  return uniqueNames(extractQualifiedTableNames(content));
}

export function extractFunctionNames(content: string): string[] {
  return uniqueNames(
    matchQualified(content, 'create\\s+(?:or\\s+replace\\s+)?function\\s+'),
  );
}

/** Tables referenced by foreign keys, leaving out Supabase's auth schema. */
export function extractDependencies(content: string): string[] {
  return uniqueNames(
    matchQualified(content, 'references\\s+').filter(
      (ref) => ref.schema !== 'auth',
    ),
  );
}

function uniqueNames(names: QualifiedName[]) {
  return [...new Set(names.map((entry) => entry.name))];
}

/**
 * Headers look like:
 *   * Section: Accounts
 *   * We create the schema for the accounts. ...
 * The description is the first prose line after the Section line.
 */
export function extractSectionHeader(content: string) {
  const lines = content.split('\n');
  const sectionIndex = lines.findIndex((line) => /\*\s*Section:/i.test(line));

  if (sectionIndex === -1) {
    return { section: 'Unknown', description: 'No description available' };
  }

  const section =
    lines[sectionIndex]!.match(/Section:\s*([^\n*]+)/i)?.[1]?.trim() ||
    'Unknown';

  let description = 'No description available';

  for (const line of lines.slice(sectionIndex + 1, sectionIndex + 6)) {
    const text = line.replace(/^\s*\*+\s?/, '').trim();

    if (text.length === 0 || /^[-=*/]+$/.test(text)) continue;

    description = text;
    break;
  }

  return { section, description };
}

/**
 * The CREATE TABLE statement for `schema.tableName`. An unqualified
 * `create table tableName` only counts when `allowUnqualified` is set, i.e.
 * when `schema` is the schema unqualified names resolve to.
 */
export function extractTableDefinition(
  content: string,
  schema: string,
  tableName: string,
  allowUnqualified = true,
): string | null {
  const schemaPart = `${identifierPattern(schema)}\\s*\\.\\s*`;
  const tableRegex = new RegExp(
    `create\\s+(?:(?:global\\s+|local\\s+)?(?:temp|temporary|unlogged)\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?` +
      (allowUnqualified ? `(?:${schemaPart})?` : schemaPart) +
      `${identifierPattern(tableName)}\\s*\\([^;]*?\\);`,
    'gis',
  );

  return content.match(tableRegex)?.[0] ?? null;
}

/** Matches an identifier written bare or double-quoted. */
function identifierPattern(name: string) {
  const quoted = escapeRegex(name.replace(/"/g, '""'));

  return /^[a-zA-Z_][a-zA-Z0-9_$]*$/.test(name)
    ? `(?:"${quoted}"|${escapeRegex(name)})`
    : `"${quoted}"`;
}

export function parseColumns(tableDefinition: string): TableColumn[] {
  const contentMatch = tableDefinition.match(/\(([\s\S]*)\)/);

  if (!contentMatch) return [];

  const columns: TableColumn[] = [];

  // Split on top-level commas, not lines, so one-line definitions and
  // types such as numeric(10, 2) parse too.
  const lines = splitTopLevel(contentMatch[1]!.replace(/--[^\n]*/g, '')).map(
    (line) => line.replace(/\s+/g, ' '),
  );

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (
      lower.startsWith('constraint') ||
      lower.startsWith('primary key') ||
      lower.startsWith('foreign key') ||
      lower.startsWith('unique') ||
      lower.startsWith('check') ||
      lower.startsWith('exclude')
    ) {
      continue;
    }

    const columnMatch = line.match(
      new RegExp(`^(${NAME})\\s+([^,\\s]+)(?:\\s+(.*))?`),
    );

    if (!columnMatch) continue;

    const [, quotedName, type, constraints = ''] = columnMatch;
    const name = unquoteIdentifier(quotedName!);
    const lowerConstraints = constraints.toLowerCase();

    columns.push({
      name,
      type: type!.replace(/,$/, ''),
      nullable:
        !lowerConstraints.includes('not null') &&
        !lowerConstraints.includes('primary key'),
      defaultValue: constraints.match(/default\s+([^,\s]+)/i)?.[1],
      isPrimaryKey: lowerConstraints.includes('primary key'),
      isForeignKey: lowerConstraints.includes('references'),
      referencedTable: optionalUnquote(
        constraints.match(new RegExp(`references\\s+${QUALIFIED}`, 'i'))?.[2],
      ),
      referencedColumn: optionalUnquote(
        constraints
          .match(
            new RegExp(
              `references\\s+(?:${NAME}\\s*\\.\\s*)?${NAME}\\s*\\(([^)]+)\\)`,
              'i',
            ),
          )?.[1]
          ?.trim(),
      ),
    });
  }

  return columns;
}

export function parseForeignKeys(tableDefinition: string): TableForeignKey[] {
  const foreignKeys: TableForeignKey[] = [];

  const fkRegex = new RegExp(
    `foreign\\s+key\\s*\\(([^)]+)\\)\\s*references\\s+(?:${NAME}\\s*\\.\\s*)?(${NAME})\\s*\\(([^)]+)\\)(?:\\s+on\\s+delete\\s+([a-z\\s]+?))?(?:\\s+on\\s+update\\s+([a-z\\s]+?))?(?=,|\\)|$)`,
    'gi',
  );

  let match: RegExpExecArray | null;

  while ((match = fkRegex.exec(tableDefinition)) !== null) {
    const [, columns, quotedTable, referencedColumns, onDelete, onUpdate] =
      match;

    const columnList = splitList(columns!).map(unquoteIdentifier);
    const referencedTable = unquoteIdentifier(quotedTable!);

    foreignKeys.push({
      name: `fk_${referencedTable}_${columnList.join('_')}`,
      columns: columnList,
      referencedTable,
      referencedColumns: splitList(referencedColumns!).map(unquoteIdentifier),
      onDelete: onDelete?.trim(),
      onUpdate: onUpdate?.trim(),
    });
  }

  return foreignKeys;
}

/**
 * Indexes created on `tableName`. With `schema`, indexes on a same-named
 * table qualified with another schema are left out; unqualified ones count
 * when `allowUnqualified` is set.
 */
export function parseIndexes(
  content: string,
  tableName: string,
  schema?: string,
  allowUnqualified = true,
): TableIndex[] {
  const indexes: TableIndex[] = [];

  const indexRegex = new RegExp(
    `create\\s+(unique\\s+)?index\\s+(?:concurrently\\s+)?(?:if\\s+not\\s+exists\\s+)?(${NAME})\\s+on\\s+(?:only\\s+)?(?:(${NAME})\\s*\\.\\s*)?${identifierPattern(tableName)}\\s*(?:using\\s+(\\w+)\\s*)?\\(([^)]+)\\)`,
    'gi',
  );

  let match: RegExpExecArray | null;

  while ((match = indexRegex.exec(content)) !== null) {
    const [fullMatch, unique, indexName, indexSchema, method, columns] = match;

    if (schema !== undefined) {
      const matches = indexSchema
        ? unquoteIdentifier(indexSchema) === schema
        : allowUnqualified;

      if (!matches) continue;
    }

    indexes.push({
      name: unquoteIdentifier(indexName!),
      columns: splitList(columns!).map(unquoteIdentifier),
      unique: Boolean(unique),
      type: method?.toLowerCase() ?? 'btree',
      definition: fullMatch,
    });
  }

  return indexes;
}

export interface EnumDefinition extends QualifiedName {
  values: string[];
}

export function parseEnumDefinitions(content: string): EnumDefinition[] {
  const enumRegex = new RegExp(
    `create\\s+type\\s+${QUALIFIED}\\s+as\\s+enum\\s*\\(([^)]*)\\)`,
    'gi',
  );

  return [...content.matchAll(enumRegex)].map((match) => ({
    schema: match[1] ? unquoteIdentifier(match[1]) : null,
    name: unquoteIdentifier(match[2]!),
    values: [...match[3]!.matchAll(/'((?:[^']|'')*)'/g)].map((value) =>
      value[1]!.replace(/''/g, "'"),
    ),
  }));
}

export function parseEnums(
  content: string,
  sourceFile: string,
): Record<string, EnumInfo> {
  const enums: Record<string, EnumInfo> = {};

  for (const { name, values } of parseEnumDefinitions(content)) {
    enums[name] = { name, values, sourceFile };
  }

  return enums;
}

export function extractFunctionsFromContent(
  content: string,
  sourceFile: string,
  options: { defaultSchema?: string; purposes?: Record<string, string> } = {},
): DatabaseFunction[] {
  const functions: DatabaseFunction[] = [];

  // Capture everything between "returns" and the body, then pick the header
  // apart: modifiers may sit on the same line or on their own. Bodies may use
  // any dollar-quote tag ($$, $function$) and contain $1-style parameters.
  // Neither the parameter list nor the header can contain ";", which keeps a
  // function without a dollar-quoted body from swallowing the next one.
  const functionRegex = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+${QUALIFIED}\\s*\\(([^;]*?)\\)\\s*returns?\\s+([^;]*?)\\$(\\w*)\\$([\\s\\S]*?)\\$\\5\\$`,
    'gi',
  );

  let match: RegExpExecArray | null;

  while ((match = functionRegex.exec(content)) !== null) {
    const [, quotedSchema, quotedName, params, header, , body] = match;

    if (!quotedName || !header) continue;

    const returnType = header
      .split(
        /\n|\s+(?:language|security|as|set|stable|volatile|immutable|strict|parallel)\b/i,
      )[0]!
      .trim();

    if (!returnType) continue;

    const securityLevel = /security\s+definer/i.test(header)
      ? 'definer'
      : 'invoker';

    const functionName = unquoteIdentifier(quotedName);
    const schema = quotedSchema
      ? unquoteIdentifier(quotedSchema)
      : (options.defaultSchema ?? 'public');

    const description = extractDescription(
      content.substring(0, match.index),
      body ?? '',
    );

    functions.push({
      name: functionName,
      schema,
      parameters: parseParameterList(params ?? ''),
      returnType: returnType.trim(),
      description,
      purpose: derivePurpose(description, functionName, options.purposes),
      securityLevel,
      sourceFile,
    });
  }

  return functions;
}

/**
 * Parse `name type [DEFAULT value]` lists as produced by both schema files and
 * `pg_get_function_arguments`. IN/OUT/INOUT markers are ignored.
 */
export function parseParameterList(paramString: string): FunctionParameter[] {
  if (!paramString.trim()) return [];

  const parameters: FunctionParameter[] = [];

  for (const raw of splitTopLevel(paramString)) {
    const match = raw.match(
      new RegExp(
        `^(?:(?:IN|OUT|INOUT|VARIADIC)\\s+)?(${NAME})\\s+(.+?)(?:\\s+DEFAULT\\s+|\\s*=\\s*)(.+)$|^(?:(?:IN|OUT|INOUT|VARIADIC)\\s+)?(${NAME})\\s+(.+)$`,
        'is',
      ),
    );

    if (match) {
      const name = match[1] ?? match[4]!;
      const type = match[2] ?? match[5]!;
      const defaultValue = match[3];

      parameters.push({
        name: unquoteIdentifier(name.trim()),
        type: type!.trim(),
        defaultValue: defaultValue?.trim(),
      });

      continue;
    }

    const parts = raw.split(/\s+/);

    if (parts.length >= 2) {
      parameters.push({
        name: parts[0] ?? 'unnamed',
        type: parts.slice(1).join(' ').trim(),
      });
    }
  }

  return parameters;
}

/**
 * The `--` comment lines directly above the function (blank lines allowed in
 * between), else the first comment inside the body. A comment further up
 * belongs to whatever statement it sits on.
 */
function extractDescription(beforeFunction: string, body: string): string {
  const lines = beforeFunction.split('\n');

  // The text before the match ends with the partial line holding "create".
  if (lines[lines.length - 1]!.trim() === '') lines.pop();

  const comments: string[] = [];

  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]!.trim();

    if (line === '' && comments.length === 0) continue;

    const comment = line.match(/^--\s*(.*)$/);

    if (!comment) break;

    comments.unshift(comment[1]!.trim());
  }

  const leading = comments.find(Boolean);

  if (leading) return leading;

  const bodyCommentMatch = body.match(/--\s*(.+?)(?:\n|$)/);

  if (bodyCommentMatch?.[1]) {
    return bodyCommentMatch[1].trim();
  }

  return 'No description available';
}

/**
 * A one-line purpose for a function: from `purposes` when the project
 * describes it, otherwise guessed from its name.
 */
export function derivePurpose(
  description: string,
  functionName: string,
  purposes: Record<string, string> = {},
) {
  const known = purposes[functionName];

  if (known) return known;

  const name = functionName.toLowerCase();

  if (name.includes('create')) return 'Create database records with validation';
  if (name.includes('delete') || name.includes('remove'))
    return 'Delete records with proper authorization';
  if (name.includes('update') || name.includes('modify'))
    return 'Update existing records with validation';
  if (name.includes('get') || name.includes('fetch'))
    return 'Retrieve data with access control';
  if (name.includes('verify') || name.includes('validate'))
    return 'Validate data or permissions';
  if (name.includes('check') || name.includes('is_'))
    return 'Check conditions or permissions';
  if (name.includes('invite')) return 'Handle user invitations and access';
  if (name.includes('transfer'))
    return 'Transfer ownership or data between entities';

  return `Custom database function: ${description}`;
}

/** Topics the content-based fallback can return. */
export const DEFAULT_TOPICS = [
  'accounts',
  'auth',
  'billing',
  'permissions',
  'teams',
  'notifications',
  'storage',
  'admin',
  'security',
  'types',
  'configuration',
];

/**
 * The topic of a schema file: from `topicMap` (file name to topic) when the
 * project provides one, otherwise guessed from the file's content.
 */
export function determineTopic(
  fileName: string,
  content: string,
  topicMap: Record<string, string> = {},
): string {
  const known = topicMap[fileName];

  if (known) return known;

  const lower = content.toLowerCase();

  if (lower.includes('account') && lower.includes('team')) return 'accounts';
  if (lower.includes('subscription') || lower.includes('billing'))
    return 'billing';
  if (
    lower.includes('auth') ||
    lower.includes('mfa') ||
    lower.includes('token')
  )
    return 'auth';
  if (lower.includes('permission') || lower.includes('role'))
    return 'permissions';
  if (lower.includes('notification') || lower.includes('email'))
    return 'notifications';
  if (lower.includes('storage') || lower.includes('bucket')) return 'storage';
  if (lower.includes('admin') || lower.includes('super')) return 'admin';

  return 'general';
}

function splitList(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Split on commas that are not inside parentheses or quotes. */
function splitTopLevel(value: string) {
  const items: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';

  for (const char of value) {
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
    } else if (char === ',' && depth === 0) {
      items.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  items.push(current);

  return items.map((item) => item.trim()).filter(Boolean);
}

function optionalUnquote(value: string | undefined) {
  return value === undefined ? undefined : unquoteIdentifier(value);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
