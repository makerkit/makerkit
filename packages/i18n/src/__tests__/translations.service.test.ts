import { describe, expect, it } from 'vitest';

import { createMemoryDeps, repoPath } from '../testing/memory-deps';
import {
  type I18nSettings,
  createTranslationsService,
} from '../translations.service';

// Ported from the Makerkit kits, whose messages live under apps/web/i18n.
const SETTINGS: I18nSettings = { messagesDir: 'apps/web/i18n/messages' };

const LOCALES_ROOT = repoPath('apps', 'web', 'i18n', 'messages');

const EMPTY_FILE = `${JSON.stringify({}, null, 2)}\n`;

function createDeps(files: Record<string, string>, directories: string[]) {
  return createMemoryDeps(files, directories, SETTINGS);
}

describe('TranslationsService.list', () => {
  it('lists and flattens translations with missing namespace fallback', async () => {
    const localesRoot = LOCALES_ROOT;
    const deps = createDeps(
      {
        [`${localesRoot}/en/common.json`]: JSON.stringify({
          header: { title: 'Dashboard' },
        }),
        [`${localesRoot}/en/auth.json`]: JSON.stringify({
          login: 'Sign In',
        }),
        [`${localesRoot}/es/common.json`]: JSON.stringify({
          header: { title: 'Panel' },
        }),
      },
      [localesRoot, `${localesRoot}/en`, `${localesRoot}/es`],
    );

    const service = createTranslationsService(deps);
    const result = await service.list();

    expect(result.base_locale).toBe('en');
    expect(result.locales).toEqual(['en', 'es']);
    expect(result.namespaces).toEqual(['auth', 'common']);
    expect(result.translations.en?.common?.['header.title']).toBe('Dashboard');
    expect(result.translations.en?.auth?.login).toBe('Sign In');
    expect(result.translations.es?.common?.['header.title']).toBe('Panel');
    expect(result.translations.es?.auth).toEqual({});
  });
});

describe('TranslationsService.update', () => {
  it('updates nested translation keys', async () => {
    const localesRoot = LOCALES_ROOT;
    const deps = createDeps(
      {
        [`${localesRoot}/en/common.json`]: JSON.stringify({}),
      },
      [localesRoot, `${localesRoot}/en`],
    );

    const service = createTranslationsService(deps);
    await service.update({
      locale: 'en',
      namespace: 'common',
      key: 'header.title',
      value: 'Home',
    });

    const content = deps._files[`${localesRoot}/en/common.json`]!;
    expect(JSON.parse(content)).toEqual({ header: { title: 'Home' } });
  });

  it('rejects paths outside locales root', async () => {
    const localesRoot = LOCALES_ROOT;
    const deps = createDeps(
      {
        [`${localesRoot}/en/common.json`]: JSON.stringify({}),
      },
      [localesRoot, `${localesRoot}/en`],
    );

    const service = createTranslationsService(deps);

    await expect(
      service.update({
        locale: '../secrets',
        namespace: 'common',
        key: 'header.title',
        value: 'Oops',
      }),
    ).rejects.toThrow('locale');
  });

  it('rejects namespace path segments', async () => {
    const localesRoot = LOCALES_ROOT;
    const deps = createDeps(
      {
        [`${localesRoot}/en/common.json`]: JSON.stringify({}),
      },
      [localesRoot, `${localesRoot}/en`],
    );

    const service = createTranslationsService(deps);

    await expect(
      service.update({
        locale: 'en',
        namespace: 'nested/common',
        key: 'header.title',
        value: 'Oops',
      }),
    ).rejects.toThrow('namespace');
  });
});

describe('TranslationsService.stats', () => {
  it('computes coverage using base locale keys', async () => {
    const localesRoot = LOCALES_ROOT;
    const deps = createDeps(
      {
        [`${localesRoot}/en/common.json`]: JSON.stringify({
          header: { title: 'Dashboard', subtitle: 'Welcome' },
        }),
        [`${localesRoot}/es/common.json`]: JSON.stringify({
          header: { title: 'Panel' },
        }),
      },
      [localesRoot, `${localesRoot}/en`, `${localesRoot}/es`],
    );

    const service = createTranslationsService(deps);
    const result = await service.stats();

    expect(result.base_locale).toBe('en');
    expect(result.total_keys).toBe(2);
    expect(result.coverage.en?.translated).toBe(2);
    expect(result.coverage.es?.translated).toBe(1);
    expect(result.coverage.es?.missing).toBe(1);
  });
});

