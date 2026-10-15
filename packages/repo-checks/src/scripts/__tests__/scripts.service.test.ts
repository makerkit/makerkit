import { describe, expect, it } from 'vitest';

import { createScriptsService, describeScript } from '../scripts.service';

const ROOT_SCRIPTS = {
  typecheck: 'turbo typecheck',
  lint: 'oxlint',
  'lint:fix': 'oxlint --fix',
  format: 'oxfmt --check',
  'format:fix': 'oxfmt',
  test: 'turbo test',
  'my:custom': 'node scripts/custom.js',
  broken: 42,
};

function createService(scripts: Record<string, unknown> = ROOT_SCRIPTS) {
  return createScriptsService({
    rootPath: '/repo',
    async readRootPackageJson() {
      return { scripts };
    },
  });
}

describe('ScriptsService.list', () => {
  it('returns every string script sorted by importance then name', async () => {
    const result = await createService().list();

    expect(result.total).toBe(7);
    expect(result.scripts.map((s) => s.name).slice(0, 2)).toEqual([
      'lint',
      'typecheck',
    ]);
    expect(result.scripts.at(-1)?.name).toBe('my:custom');
  });

  it('flags scripts that rewrite files', async () => {
    const result = await createService().list();
    const byName = Object.fromEntries(result.scripts.map((s) => [s.name, s]));

    expect(byName['lint:fix']?.mutates_files).toBe(true);
    expect(byName['lint']?.mutates_files).toBe(false);
  });
});

describe('ScriptsService.getDetails', () => {
  it('returns catalog metadata for known scripts', async () => {
    const script = await createService().getDetails({
      scriptName: 'typecheck',
    });

    expect(script.importance).toBe('critical');
    expect(script.healthcheck).toBe(true);
    expect(script.command).toBe('turbo typecheck');
  });

  it('throws for unknown scripts', async () => {
    await expect(
      createService().getDetails({ scriptName: 'nope' }),
    ).rejects.toThrow(/not found/);
  });
});

describe('ScriptsService.getHealthcheckScripts', () => {
  it('lists healthcheck scripts present in package.json with check-only order', async () => {
    const result = await createService().getHealthcheckScripts();

    expect(result.scripts.map((s) => s.name).sort()).toEqual([
      'format',
      'format:fix',
      'lint',
      'lint:fix',
      'test',
      'typecheck',
    ]);
    expect(result.recommended_order).toEqual([
      'typecheck',
      'lint',
      'format',
      'test',
    ]);
  });

  it('omits recommended scripts that do not exist', async () => {
    const result = await createService({
      typecheck: 'tsc',
    }).getHealthcheckScripts();

    expect(result.recommended_order).toEqual(['typecheck']);
  });
});

describe('describeScript', () => {
  it('infers a category for unknown scripts', () => {
    expect(describeScript('supabase:foo', 'x').category).toBe('database');
    expect(describeScript('test:e2e', 'x').category).toBe('testing');
    expect(describeScript('random', 'x').category).toBe('maintenance');
    expect(describeScript('random', 'x').importance).toBe('low');
  });
});
