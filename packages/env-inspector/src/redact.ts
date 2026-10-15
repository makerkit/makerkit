import { type EnvEntry, parseEnvContent } from './parse';
import type { EnvVariableModelList } from './types';

/** Shown in place of a secret value. */
export const REDACTED = '[REDACTED]';

/** Values shorter than this are not removed from validation messages. */
const MIN_SCRUB_LENGTH = 4;

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

/** Replaces the non-empty values of secret variables with REDACTED. */
export function redactEnvContent(
  content: string,
  isSecret: (key: string) => boolean,
) {
  const { lines, entries } = parseEnvContent(content);
  const redacted = entries.filter(
    (entry) => entry.value !== '' && isSecret(entry.key),
  );

  if (redacted.length === 0) {
    return { content, redactedKeys: [] };
  }

  return {
    content: replaceEntries(lines, redacted, () => REDACTED),
    redactedKeys: [...new Set(redacted.map((entry) => entry.key))],
  };
}

/**
 * Puts the current values back into content an agent wrote from a redacted
 * read: each `KEY=[REDACTED]` line gets the value KEY has in the current file
 * (the nth placeholder of a key gets its nth current value). Throws when a
 * placeholder has no current value to restore.
 */
export function restoreRedactedContent(content: string, current: string) {
  const currentValues = new Map<string, string[]>();

  for (const entry of parseEnvContent(current).entries) {
    currentValues.set(entry.key, [
      ...(currentValues.get(entry.key) ?? []),
      entry.rawValue,
    ]);
  }

  const { lines, entries } = parseEnvContent(content);
  const placeholders = entries.filter((entry) => isPlaceholder(entry.rawValue));

  if (placeholders.length === 0) {
    return content;
  }

  const seen = new Map<string, number>();

  return replaceEntries(lines, placeholders, (entry) => {
    const values = currentValues.get(entry.key) ?? [];
    const occurrence = seen.get(entry.key) ?? 0;
    seen.set(entry.key, occurrence + 1);

    const value = values[occurrence] ?? values[values.length - 1];

    if (value === undefined) {
      throw new Error(
        `${entry.key} is set to ${REDACTED} but has no current value in this file to keep. Set its value with env_update.`,
      );
    }

    return value;
  });
}

/** Removes secret values from free text such as validation messages. */
export function scrubValues(text: string, values: readonly string[]) {
  return values
    .filter((value) => value.length >= MIN_SCRUB_LENGTH)
    .reduce((result, value) => result.split(value).join(REDACTED), text);
}

/** True for REDACTED, bare or in quotes. */
export function isPlaceholder(rawValue: string) {
  const value = rawValue.trim();

  return (
    value === REDACTED || value === `"${REDACTED}"` || value === `'${REDACTED}'`
  );
}

function replaceEntries(
  lines: string[],
  entries: EnvEntry[],
  valueFor: (entry: EnvEntry) => string,
) {
  const output: string[] = [];
  let cursor = 0;

  for (const entry of entries) {
    output.push(...lines.slice(cursor, entry.start));
    output.push(`${entry.keyText}=${valueFor(entry)}`);
    cursor = entry.end + 1;
  }

  output.push(...lines.slice(cursor));

  return output.join('\n');
}
