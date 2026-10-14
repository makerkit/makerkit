import { describe, expect, it } from 'vitest';

import {
  type RunChecksDeps,
  createRunChecksService,
} from '../run-checks.service';

// Mirrors the root package.json: the default checks must all exist, or every
// run reports them as missing.
const ROOT_SCRIPTS: Record<string, string> = {
  typecheck: 'tsc --noEmit',
  lint: 'oxlint',
  'lint:fix': 'oxlint --fix',
  format: 'oxfmt --check',
  'format:fix': 'oxfmt',
  test: 'vitest run',
};

function createDeps(
  overrides: Partial<RunChecksDeps> = {},
  scripts: Record<string, string> = ROOT_SCRIPTS,
): RunChecksDeps {
  let nowValue = 0;

  return {
    rootPath: '/repo',
    packageManager: 'pnpm',
    async readRootPackageJson() {
      return { scripts };
    },
    async executeCommand() {
      nowValue += 100;
      return {
        stdout: 'ok',
        stderr: '',
        exitCode: 0,
      };
    },
    now() {
      return nowValue;
    },
    ...overrides,
  };
}

describe('RunChecksService', () => {
  it('defaults to check-only scripts and reports pass', async () => {
    const service = createRunChecksService(createDeps());
    const result = await service.run({});

    expect(result.overall).toBe('pass');
    expect(result.mode).toBe('check');
    expect(result.scripts_requested).toEqual(['typecheck', 'lint', 'format']);
    expect(result.summary.passed).toBe(3);
    expect(result.diagnostics).toEqual([]);
  });

  it('switches to the fixing variants when fix is true', async () => {
    const service = createRunChecksService(createDeps());
    const result = await service.run({ fix: true });

    expect(result.mode).toBe('fix');
    expect(result.scripts_requested).toEqual([
      'typecheck',
      'lint:fix',
      'format:fix',
    ]);
  });

  it('includes tests when includeTests is true', async () => {
    const service = createRunChecksService(createDeps());
    const result = await service.run({ includeTests: true });

    expect(result.scripts_requested).toContain('test');
    expect(result.summary.total).toBe(4);
  });

  it('still accepts the legacy state wrapper, with flat fields winning', async () => {
    const service = createRunChecksService(createDeps());

    const legacy = await service.run({ state: { includeTests: true } });
    expect(legacy.scripts_requested).toContain('test');

    const mixed = await service.run({
      fix: true,
      state: { fix: false, scripts: ['typecheck'] },
    });
    expect(mixed.mode).toBe('fix');
    expect(mixed.scripts_requested).toEqual(['typecheck']);
  });

  it('marks missing scripts as missing and fails overall', async () => {
    const service = createRunChecksService(
      createDeps({}, { typecheck: 'tsc --noEmit' }),
    );
    const result = await service.run({ scripts: ['typecheck', 'lint'] });

    expect(result.overall).toBe('fail');
    expect(result.summary.missing).toBe(1);
    expect(result.checks.find((item) => item.script === 'lint')?.status).toBe(
      'missing',
    );
  });

  it('stops subsequent checks when failFast is enabled', async () => {
    let calls = 0;
    const service = createRunChecksService(
      createDeps({
        async executeCommand(_command, args) {
          calls += 1;
          if (args[1] === 'typecheck') {
            return { stdout: '', stderr: 'boom', exitCode: 1 };
          }

          return { stdout: '', stderr: '', exitCode: 0 };
        },
      }),
    );

    const result = await service.run({
      scripts: ['typecheck', 'lint', 'format'],
      failFast: true,
    });

    expect(calls).toBe(1);
    expect(result.checks[0]?.status).toBe('fail');
    expect(result.checks[0]?.message).toMatch(/no diagnostics/);
    expect(result.checks[1]?.status).toBe('skipped');
    expect(result.checks[2]?.status).toBe('skipped');
  });

  it('parses diagnostics from failing output and flattens errors first', async () => {
    const service = createRunChecksService(
      createDeps({
        async executeCommand(_command, args) {
          if (args[1] === 'typecheck') {
            return {
              stdout:
                'web:typecheck: app/page.tsx(12,7): error TS2322: Type string is not assignable to type number.\n',
              stderr: '',
              exitCode: 1,
            };
          }

          if (args[1] === 'lint') {
            return {
              stdout:
                "packages/ui/src/button.tsx:3:1: warning eslint(no-unused-vars): Variable 'x' is declared but never used. help: Remove it\n",
              stderr: '',
              exitCode: 1,
            };
          }

          return { stdout: '', stderr: '', exitCode: 0 };
        },
      }),
    );

    const result = await service.run({});

    expect(result.overall).toBe('fail');
    expect(result.summary.errors).toBe(1);
    expect(result.summary.warnings).toBe(1);
    expect(result.diagnostics.map((d) => d.severity)).toEqual([
      'error',
      'warning',
    ]);

    const typecheck = result.checks.find((c) => c.script === 'typecheck');
    expect(typecheck?.diagnostics[0]).toMatchObject({
      source: 'tsc',
      file: 'app/page.tsx',
      line: 12,
      column: 7,
      rule: 'TS2322',
      package: 'web',
    });
    expect(typecheck?.message).toBeUndefined();
  });

  it('truncates raw output but never diagnostics', async () => {
    const longLine = 'x'.repeat(1000);
    const service = createRunChecksService(
      createDeps({
        async executeCommand() {
          return {
            stdout: `${longLine}\nsrc/a.ts(1,1): error TS1: a\n`,
            stderr: '',
            exitCode: 1,
          };
        },
      }),
    );

    const result = await service.run({
      scripts: ['typecheck'],
      maxOutputChars: 200,
    });

    expect(result.checks[0]?.stdout).toMatch(/truncated/);
    expect(result.checks[0]?.diagnostics).toHaveLength(1);
  });
});

describe('RunChecksService settings', () => {
  it('runs scripts with the configured package manager', async () => {
    const calls: string[] = [];
    const service = createRunChecksService(
      createDeps({
        packageManager: 'npm',
        async executeCommand(command, args) {
          calls.push(`${command} ${args.join(' ')}`);
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      }),
    );

    const result = await service.run({ scripts: ['typecheck'] });

    expect(calls).toEqual(['npm run typecheck']);
    expect(result.checks[0]?.command).toBe('npm run typecheck');
  });

  it('uses the configured check, fix and test scripts', async () => {
    const calls: string[] = [];
    const service = createRunChecksService(
      createDeps(
        {
          scripts: { check: ['types'], fix: ['types', 'fix'], test: 'unit' },
          async executeCommand(_command, args) {
            calls.push(args[1]!);
            return { stdout: '', stderr: '', exitCode: 0 };
          },
        },
        { types: 'tsc', fix: 'eslint --fix', unit: 'vitest' },
      ),
    );

    await service.run({});
    await service.run({ fix: true, includeTests: true });

    expect(calls).toEqual(['types', 'types', 'fix', 'unit']);
  });
});
