import type { Diagnostic } from './schema';

/**
 * Turn raw check output into structured diagnostics.
 *
 * Supported formats (all observed in this repo's toolchain):
 * - tsc:    `path(line,col): error TS1234: message`
 * - oxlint: `path:line:col: warning eslint(rule): message help: ...` (default)
 *           `path:line:col: message [Warning/eslint(rule)]`            (unix)
 * - oxfmt:  `path (3ms)` lines listed between "Checking formatting..." and
 *           "Format issues found"
 * - vitest: ` FAIL  path > test name` followed by an error line and
 *           `❯ path:line:col`
 *
 * Turbo prefixes every line with `package:task: ` when `ui = "stream"`; the
 * prefix is stripped and recorded as `package`.
 *
 * The output is untrusted (any test or script can print anything), so every
 * pattern is linear in the line length and over-long lines are skipped.
 */
export function parseDiagnostics(
  _script: string,
  output: string,
): Diagnostic[] {
  const lines = output
    .split(/\r?\n/)
    .filter((line) => line.length <= MAX_LINE_LENGTH)
    .map(stripTurboPrefix)
    // npm, pnpm and yarn echo the command they run as "> <command>". It can
    // contain text that looks like a diagnostic, so it is never parsed.
    .filter((line) => !line.text.trimStart().startsWith('> '));

  const diagnostics = [
    ...parseTsc(lines),
    ...parseOxlint(lines),
    ...parseOxfmt(lines),
    ...parseVitest(lines),
  ];

  return dedupe(sortBySeverity(diagnostics));
}

/** Real diagnostics are one line; anything longer is a log dump. */
const MAX_LINE_LENGTH = 4000;

interface PrefixedLine {
  text: string;
  package: string | null;
}

const TURBO_PREFIX = /^([@a-z0-9][\w./-]*):([a-z][\w:-]*):\s?/i;

function stripTurboPrefix(line: string): PrefixedLine {
  const match = line.match(TURBO_PREFIX);

  if (!match) {
    return { text: line, package: null };
  }

  return {
    text: line.slice(match[0].length),
    package: match[1] ?? null,
  };
}

/**
 * A file path as printed by these tools: no colon except an optional Windows
 * drive letter. Keeping the path group colon-free is what makes the
 * `path:line:col` patterns below single-pass instead of quadratic.
 */
const FILE_PATH = '((?:[A-Za-z]:)?[^:\\n]+?)';

const TSC_LINE = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.*)$/;

function parseTsc(lines: PrefixedLine[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const { text, package: pkg } of lines) {
    const match = text.match(TSC_LINE);

    if (!match) continue;

    const [, file, line, column, severity, rule, message] = match;

    diagnostics.push({
      source: 'tsc',
      severity: severity === 'error' ? 'error' : 'warning',
      file: file!.trim(),
      line: Number(line),
      column: Number(column),
      rule: rule ?? null,
      message: message!.trim(),
      package: pkg,
    });
  }

  return diagnostics;
}

const OXLINT_DEFAULT_LINE = new RegExp(
  `^${FILE_PATH}:(\\d+):(\\d+): (error|warning) ([\\w-]+(?:\\([\\w./-]+\\))?): (.*)$`,
);

const OXLINT_UNIX_LINE = new RegExp(
  `^${FILE_PATH}:(\\d+):(\\d+): (.*) \\[(Error|Warning)\\/([^\\]]+)\\]$`,
);

