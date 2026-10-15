import { describe, expect, it } from 'vitest';

import { createMemoryDeps, repoPath } from '../testing/memory-deps';
import {
  DEFAULT_MESSAGES_DIR,
  createTranslationsService,
} from '../translations.service';

describe('messagesDir', () => {
  it('defaults to the i18next layout public/locales/<locale>/<namespace>.json', async () => {
    const root = repoPath('public', 'locales');
    const deps = createMemoryDeps(
      {
        [`${root}/en/common.json`]: JSON.stringify({ hello: 'Hello' }),
        [`${root}/de/common.json`]: JSON.stringify({ hello: 'Hallo' }),
      },
      [root, `${root}/en`, `${root}/de`],
    );

    const service = createTranslationsService(deps);
    const result = await service.list();

    expect(DEFAULT_MESSAGES_DIR).toBe('public/locales');
    expect(result.locales).toEqual(['de', 'en']);
    expect(result.translations.de?.common?.hello).toBe('Hallo');

    const update = await service.update({
      locale: 'en',
      namespace: 'common',
      key: 'bye',
      value: 'Bye',
    });

    expect(update.file).toBe(`${root}/en/common.json`);
  });

  it('reads a nested package layout and ignores files next to the locale folders', async () => {
    // e.g. packages/i18n/src/messages/{en,it}/*.json plus an index.ts that
    // imports them.
    const root = repoPath('packages', 'i18n', 'src', 'messages');
    const deps = createMemoryDeps(
      {
        [`${root}/index.ts`]: 'export {};',
        [`${root}/en/auth.json`]: JSON.stringify({ signIn: 'Sign in' }),
        [`${root}/it/auth.json`]: JSON.stringify({ signIn: 'Accedi' }),
        [`${root}/it/README.md`]: '# notes',
      },
      [root, `${root}/en`, `${root}/it`],
      { messagesDir: 'packages/i18n/src/messages' },
    );

    const service = createTranslationsService(deps);
    const result = await service.list();

    expect(result.locales).toEqual(['en', 'it']);
    expect(result.namespaces).toEqual(['auth']);

    const added = await service.addLocale({ locale: 'fr' });
    expect(added.files_created).toEqual([`${root}/fr/auth.json`]);
  });

  it('accepts an absolute directory', async () => {
    const root = repoPath('elsewhere', 'translations');
    const deps = createMemoryDeps(
      { [`${root}/en/app.json`]: JSON.stringify({ title: 'App' }) },
      [root, `${root}/en`],
      { messagesDir: root },
    );

    const service = createTranslationsService(deps);

    expect((await service.list()).translations.en?.app?.title).toBe('App');
  });

  it('returns no locales when the directory does not exist', async () => {
    const service = createTranslationsService(createMemoryDeps({}, []));
    const result = await service.list();

    expect(result).toEqual({
      base_locale: '',
      locales: [],
      namespaces: [],
      translations: {},
    });
  });
});

describe('baseLocale', () => {
  const root = repoPath('public', 'locales');

  function createDeps(baseLocale?: string) {
    return createMemoryDeps(
      {
        [`${root}/de/common.json`]: JSON.stringify({ title: 'Titel' }),
        [`${root}/en/common.json`]: JSON.stringify({
          title: 'Title',
          subtitle: 'Subtitle',
        }),
      },
      [root, `${root}/de`, `${root}/en`],
      { baseLocale },
    );
  }

  it('falls back to the first locale alphabetically', async () => {
    const service = createTranslationsService(createDeps());

    expect((await service.list()).base_locale).toBe('de');
    expect((await service.stats()).total_keys).toBe(1);
  });

  it('uses the configured locale for list and stats', async () => {
    const service = createTranslationsService(createDeps('en'));

    expect((await service.list()).base_locale).toBe('en');

    const stats = await service.stats();

    expect(stats.base_locale).toBe('en');
    expect(stats.total_keys).toBe(2);
    expect(stats.coverage.de).toEqual({
      total: 2,
      translated: 1,
      missing: 1,
      percentage: 50,
    });
  });

  it('protects the configured locale, not the first one, from removal', async () => {
    const deps = createDeps('en');
    const service = createTranslationsService(deps);

    await expect(service.removeLocale({ locale: 'en' })).rejects.toThrow(
      'Cannot remove base locale "en"',
    );

    await service.removeLocale({ locale: 'de' });

    expect(deps._files[`${root}/de/common.json`]).toBeUndefined();
  });

  it('falls back when the configured locale does not exist on disk', async () => {
    const service = createTranslationsService(createDeps('fr'));

    expect((await service.list()).base_locale).toBe('de');
  });
});

describe('file output', () => {
  const root = repoPath('public', 'locales');

  it('writes 2-space JSON with a trailing newline by default', async () => {
    const deps = createMemoryDeps({ [`${root}/en/common.json`]: '{}\n' }, [
      root,
      `${root}/en`,
    ]);

    await createTranslationsService(deps).update({
      locale: 'en',
      namespace: 'common',
      key: 'a.b',
      value: 'c',
    });

    expect(deps._files[`${root}/en/common.json`]).toBe(
      '{\n  "a": {\n    "b": "c"\n  }\n}\n',
    );
  });

  it('uses the configured indent', async () => {
    const deps = createMemoryDeps(
      { [`${root}/en/common.json`]: '{}\n' },
      [root, `${root}/en`],
      { indent: '\t' },
    );

    await createTranslationsService(deps).update({
      locale: 'en',
      namespace: 'common',
      key: 'a',
      value: 'b',
    });

    expect(deps._files[`${root}/en/common.json`]).toBe('{\n\t"a": "b"\n}\n');
  });
});