describe('TranslationsService.addNamespace', () => {
  it('creates namespace JSON in all locale directories', async () => {
    const localesRoot = LOCALES_ROOT;
    const deps = createDeps(
      {
        [`${localesRoot}/en/common.json`]: JSON.stringify({}),
        [`${localesRoot}/es/common.json`]: JSON.stringify({}),
      },
      [localesRoot, `${localesRoot}/en`, `${localesRoot}/es`],
    );

    const service = createTranslationsService(deps);
    const result = await service.addNamespace({ namespace: 'billing' });

    expect(result.success).toBe(true);
    expect(result.namespace).toBe('billing');
    expect(result.files_created).toHaveLength(2);
    expect(deps._files[`${localesRoot}/en/billing.json`]).toBe(EMPTY_FILE);
    expect(deps._files[`${localesRoot}/es/billing.json`]).toBe(EMPTY_FILE);
  });

  it('throws if namespace already exists', async () => {
    const localesRoot = LOCALES_ROOT;
    const deps = createDeps(
      {
        [`${localesRoot}/en/common.json`]: JSON.stringify({}),
      },
      [localesRoot, `${localesRoot}/en`],
    );

    const service = createTranslationsService(deps);

    await expect(service.addNamespace({ namespace: 'common' })).rejects.toThrow(
      'already exists',
    );
  });

  it('throws if no locales exist', async () => {
    const localesRoot = LOCALES_ROOT;
    const deps = createDeps({}, [localesRoot]);

    const service = createTranslationsService(deps);

    await expect(
      service.addNamespace({ namespace: 'billing' }),
    ).rejects.toThrow('No locales exist');
  });

  it('rejects path traversal in namespace', async () => {
    const localesRoot = LOCALES_ROOT;
    const deps = createDeps(
      {
        [`${localesRoot}/en/common.json`]: JSON.stringify({}),
      },
      [localesRoot, `${localesRoot}/en`],
    );

    const service = createTranslationsService(deps);

    await expect(
      service.addNamespace({ namespace: '../secrets' }),
    ).rejects.toThrow('namespace');

    await expect(
      service.addNamespace({ namespace: 'foo/bar' }),
    ).rejects.toThrow('namespace');
  });
});

describe('TranslationsService.addLocale', () => {
  it('creates locale directory with namespace files', async () => {
    const localesRoot = LOCALES_ROOT;
    const deps = createDeps(
      {
        [`${localesRoot}/en/common.json`]: JSON.stringify({ hello: 'Hello' }),
        [`${localesRoot}/en/auth.json`]: JSON.stringify({ login: 'Login' }),
      },
      [localesRoot, `${localesRoot}/en`],
    );

    const service = createTranslationsService(deps);
    const result = await service.addLocale({ locale: 'fr' });

    expect(result.success).toBe(true);
    expect(result.locale).toBe('fr');
    expect(result.files_created).toHaveLength(2);
    expect(deps._files[`${localesRoot}/fr/auth.json`]).toBe(EMPTY_FILE);
    expect(deps._files[`${localesRoot}/fr/common.json`]).toBe(EMPTY_FILE);
  });

  it('throws if locale already exists', async () => {
    const localesRoot = LOCALES_ROOT;
    const deps = createDeps(
      {
        [`${localesRoot}/en/common.json`]: JSON.stringify({}),
      },
      [localesRoot, `${localesRoot}/en`],
    );

    const service = createTranslationsService(deps);

    await expect(service.addLocale({ locale: 'en' })).rejects.toThrow(
      'already exists',
    );
  });

  it('works when no namespaces exist yet', async () => {
    const localesRoot = LOCALES_ROOT;
    const deps = createDeps({}, [localesRoot]);

    const service = createTranslationsService(deps);
    const result = await service.addLocale({ locale: 'en' });

    expect(result.success).toBe(true);
    expect(result.files_created).toHaveLength(0);
  });

  it('rejects path traversal in locale', async () => {
    const localesRoot = LOCALES_ROOT;
    const deps = createDeps({}, [localesRoot]);

    const service = createTranslationsService(deps);

    await expect(service.addLocale({ locale: '../hack' })).rejects.toThrow(
      'locale',
    );

    await expect(service.addLocale({ locale: 'foo\\bar' })).rejects.toThrow(
      'locale',
    );
  });
});

describe('TranslationsService.removeNamespace', () => {
  it('deletes namespace files from all locales', async () => {
    const localesRoot = LOCALES_ROOT;
    const deps = createDeps(
      {
        [`${localesRoot}/en/common.json`]: JSON.stringify({}),
        [`${localesRoot}/en/auth.json`]: JSON.stringify({}),
        [`${localesRoot}/es/common.json`]: JSON.stringify({}),
        [`${localesRoot}/es/auth.json`]: JSON.stringify({}),
      },
      [localesRoot, `${localesRoot}/en`, `${localesRoot}/es`],
    );

    const service = createTranslationsService(deps);
    const result = await service.removeNamespace({ namespace: 'auth' });

    expect(result.success).toBe(true);
    expect(result.namespace).toBe('auth');
    expect(result.files_removed).toHaveLength(2);
    expect(deps._files[`${localesRoot}/en/auth.json`]).toBeUndefined();
    expect(deps._files[`${localesRoot}/es/auth.json`]).toBeUndefined();
    expect(deps._files[`${localesRoot}/en/common.json`]).toBeDefined();
  });

  it('throws if namespace does not exist', async () => {
    const localesRoot = LOCALES_ROOT;
    const deps = createDeps(
      {
        [`${localesRoot}/en/common.json`]: JSON.stringify({}),
      },
      [localesRoot, `${localesRoot}/en`],
    );

    const service = createTranslationsService(deps);

    await expect(
      service.removeNamespace({ namespace: 'nonexistent' }),
    ).rejects.toThrow('does not exist');
  });

  it('rejects path traversal', async () => {
    const localesRoot = LOCALES_ROOT;
    const deps = createDeps({}, [localesRoot]);

    const service = createTranslationsService(deps);

    await expect(
      service.removeNamespace({ namespace: '../etc' }),
    ).rejects.toThrow('namespace');
  });
});

