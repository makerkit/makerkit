import { afterEach, describe, expect, it } from 'vitest';

import { createEnvInspectorService } from '../env-inspector.service';
import { createEnvInspectorDeps } from '../node';
import { REDACTED } from '../redact';

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

async function createProject(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'makerkit-env-inspector-'));
  directories.push(root);

  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(root, name, '..'), { recursive: true });
    await writeFile(join(root, name), content);
  }

  return root;
}

describe('a single-app Next.js project with no model', () => {
  it('lists every variable with the file its value comes from', async () => {
    const root = await createProject({
      'package.json': JSON.stringify({ name: 'my-app' }),
      '.env':
        'NEXT_PUBLIC_API_URL=https://api.example.com\nDATABASE_URL=postgres://base\n',
      '.env.development': 'LOG_LEVEL=debug\n',
      '.env.local': 'DATABASE_URL=postgres://local\nOPENAI_API_KEY=sk-123\n',
      '.env.production': 'LOG_LEVEL=warn\n',
    });

    const service = createEnvInspectorService(createEnvInspectorDeps(root));
    const result = await service.read('development');

    expect(result.app).toBe('app');
    expect(Object.keys(result.variables).sort()).toEqual([
      'DATABASE_URL',
      'LOG_LEVEL',
      'NEXT_PUBLIC_API_URL',
      'OPENAI_API_KEY',
    ]);

    expect(result.variables['NEXT_PUBLIC_API_URL']).toMatchObject({
      value: 'https://api.example.com',
      source: '.env',
      validation: { valid: true, errors: [] },
    });
    expect(result.variables['DATABASE_URL']).toMatchObject({
      value: REDACTED,
      source: '.env.local',
      isOverridden: true,
      overrideChain: [
        { source: '.env', value: REDACTED },
        { source: '.env.local', value: REDACTED },
      ],
    });
    expect(result.variables['LOG_LEVEL']!.source).toBe('.env.development');

    const production = await service.read('production');
    expect(production.variables['LOG_LEVEL']!.source).toBe('.env.production');
    // .env.local applies to production too (Next.js), .env.development not.
    expect(production.variables['DATABASE_URL']!.source).toBe('.env.local');
  });

  it('updates and reads files on disk', async () => {
    const root = await createProject({ '.env.local': 'A=1\n' });
    const service = createEnvInspectorService(
      createEnvInspectorDeps(root, { settings: { revealValues: true } }),
    );

    await service.update({ key: 'B', value: '2' });

    expect(await readFile(join(root, '.env.local'), 'utf8')).toBe('A=1\n\nB=2');
    expect(await service.getVariable('B')).toBe('2');
    expect(await service.rawRead('.env.production')).toEqual({
      content: '',
      exists: false,
    });
  });
});

describe('a monorepo app configured like a Makerkit kit', () => {
  it('reads apps/web', async () => {
    const root = await createProject({
      'pnpm-workspace.yaml': '',
      'apps/web/.env': 'NEXT_PUBLIC_SITE_URL=http://localhost:3000\n',
      '.env': 'ROOT_ONLY=1\n',
    });

    const service = createEnvInspectorService(
      createEnvInspectorDeps(root, {
        settings: { apps: [{ name: 'web', path: 'apps/web' }] },
      }),
    );

    const [state] = await service.getAppState('development');

    expect(state!.appName).toBe('web');
    expect(state!.filePath).toBe(join(root, 'apps/web'));
    expect(Object.keys(state!.variables)).toEqual(['NEXT_PUBLIC_SITE_URL']);
  });
});
