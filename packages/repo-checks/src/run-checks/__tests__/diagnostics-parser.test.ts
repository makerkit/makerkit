import { describe, expect, it } from 'vitest';

import { parseDiagnostics } from '../diagnostics-parser';

describe('parseDiagnostics', () => {
  it('parses tsc output with and without a turbo prefix', () => {
    const output = [
      'web:typecheck: apps/web/app/page.tsx(12,7): error TS2322: Type string is not assignable.',
      "packages/ui/src/x.ts(3,1): error TS2304: Cannot find name 'foo'.",
      '@kit/ui:typecheck: > tsc --noEmit',
    ].join('\n');

    const result = parseDiagnostics('typecheck', output);

    expect(result).toEqual([
      {
        source: 'tsc',
        severity: 'error',
        file: 'apps/web/app/page.tsx',
        line: 12,
        column: 7,
        rule: 'TS2322',
        message: 'Type string is not assignable.',
        package: 'web',
      },
      {
        source: 'tsc',
        severity: 'error',
        file: 'packages/ui/src/x.ts',
        line: 3,
        column: 1,
        rule: 'TS2304',
        message: "Cannot find name 'foo'.",
        package: null,
      },
    ]);
  });

  it('parses oxlint default format and drops the help suffix', () => {
    const output =
      "bad.ts:1:7: warning eslint(no-unused-vars): Variable 'unused' is declared but never used. Unused variables should start with a '_'. help: Consider removing this declaration.\n" +
      'bad.ts:3:3: error eslint(no-debugger): `debugger` statement is not allowed help: Remove the debugger statement\n';

    const result = parseDiagnostics('lint', output);

    expect(result).toHaveLength(2);
    // Errors sort first.
    expect(result[0]).toMatchObject({
      source: 'oxlint',
      severity: 'error',
      file: 'bad.ts',
      line: 3,
      column: 3,
      rule: 'eslint(no-debugger)',
      message: '`debugger` statement is not allowed',
    });
    expect(result[1]).toMatchObject({
      severity: 'warning',
      rule: 'eslint(no-unused-vars)',
      message:
        "Variable 'unused' is declared but never used. Unused variables should start with a '_'.",
    });
  });

  it('parses oxlint unix format', () => {
    const output =
      "bad.ts:1:7: Variable 'unused' is declared but never used. [Warning/eslint(no-unused-vars)]\n" +
      '2 problems\n';

    const result = parseDiagnostics('lint', output);

    expect(result).toEqual([
      {
        source: 'oxlint',
        severity: 'warning',
        file: 'bad.ts',
        line: 1,
        column: 7,
        rule: 'eslint(no-unused-vars)',
        message: "Variable 'unused' is declared but never used.",
        package: null,
      },
    ]);
  });

  it('parses oxfmt --check file listings', () => {
    const output = [
      'Checking formatting...',
      '',
      'apps/web/app/page.tsx (0ms)',
      'packages/ui/src/button.tsx (1ms)',
      '',
      'Format issues found in above 2 files. Run without `--check` to fix.',
      'Finished in 6ms on 120 files using 14 threads.',
    ].join('\n');

    const result = parseDiagnostics('format', output);

    expect(result.map((d) => d.file)).toEqual([
      'apps/web/app/page.tsx',
      'packages/ui/src/button.tsx',
    ]);
    expect(result[0]).toMatchObject({
      source: 'oxfmt',
      severity: 'warning',
      rule: 'format',
      line: null,
    });
  });

  it('ignores oxfmt output when everything is formatted', () => {
    const output = [
      'Checking formatting...',
      'All matched files use the correct format.',
      'Finished in 6ms on 120 files using 14 threads.',
    ].join('\n');

    expect(parseDiagnostics('format', output)).toEqual([]);
  });

  it('parses vitest failures with message and location', () => {
    const output = [
      ' RUN  v5.0.0 /repo',
      ' ❯ a.test.ts (2 tests | 1 failed) 31ms',
      '   × fails 25ms',
      '⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯',
      ' FAIL  src/a.test.ts > suite > fails',
      'AssertionError: expected 1 to be 2 // Object.is equality',
      '- Expected',
      '+ Received',
      ' ❯ src/a.test.ts:2:31',
      '      1| import {it,expect} from "vitest";',
      '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯',
      ' Test Files  1 failed (1)',
    ].join('\n');

    const result = parseDiagnostics('test', output);

    expect(result).toEqual([
      {
        source: 'vitest',
        severity: 'error',
        file: 'src/a.test.ts',
        line: 2,
        column: 31,
        rule: null,
        message:
          'suite > fails: AssertionError: expected 1 to be 2 // Object.is equality',
        package: null,
      },
    ]);
  });

  it('returns nothing for unrecognised output', () => {
    expect(parseDiagnostics('typecheck', 'all good\n')).toEqual([]);
    expect(parseDiagnostics('custom', '')).toEqual([]);
  });

  it('dedupes identical lines emitted twice (e.g. stdout and stderr)', () => {
    const line = 'src/a.ts(1,1): error TS1: dup';

    expect(parseDiagnostics('typecheck', `${line}\n${line}\n`)).toHaveLength(1);
  });
});

describe('package manager command echo', () => {
  it('ignores the "> command" line npm, pnpm and yarn print before running a script', () => {
    const output = [
      '> fixture@ typecheck',
      `> node -e "console.log('src/app.ts(3,7): error TS2322: Not real.')"`,
      '',
      'src/app.ts(3,7): error TS2322: Type string is not assignable to type number.',
    ].join('\n');

    const diagnostics = parseDiagnostics('typecheck', output);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ file: 'src/app.ts', line: 3 });
  });
});