describe('TranslationsService.removeLocale', () => {
  it('deletes entire locale directory', async () => {
    const localesRoot = LOCALES_ROOT;
    const deps = createDeps(
      {
        [`${localesRoot}/en/common.json`]: JSON.stringify({}),
        [`${localesRoot}/es/common.json`]: JSON.stringify({}),
      },
      [localesRoot, `${localesRoot}/en`, `${localesRoot}/es`],
    );

    const service = createTranslationsService(deps);
    const result = await service.removeLocale({ locale: 'es' });

    expect(result.success).toBe(true);
    expect(result.locale).toBe('es');
    expect(result.path_removed).toBe(`${localesRoot}/es`);
    expect(deps._files[`${localesRoot}/es/common.json`]).toBeUndefined();
    expect(deps._files[`${localesRoot}/en/common.json`]).toBeDefined();
  });

  it('throws if locale does not exist', async () => {
    const localesRoot = LOCALES_ROOT;
    const deps = createDeps({}, [localesRoot]);

    const service = createTranslationsService(deps);

    await expect(service.removeLocale({ locale: 'fr' })).rejects.toThrow(
      'does not exist',
    );
  });

  it('throws when trying to delete base locale', async () => {
    const localesRoot = LOCALES_ROOT;
    const deps = createDeps(
      {
        [`${localesRoot}/en/common.json`]: JSON.stringify({}),
        [`${localesRoot}/es/common.json`]: JSON.stringify({}),
      },
      [localesRoot, `${localesRoot}/en`, `${localesRoot}/es`],
    );

    const service = createTranslationsService(deps);

    await expect(service.removeLocale({ locale: 'en' })).rejects.toThrow(
      'Cannot remove base locale',
    );
  });

  it('rejects path traversal', async () => {
    const localesRoot = LOCALES_ROOT;
    const deps = createDeps({}, [localesRoot]);

    const service = createTranslationsService(deps);

    await expect(service.removeLocale({ locale: '../hack' })).rejects.toThrow(
      'locale',
    );
  });
});

describe('TranslationsService.update — key safety', () => {
  const localesRoot = LOCALES_ROOT;

  function serviceWith(common: unknown) {
    const deps = createDeps(
      { [`${localesRoot}/en/common.json`]: JSON.stringify(common) },
      [localesRoot, `${localesRoot}/en`],
    );

    return { deps, service: createTranslationsService(deps) };
  }

  // `__proto__` resolves to Object.prototype, a real object, so it walks past
  // a plain "is this a group?" check and poisons every object in the process.
  // Keys come from agents or HTTP callers, so treat them as untrusted input.
  it.each(['__proto__.polluted', 'constructor.prototype.polluted'])(
    'refuses the reserved key %s and leaves Object.prototype clean',
    async (key) => {
      const { service } = serviceWith({ routes: { home: 'Home' } });

      await expect(
        service.update({
          locale: 'en',
          namespace: 'common',
          key,
          value: 'PWNED',
        }),
      ).rejects.toThrow(/reserved property name/);

      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    },
  );

  // `flattenTranslations` publishes array items as `key.0`, so update() has to
  // accept a key that list() just advertised.
  it('updates an item inside an array-valued translation', async () => {
    const { deps, service } = serviceWith({ steps: ['one', 'two'] });

    await service.update({
      locale: 'en',
      namespace: 'common',
      key: 'steps.1',
      value: 'TWO',
    });

    const written = Object.values(deps._files).find((raw) =>
      raw.includes('steps'),
    );

    expect(JSON.parse(written!)).toEqual({ steps: ['one', 'TWO'] });
  });

  it('refuses to address a list with a non-numeric segment', async () => {
    const { service } = serviceWith({ steps: ['one'] });

    await expect(
      service.update({
        locale: 'en',
        namespace: 'common',
        key: 'steps.first',
        value: 'x',
      }),
    ).rejects.toThrow(/is a list; address its items by numeric index/);
  });

  it('still refuses to overwrite a group with a scalar', async () => {
    const { service } = serviceWith({ billing: { plan: 'pro', seats: '3' } });

    await expect(
      service.update({
        locale: 'en',
        namespace: 'common',
        key: 'billing',
        value: 'oops',
      }),
    ).rejects.toThrow(/is a group of 2 translations/);
  });

  it('still refuses to traverse through a scalar', async () => {
    const { service } = serviceWith({ title: 'Dashboard' });

    await expect(
      service.update({
        locale: 'en',
        namespace: 'common',
        key: 'title.nested',
        value: 'x',
      }),
    ).rejects.toThrow(/is a translation value, not a group/);
  });
});
