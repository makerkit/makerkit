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

const ASSIGNMENT = /^([^=]+)=(.*)$/;

/**
 * Parses env file content line by line. Comments and blank lines are skipped.
 * A value that opens a quote it does not close on the same line continues
 * until a line ending with that quote (e.g. a PEM key in double quotes).
 */
export function parseEnvContent(content: string) {
  const lines = content.split('\n');
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

/**
 * Sets `key` to `value`: every existing assignment of the key is replaced in
 * place (comments and other lines are kept); otherwise the assignment is
 * appended. Values containing a newline are written in double quotes.
 */
export function setEnvValue(content: string, key: string, value: string) {
  const { lines, entries } = parseEnvContent(content);
  const written = value.includes('\n') ? `"${value}"` : value;
  const matches = entries.filter((entry) => entry.key === key);

  if (content.length === 0) {
    return `${key}=${written}`;
  }

  if (matches.length === 0) {
    const output = [...lines];

    if (output[output.length - 1] !== '') {
      output.push('');
    }

    output.push(`${key}=${written}`);

    return output.join('\n');
  }

  const output: string[] = [];
  let cursor = 0;

  for (const entry of matches) {
    output.push(...lines.slice(cursor, entry.start));
    output.push(`${entry.keyText}=${written}`);
    cursor = entry.end + 1;
  }

  output.push(...lines.slice(cursor));

  return output.join('\n');
}

function findMultilineEnd(lines: string[], index: number, rawValue: string) {
  const value = rawValue.trimStart();
  const quote = value[0];

  if (quote !== '"' && quote !== "'") {
    return null;
  }

  // The quote closes on this line: a single-line value.
  if (hasUnescaped(value.slice(1), quote)) {
    return null;
  }

  for (let next = index + 1; next < lines.length; next++) {
    if (hasUnescaped(lines[next] ?? '', quote)) {
      return (lines[next] ?? '').trimEnd().endsWith(quote) ? next : null;
    }
  }

  return null;
}

function hasUnescaped(text: string, quote: string) {
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\\') {
      index++;
      continue;
    }

    if (text[index] === quote) {
      return true;
    }
  }

  return false;
}

function unquote(rawValue: string) {
  let value = rawValue;

  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }

  return value
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\')
    .trim();
}
