import { afterEach, describe, expect, it } from 'vitest';

import { createNodePrdDeps, createScriptVerifier } from '../node';

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directories: string[] = [];

async function createProject(scripts: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'makerkit-prd-'));
  directories.push(root);

  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', private: true, scripts }),
  );

  return root;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((dir) => rm(dir, { recursive: true })),
  );
});

describe('createScriptVerifier', () => {
  it('passes when every defined check exits 0', async () => {
    const root = await createProject({
      typecheck: 'node -e "process.exit(0)"',
      lint: 'node -e "process.exit(0)"',
    });

    const result = await createScriptVerifier(root)();

    expect(result).toMatchObject({
      passed: true,
      checks: ['typecheck', 'lint'],
      errors: 0,
      messages: [],
    });
  });

  it('fails and reports the output of a failing check', async () => {
    const root = await createProject({
      typecheck:
        'node -e "console.error(\'TS2322 bad type\'); process.exit(1)"',
      lint: 'node -e "process.exit(0)"',
    });

    const result = await createScriptVerifier(root)();

    expect(result.passed).toBe(false);
    expect(result.errors).toBe(1);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatch(/^typecheck: fail/);
    expect(result.messages[0]).toContain('TS2322 bad type');
  });

  it('skips checks the project does not define', async () => {
    const root = await createProject({ lint: 'node -e "process.exit(0)"' });

    const result = await createScriptVerifier(root)();

    expect(result.passed).toBe(true);
    expect(result.checks).toEqual(['lint']);
    expect(result.messages).toEqual([
      'typecheck: skipped (no "typecheck" script in package.json)',
    ]);
  });

  it('runs only the scripts it is given', async () => {
    const root = await createProject({
      test: 'node -e "process.exit(0)"',
      lint: 'node -e "process.exit(1)"',
    });

    const result = await createScriptVerifier(root, ['test'])();

    expect(result).toMatchObject({ passed: true, checks: ['test'] });
  });
});

describe('createScriptVerifier diagnostics', () => {
  it('returns file-and-line diagnostics for a failing typecheck', async () => {
    const root = await createProject({
      typecheck:
        'node -e "console.log(\'src/notes.ts(12,5): error TS2322: Type string is not assignable to type number.\'); process.exit(2)"',
    });

    const result = await createScriptVerifier(root)();

    expect(result.passed).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        file: 'src/notes.ts',
        line: 12,
        severity: 'error',
      }),
    ]);
  });
});

describe('createNodePrdDeps', () => {
  it('uses an injected verifier instead of running scripts', async () => {
    const root = await createProject({
      typecheck: 'node -e "process.exit(1)"',
    });
    const verifyCompletion = async () => ({
      passed: true,
      checks: ['custom'],
      errors: 0,
      warnings: 0,
      diagnostics: [],
      messages: [],
    });

    const deps = createNodePrdDeps(root, { verifyCompletion });

    await expect(deps.verifyCompletion()).resolves.toMatchObject({
      passed: true,
      checks: ['custom'],
    });
  });
});
