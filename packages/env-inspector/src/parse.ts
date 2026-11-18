/** One `KEY=value` assignment in an env file. */
export interface EnvEntry {
  /** Variable name, without a leading `export `. */
  key: string;
  /** Text before the `=`, exactly as written. */
  keyText: string;
  /** Text after the `=`, exactly as written (joined with \n when multiline). */
  rawValue: string;
  /** The value with surrounding quotes and escapes removed, trimmed. */
  value: string;
  /** 0-based index of the first line. */
  start: number;
  /** 0-based index of the last line (equal to start unless multiline). */
  end: number;
}

// dotenv-shaped keys only: other lines with an = are not assignments
const ASSIGNMENT = /^(\s*(?:export\s+)?[\w.-]+\s*)=(.*)$/;

/**
 * Parses env file content line by line. Comments and blank lines are skipped.
 * A value that opens a quote it does not close on the same line continues
 * until a line ending with that quote (e.g. a PEM key in double quotes).
 */
export function parseEnvContent(content: string) {
  // \r\n too: a .env saved on Windows reads the same
  const lines = content.split(/\r?\n/);
  const entries: EnvEntry[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = line.match(ASSIGNMENT);

    if (!match) {
      continue;
    }

    const keyText = match[1] ?? '';
    let rawValue = match[2] ?? '';
    const start = index;
    const closing = findMultilineEnd(lines, index, rawValue);

    if (closing !== null) {
      rawValue = [rawValue, ...lines.slice(index + 1, closing + 1)].join('\n');
      index = closing;
    }

    entries.push({
      key: keyText.trim().replace(/^export\s+/, ''),
      keyText,
      rawValue,
      value: unquote(rawValue),
      start,
      end: index,
    });
  }

  return { lines, entries };
}

/** The definitions of one env file, as read by the scanner. */
export function parseEnvFile(content: string, source: string) {
  return parseEnvContent(content).entries.map((entry) => ({
    key: entry.key,
    value: entry.value,
    source,
    line: entry.start + 1,
  }));
}

const KEY_NAME = /^[\w.-]+$/;

/** The line ending of `content`: CRLF when it has any, otherwise LF. */
export function detectEol(content: string) {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * Sets `key` to `value`: every existing assignment of the key is replaced in
 * place (comments and other lines are kept); otherwise the assignment is
 * appended. Plain values are written as they are; others in the first quote
 * they do not contain, so the file reads back exactly. Throws, changing
 * nothing, when the result would not read back as `value` with every other
 * variable unchanged.
 */
export function setEnvValue(content: string, key: string, value: string) {
  if (!KEY_NAME.test(key)) {
    throw new Error(
      `"${key}" is not a variable name: use letters, digits, _, . or -`,
    );
  }

  const { lines, entries } = parseEnvContent(content);
  const eol = detectEol(content);
  const written = serializeValue(value);
  const matches = entries.filter((entry) => entry.key === key);
  const output: string[] = [];

  if (content.length === 0) {
    output.push(...`${key}=${written}`.split('\n'));
  } else if (matches.length === 0) {
    output.push(...lines);
    // after the last line, keeping a trailing newline where there was one
    const at = output.at(-1) === '' ? output.length - 1 : output.length;

    output.splice(at, 0, ...`${key}=${written}`.split('\n'));
  } else {
    let cursor = 0;

    for (const entry of matches) {
      output.push(...lines.slice(cursor, entry.start));
      output.push(...`${entry.keyText}=${written}`.split('\n'));
      cursor = entry.end + 1;
    }

    output.push(...lines.slice(cursor));
  }

  const result = output.join(eol);
  const expected = entries.map((entry) =>
    entry.key === key ? { key, value } : entry,
  );

  if (matches.length === 0) {
    expected.push({ key, value });
  }

  assertReadsAs(result, expected, key);

  return result;
}

/**
 * Throws unless `content` parses to exactly `expected`: the same keys in the
 * same order, with the same values. Messages name keys, never values.
 */
export function assertReadsAs(
  content: string,
  expected: ReadonlyArray<{ key: string; value: string }>,
  subject: string,
) {
  const actual = parseEnvContent(content).entries;
  const same =
    actual.length === expected.length &&
    actual.every(
      (entry, index) =>
        entry.key === expected[index]?.key &&
        entry.value === expected[index]?.value,
    );

  if (!same) {
    throw new Error(
      `Refused to write ${subject}: the file would not read back as written (an unclosed quote on another line, or a value that cannot be quoted). Nothing was saved.`,
    );
  }
}

/**
 * `value` as written after `KEY=`: unquoted when plain, else in the first
 * quote dotenv and this parser both read back literally.
 */
function serializeValue(value: string) {
  if (value.includes('\r')) {
    throw new Error(
      'Values cannot contain a carriage return. Nothing was saved.',
    );
  }

  if (value === '') {
    return '';
  }

  if (/^[^\s"'`#][^\n"'`#]*$/.test(value) && value.trim() === value) {
    return value;
  }

  if (!/['\n]/.test(value)) {
    return `'${value}'`;
  }

  if (!/["\\]/.test(value)) {
    return `"${value}"`;
  }

  if (!value.includes('`')) {
    return `\`${value}\``;
  }

  // \" in double quotes: dotenv (Vite, Next.js) would not read it back
  throw new Error(
    'Values cannot contain all three quotes (\', " and `). Nothing was saved.',
  );
}

function findMultilineEnd(lines: string[], index: number, rawValue: string) {
  const value = rawValue.trimStart();
  const quote = value[0];

  if (!isQuote(quote)) {
    return null;
  }

  // The quote closes on this line: a single-line value.
  if (findQuote(value, quote, 1) !== -1) {
    return null;
  }

  for (let next = index + 1; next < lines.length; next++) {
    const line = lines[next] ?? '';

    if (findQuote(line, quote, 0) !== -1) {
      return line.trimEnd().endsWith(quote) ? next : null;
    }
  }

  return null;
}

export function isQuote(char: string | undefined): char is '"' | "'" | '`' {
  return char === '"' || char === "'" || char === '`';
}

/** Index of the first closing `quote` from `from`; only `"` has escapes. */
export function findQuote(text: string, quote: string, from: number) {
  for (let index = from; index < text.length; index++) {
    if (quote === '"' && text[index] === '\\') {
      index++;
      continue;
    }

    if (text[index] === quote) {
      return index;
    }
  }

  return -1;
}

/**
 * As dotenv (Vite's loadEnv) reads a value: a quoted value whole, up to its
 * closing quote (only double quotes unescape \" and \\); an unquoted one
 * trimmed, up to the first #.
 */
function unquote(rawValue: string) {
  const trimmed = rawValue.trim();
  const quote = trimmed[0];

  if (isQuote(quote)) {
    const close = findQuote(trimmed, quote, 1);
    const rest = trimmed.slice(close + 1);

    if (close !== -1 && (rest === '' || /^\s+#/.test(rest))) {
      const inner = trimmed.slice(1, close);

      if (quote === '"') {
        return inner.replace(/\\(["\\])/g, '$1');
      }

      return inner;
    }
  }

  return trimmed.replace(/#.*$/, '').trim();
}
