import {
  type EnvEntry,
  assertReadsAs,
  detectEol,
  findQuote,
  isQuote,
  parseEnvContent,
} from './parse';
import type { EnvVariableModelList } from './types';

/** Shown in place of a secret value. */
export const REDACTED = '[REDACTED]';

/** Values shorter than this are not removed from validation messages. */
const MIN_SCRUB_LENGTH = 4;

/** Parts of a value at least this long are removed from messages too. */
const MIN_PART_LENGTH = 8;

/**
 * Returns whether a variable is secret: the model's `secret` flag when set;
 * otherwise not secret for public prefixes (e.g. NEXT_PUBLIC_) and secret for
 * everything else, including variables the model does not know.
 */
export function createSecretMatcher(
  model: EnvVariableModelList,
  publicPrefixes: readonly string[],
) {
  const flags = new Map(model.map((item) => [item.name, item.secret]));

  return (key: string) => {
    const flag = flags.get(key);

    if (typeof flag === 'boolean') {
      return flag;
    }

    return !publicPrefixes.some((prefix) => key.startsWith(prefix));
  };
}

/** Shown in place of the nth hidden line (comments and other non-entries). */
const LINE_PLACEHOLDER = /^#\s*\[REDACTED\]:(\d+)$/;

/**
 * Raised for mistakes an agent can fix with another tool. `hint` names that
 * tool as `{tool}`, replaced by its registered name when it is registered.
 */
export class EnvInspectorError extends Error {
  constructor(
    message: string,
    readonly hint?: { tool: string; text: string },
  ) {
    super(message);
  }
}

/**
 * Hides everything that is not a public value: the value of each non-empty
 * secret assignment becomes REDACTED (all lines of a multiline value), and
 * every other non-blank line that is not part of an assignment (comments,
 * bare lines) becomes `# [REDACTED]:n`, n counting those lines from 1.
 */
export function redactEnvContent(
  content: string,
  isSecret: (key: string) => boolean,
) {
  const eol = detectEol(content);
  const redactedKeys = new Set<string>();
  let hidden = 0;

  const output = mapLines(content, {
    entry(entry, lines) {
      if (isEmptyRaw(entry.rawValue)) {
        return lines;
      }

      // a public value is shown, but not text after it (e.g. a comment)
      if (!isSecret(entry.key) && !hasTrailingText(entry)) {
        return lines;
      }

      redactedKeys.add(entry.key);

      return [`${entry.keyText}=${REDACTED}`];
    },
    other(line) {
      if (line.trim() === '') {
        return line;
      }

      hidden++;

      return `# ${REDACTED}:${hidden}`;
    },
  });

  return { content: output.join(eol), redactedKeys: [...redactedKeys] };
}

/**
 * Puts the current values back into content an agent wrote from a redacted
 * read: each `KEY=[REDACTED]` line gets the value KEY has in the current file
 * (the nth placeholder of a key gets its nth current value), and each
 * `# [REDACTED]:n` line the nth hidden line. Throws, so nothing is written,
 * when a placeholder has nothing to restore or the result would not read
 * back as the written content with those values.
 */
export function restoreRedactedContent(content: string, current: string) {
  const currentEntries = new Map<string, EnvEntry[]>();
  const hiddenLines: string[] = [];

  mapLines(current, {
    entry(entry, lines) {
      currentEntries.set(entry.key, [
        ...(currentEntries.get(entry.key) ?? []),
        entry,
      ]);

      return lines;
    },
    other(line) {
      if (line.trim() !== '') {
        hiddenLines.push(line);
      }

      return line;
    },
  });

  const seen = new Map<string, number>();
  const expected: Array<{ key: string; value: string }> = [];

  const output = mapLines(content, {
    entry(entry, lines) {
      if (!isPlaceholder(entry.rawValue)) {
        expected.push(entry);

        return lines;
      }

      const values = currentEntries.get(entry.key) ?? [];
      const occurrence = seen.get(entry.key) ?? 0;
      seen.set(entry.key, occurrence + 1);

      const restored = values[occurrence] ?? values[values.length - 1];

      if (restored === undefined) {
        throw new EnvInspectorError(
          `${entry.key} is set to ${REDACTED} but has no current value in this file to keep.`,
          { tool: 'env_update', text: 'Set its value with {tool}.' },
        );
      }

      expected.push({ key: entry.key, value: restored.value });

      return `${entry.keyText}=${restored.rawValue}`.split('\n');
    },
    other(line) {
      const match = LINE_PLACEHOLDER.exec(line.trim());

      if (!match) {
        return line;
      }

      const restored = hiddenLines[Number(match[1]) - 1];

      if (restored === undefined) {
        throw new EnvInspectorError(
          `${line.trim()} has no hidden line to keep: the file changed, read the file again.`,
        );
      }

      return restored;
    },
  });

  const result = output.join(detectEol(content));

  assertReadsAs(result, expected, 'the file');

  return result;
}

/**
 * Removes secret values from free text such as validation messages: each
 * value of 4 characters or more, and any part of a value 8 characters long
 * or longer (e.g. a prefix a validator echoes).
 */
export function scrubValues(text: string, values: readonly string[]) {
  const hidden = new Array<boolean>(text.length).fill(false);

  for (const value of values) {
    if (value.length < MIN_SCRUB_LENGTH) {
      continue;
    }

    const width = Math.min(value.length, MIN_PART_LENGTH);

    for (let start = 0; start + width <= value.length; start++) {
      const part = value.slice(start, start + width);

      for (
        let at = text.indexOf(part);
        at !== -1;
        at = text.indexOf(part, at + 1)
      ) {
        hidden.fill(true, at, at + width);
      }
    }
  }

  let output = '';

  for (let index = 0; index < text.length; index++) {
    if (!hidden[index]) {
      output += text[index];
    } else if (!hidden[index - 1]) {
      output += REDACTED;
    }
  }

  return output;
}

/** True for REDACTED, bare or in quotes. */
export function isPlaceholder(rawValue: string) {
  const value = rawValue.trim();

  return (
    value === REDACTED || value === `"${REDACTED}"` || value === `'${REDACTED}'`
  );
}

/** Rebuilds content line by line: each assignment whole, then other lines. */
function mapLines(
  content: string,
  map: {
    entry(entry: EnvEntry, lines: string[]): string[];
    other(line: string): string;
  },
) {
  const { lines, entries } = parseEnvContent(content);
  const output: string[] = [];
  let cursor = 0;

  for (const entry of entries) {
    output.push(
      ...lines.slice(cursor, entry.start).map((line) => map.other(line)),
    );
    output.push(...map.entry(entry, lines.slice(entry.start, entry.end + 1)));
    cursor = entry.end + 1;
  }

  output.push(...lines.slice(cursor).map((line) => map.other(line)));

  return output;
}

function hasTrailingText(entry: EnvEntry) {
  const raw = entry.rawValue.trim();

  if (raw === entry.value) {
    return false;
  }

  const quote = raw[0];

  return !(isQuote(quote) && findQuote(raw, quote, 1) === raw.length - 1);
}

function isEmptyRaw(rawValue: string) {
  return ['', '""', "''", '``'].includes(rawValue.trim());
}
