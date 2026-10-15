import { afterEach, describe, expect, it } from 'vitest';

import { createRepoChecksServices, detectPackageManager } from '../node';

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createProject(
  scripts: Record<string, string>,
  lockfile = 'package-lock.json',
) {
  const root = await mkdtemp(join(tmpdir(), 'makerkit-repo-checks-'));
  directories.push(root);

  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', private: true, scripts }),
  );
  await writeFile(join(root, lockfile), '');

  return root;
}

// Prints a TypeScript-style error, the format the diagnostics parser reads.
const FAILING_TYPECHECK = `node -e "console.log('src/app.ts(3,7): error TS2322: Type string is not assignable to type number.'); process.exit(2)"`;

describe('detectPackageManager', () => {
  it('reads the lockfile', async () => {
    expect(
      detectPackageManager(await createProject({}, 'pnpm-lock.yaml')),
    ).toBe('pnpm');
    expect(detectPackageManager(await createProject({}, 'yarn.lock'))).toBe(
      'yarn',
    );
    expect(
      detectPackageManager(await createProject({}, 'package-lock.json')),
    ).toBe('npm');
  });
});

describe('createRepoChecksServices', () => {
  it('runs real scripts and parses diagnostics from their output', async () => {
    const root = await createProject({
      typecheck: FAILING_TYPECHECK,
      lint: 'node -e "process.exit(0)"',
    });

    const { runChecks } = createRepoChecksServices(root);
    const result = await runChecks.run({ scripts: ['typecheck', 'lint'] });

    expect(result.overall).toBe('fail');
    expect(result.checks.map((check) => [check.command, check.status])).toEqual(
      [
        ['npm run typecheck', 'fail'],
        ['npm run lint', 'pass'],
      ],
    );
    expect(result.diagnostics[0]).toMatchObject({
      file: 'src/app.ts',
      line: 3,
      severity: 'error',
    });
  });

  it('reports scripts the project does not have as missing', async () => {
    const root = await createProject({ lint: 'node -e "process.exit(0)"' });

    const result = await createRepoChecksServices(root).runChecks.run({});

    expect(
      result.checks
        .filter((check) => check.status === 'missing')
        .map((c) => c.script),
    ).toEqual(['typecheck', 'format']);
  });

  it('applies a custom script catalog', async () => {
    const root = await createProject({ 'db:reset': 'echo reset' });

    const { scripts } = createRepoChecksServices(root, {
      catalog: {
        'db:reset': {
          description: 'Reset the local database',
          importance: 'high',
        },
      },
    });

    expect(await scripts.getDetails({ scriptName: 'db:reset' })).toMatchObject({
      description: 'Reset the local database',
      importance: 'high',
    });
  });
});
