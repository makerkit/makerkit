import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createI18nDeps } from '../node';
import { createTranslationsService } from '../translations.service';

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let root: string;
let messages: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'makerkit-i18n-'));
  messages = path.join(root, 'locales');

  await mkdir(path.join(messages, 'en'), { recursive: true });
  await writeFile(
    path.join(messages, 'en', 'common.json'),
    JSON.stringify({ title: 'Title' }),
  );
  await writeFile(path.join(messages, 'index.ts'), 'export {};');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('createI18nDeps', () => {
  it('adds, edits and removes locales and namespaces on disk', async () => {
    const service = createTranslationsService(
      createI18nDeps(root, { settings: { messagesDir: 'locales' } }),
    );

    expect((await service.list()).locales).toEqual(['en']);

    await service.addLocale({ locale: 'fr' });
    await service.addNamespace({ namespace: 'billing' });
    await service.update({
      locale: 'fr',
      namespace: 'billing',
      key: 'plan.name',
      value: 'Pro',
    });

    expect(
      JSON.parse(
        await readFile(path.join(messages, 'fr', 'billing.json'), 'utf8'),
      ),
    ).toEqual({ plan: { name: 'Pro' } });

    const stats = await service.stats();
    expect(stats.locale_count).toBe(2);
    expect(stats.namespace_count).toBe(2);

    await service.removeNamespace({ namespace: 'billing' });
    await service.removeLocale({ locale: 'fr' });

    const result = await service.list();
    expect(result.locales).toEqual(['en']);
    expect(result.namespaces).toEqual(['common']);
  });
});
