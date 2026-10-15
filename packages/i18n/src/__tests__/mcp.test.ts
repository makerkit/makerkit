import { describe, expect, it } from 'vitest';

import { registerI18nTools } from '../mcp';
import { createFakeMcpServer } from '../testing/fake-mcp-server';
import { createMemoryDeps, repoPath } from '../testing/memory-deps';
import { createTranslationsService } from '../translations.service';

const ROOT = repoPath('public', 'locales');

const TOOL_NAMES = [
  'translations_add_locale',
  'translations_add_namespace',
  'translations_list',
  'translations_remove_locale',
  'translations_remove_namespace',
  'translations_stats',
  'translations_update',
];

function createService() {
  return createTranslationsService(
    createMemoryDeps(
      {
        [`${ROOT}/en/common.json`]: JSON.stringify({ title: 'Title' }),
        [`${ROOT}/es/common.json`]: JSON.stringify({ title: 'Título' }),
      },
      [ROOT, `${ROOT}/en`, `${ROOT}/es`],
    ),
  );
}

describe('registerI18nTools', () => {
  it('registers the seven tools with annotations and output schemas', () => {
    const fake = createFakeMcpServer();
    registerI18nTools(fake.server, createService());

    expect(fake.tools.map((tool) => tool.name).sort()).toEqual(TOOL_NAMES);

    for (const tool of fake.tools) {
      expect(tool.config.outputSchema).toBeDefined();
    }

    expect(
      fake.tool('translations_list').config.annotations?.readOnlyHint,
    ).toBe(true);
    expect(
      fake.tool('translations_stats').config.annotations?.readOnlyHint,
    ).toBe(true);
    expect(
      fake.tool('translations_update').config.annotations?.idempotentHint,
    ).toBe(true);
    expect(
      fake.tool('translations_add_locale').config.annotations?.destructiveHint,
    ).toBe(false);
    expect(
      fake.tool('translations_remove_locale').config.annotations
        ?.destructiveHint,
    ).toBe(true);
    expect(
      fake.tool('translations_remove_namespace').config.annotations
        ?.destructiveHint,
    ).toBe(true);
  });

  it('matches the kit tool names with the kit_ prefix', () => {
    const fake = createFakeMcpServer();
    registerI18nTools(fake.server, createService(), { prefix: 'kit_' });

    expect(fake.tools.map((tool) => tool.name).sort()).toEqual([
      'kit_translations_add_locale',
      'kit_translations_add_namespace',
      'kit_translations_list',
      'kit_translations_remove_locale',
      'kit_translations_remove_namespace',
      'kit_translations_stats',
      'kit_translations_update',
    ]);
  });

  it('returns structured content that satisfies each output schema', async () => {
    const fake = createFakeMcpServer();
    registerI18nTools(fake.server, createService());

    const list = await fake.call('translations_list');
    expect(list.structuredContent).toMatchObject({
      base_locale: 'en',
      locales: ['en', 'es'],
    });

    await fake.call('translations_stats');
    await fake.call('translations_update', {
      locale: 'es',
      namespace: 'common',
      key: 'subtitle',
      value: 'Subtítulo',
    });
    await fake.call('translations_add_namespace', { namespace: 'billing' });
    await fake.call('translations_add_locale', { locale: 'fr' });
    await fake.call('translations_remove_namespace', { namespace: 'billing' });

    const removed = await fake.call('translations_remove_locale', {
      locale: 'fr',
    });
    expect(removed.structuredContent).toEqual({
      success: true,
      locale: 'fr',
      path_removed: `${ROOT}/fr`,
    });
  });

  it('reports errors with the prefixed tool name', async () => {
    const fake = createFakeMcpServer();
    registerI18nTools(fake.server, createService(), { prefix: 'kit_' });

    const result = await fake.call('kit_translations_remove_locale', {
      locale: 'en',
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: 'text',
        text: 'kit_translations_remove_locale failed: Cannot remove base locale "en"',
      },
    ]);
  });

  it('rejects invalid input', async () => {
    const fake = createFakeMcpServer();
    registerI18nTools(fake.server, createService());

    const result = await fake.call('translations_update', { locale: 'en' });

    expect(result.isError).toBe(true);
  });
});