function parseOxlint(lines: PrefixedLine[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const { text, package: pkg } of lines) {
    const asDefault = text.match(OXLINT_DEFAULT_LINE);

    if (asDefault) {
      const [, file, line, column, severity, rule, rest] = asDefault;
      const helpIndex = rest!.indexOf(' help: ');
      const message = helpIndex === -1 ? rest! : rest!.slice(0, helpIndex);

      diagnostics.push({
        source: 'oxlint',
        severity: severity === 'error' ? 'error' : 'warning',
        file: file!.trim(),
        line: Number(line),
        column: Number(column),
        rule: rule ?? null,
        message: message.trim(),
        package: pkg,
      });

      continue;
    }

    const asUnix = text.match(OXLINT_UNIX_LINE);

    if (asUnix) {
      const [, file, line, column, message, severity, rule] = asUnix;

      diagnostics.push({
        source: 'oxlint',
        severity: severity === 'Error' ? 'error' : 'warning',
        file: file!.trim(),
        line: Number(line),
        column: Number(column),
        rule: rule ?? null,
        message: message!.trim(),
        package: pkg,
      });
    }
  }

  return diagnostics;
}

const OXFMT_START = /^Checking formatting/;
const OXFMT_END = /^Format issues found/;
const OXFMT_FILE_LINE = /^(\S.*?) \(\d+(?:\.\d+)?m?s\)$/;

function parseOxfmt(lines: PrefixedLine[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  let inList = false;

  for (const { text, package: pkg } of lines) {
    if (OXFMT_START.test(text)) {
      inList = true;
      continue;
    }

    if (OXFMT_END.test(text)) {
      inList = false;
      continue;
    }

    if (!inList) continue;

    const match = text.trim().match(OXFMT_FILE_LINE);

    if (!match) continue;

    diagnostics.push({
      source: 'oxfmt',
      severity: 'warning',
      file: match[1]!,
      line: null,
      column: null,
      rule: 'format',
      message: 'File is not formatted. Run format:fix.',
      package: pkg,
    });
  }

  return diagnostics;
}

const VITEST_FAIL_LINE = /^\s*FAIL\s+(.+?)(?: > (.+))?$/;
const VITEST_LOCATION_LINE = new RegExp(
  `^\\s*❯\\s+${FILE_PATH}:(\\d+):(\\d+)\\s*$`,
);
const VITEST_ERROR_LINE = /^([A-Z][A-Za-z]*(?:Error|Exception)): (.*)$/;

function parseVitest(lines: PrefixedLine[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (let index = 0; index < lines.length; index++) {
    const { text, package: pkg } = lines[index]!;
    const fail = text.match(VITEST_FAIL_LINE);

    if (!fail) continue;

    const [, file, testName] = fail;

    // A "FAIL path (N tests)" summary line without a test name is a header
    // for the file, not an individual failure.
    if (!testName) continue;

    let message = `Test failed: ${testName}`;
    let line: number | null = null;
    let column: number | null = null;

    // Look ahead for the error message and first location marker until the
    // next FAIL block or the summary separator.
    for (let cursor = index + 1; cursor < lines.length; cursor++) {
      const next = lines[cursor]!.text;

      if (VITEST_FAIL_LINE.test(next) || next.startsWith('⎯')) break;

      const error = next.match(VITEST_ERROR_LINE);

      if (error && message.startsWith('Test failed:')) {
        message = `${testName}: ${error[1]}: ${error[2]}`;
      }

      const location = next.match(VITEST_LOCATION_LINE);

      if (location && line === null) {
        line = Number(location[2]);
        column = Number(location[3]);
      }
    }

    diagnostics.push({
      source: 'vitest',
      severity: 'error',
      file: file!.trim(),
      line,
      column,
      rule: null,
      message,
      package: pkg,
    });
  }

  return diagnostics;
}

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

function sortBySeverity(diagnostics: Diagnostic[]) {
  return [...diagnostics].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}

function dedupe(diagnostics: Diagnostic[]) {
  const seen = new Set<string>();
  const output: Diagnostic[] = [];

  for (const diagnostic of diagnostics) {
    const key = [
      diagnostic.source,
      diagnostic.file,
      diagnostic.line,
      diagnostic.column,
      diagnostic.rule,
      diagnostic.message,
    ].join('|');

    if (seen.has(key)) continue;

    seen.add(key);
    output.push(diagnostic);
  }

  return output;
}
