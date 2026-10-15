import type {
  TranslationsAddLocaleInput,
  TranslationsAddLocaleOutput,
  TranslationsAddNamespaceInput,
  TranslationsAddNamespaceOutput,
  TranslationsListOutput,
  TranslationsRemoveLocaleInput,
  TranslationsRemoveLocaleOutput,
  TranslationsRemoveNamespaceInput,
  TranslationsRemoveNamespaceOutput,
  TranslationsStatsOutput,
  TranslationsUpdateInput,
  TranslationsUpdateOutput,
} from './schema';

import path from 'node:path';

export interface I18nSettings {
  /**
   * Directory holding one folder per locale with one JSON file per namespace
   * (`<messagesDir>/<locale>/<namespace>.json`). Absolute or relative to
   * rootPath. Default: `public/locales` (the i18next / next-i18next layout).
   */
  messagesDir?: string;
  /**
   * Locale that coverage is measured against and that cannot be removed.
   * Used when it exists on disk; otherwise the first locale alphabetically.
   */
  baseLocale?: string;
  /** JSON indentation used when writing files. Default: 2 spaces. */
  indent?: number | string;
}

export const DEFAULT_MESSAGES_DIR = 'public/locales';

export interface TranslationsDeps {
  rootPath: string;
  settings?: I18nSettings;
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  readdir(dirPath: string): Promise<string[]>;
  stat(path: string): Promise<{ isDirectory(): boolean }>;
  fileExists(filePath: string): Promise<boolean>;
  mkdir(dirPath: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
  /** Removes a directory and everything in it. */
  rmdir(dirPath: string): Promise<void>;
}

export function createTranslationsService(deps: TranslationsDeps) {
  return new TranslationsService(deps);
}

export class TranslationsService {
  constructor(private readonly deps: TranslationsDeps) {}

  /** Absolute path of the directory that holds the locale folders. */
  get messagesDir() {
    return path.resolve(
      this.deps.rootPath,
      this.deps.settings?.messagesDir ?? DEFAULT_MESSAGES_DIR,
    );
  }

  async list(): Promise<TranslationsListOutput> {
    const localesRoot = this.messagesDir;
    const locales = await this.getLocaleDirectories(localesRoot);
    const translations: Record<
      string,
      Record<string, Record<string, string>>
    > = {};
    const namespaces = new Set<string>();

    for (const locale of locales) {
      const localeDir = this.resolveLocaleDir(localesRoot, locale);
      const files = await this.deps.readdir(localeDir);
      const jsonFiles = files.filter((file) => file.endsWith('.json'));

      translations[locale] = {};

      for (const file of jsonFiles) {
        const namespace = file.replace(/\.json$/, '');
        const filePath = path.join(localeDir, file);

        namespaces.add(namespace);

        translations[locale][namespace] =
          await this.readFlatTranslations(filePath);
      }
    }

    const namespaceList = Array.from(namespaces).sort();

    for (const locale of locales) {
      for (const namespace of namespaceList) {
        if (!translations[locale]?.[namespace]) {
          translations[locale]![namespace] = {};
        }
      }
    }

    return {
      base_locale: this.resolveBaseLocale(locales),
      locales,
      namespaces: namespaceList,
      translations,
    };
  }

  async update(
    input: TranslationsUpdateInput,
  ): Promise<TranslationsUpdateOutput> {
    const localesRoot = this.messagesDir;
    assertSinglePathSegment('locale', input.locale);
    assertSinglePathSegment('namespace', input.namespace);
    const localeDir = this.resolveLocaleDir(localesRoot, input.locale);
    const namespacePath = this.resolveNamespaceFile(localeDir, input.namespace);

    if (!(await this.isDirectory(localeDir))) {
      throw new Error(`Locale "${input.locale}" does not exist`);
    }

    if (!(await this.deps.fileExists(namespacePath))) {
      throw new Error(
        `Namespace "${input.namespace}" does not exist for locale "${input.locale}"`,
      );
    }

    const content = await this.deps.readFile(namespacePath);
    const parsed = this.parseJson(content, namespacePath);
    const keys = input.key.split('.').filter(Boolean);

    if (keys.length === 0) {
      throw new Error('Translation key must not be empty');
    }

    setNestedValue(parsed, keys, input.value);

    await this.deps.writeFile(namespacePath, this.serialize(parsed));

    return {
      success: true,
      file: toPosixPath(namespacePath),
    };
  }

  async stats(): Promise<TranslationsStatsOutput> {
    const { base_locale, locales, namespaces, translations } =
      await this.list();
    const baseTranslations = translations[base_locale] ?? {};
    const baseKeys = new Set<string>();

    for (const namespace of namespaces) {
      const entries = Object.keys(baseTranslations[namespace] ?? {});

      for (const key of entries) {
        baseKeys.add(`${namespace}:${key}`);
      }
    }

    const totalKeys = baseKeys.size;
    const coverage: TranslationsStatsOutput['coverage'] = {};

    for (const locale of locales) {
      let translated = 0;

      for (const compositeKey of baseKeys) {
        const [namespace = '', key = ''] = compositeKey.split(':');
        const value = translations[locale]?.[namespace]?.[key];

        if (typeof value === 'string' && value.length > 0) {
          translated += 1;
        }
      }

      const missing = totalKeys - translated;
      const percentage =
        totalKeys === 0
          ? 100
          : Number(((translated / totalKeys) * 100).toFixed(1));

      coverage[locale] = {
        total: totalKeys,
        translated,
        missing,
        percentage,
      };
    }

    return {
      base_locale,
      locale_count: locales.length,
      namespace_count: namespaces.length,
      total_keys: totalKeys,
      coverage,
    };
  }

  async addNamespace(
    input: TranslationsAddNamespaceInput,
  ): Promise<TranslationsAddNamespaceOutput> {
    const localesRoot = this.messagesDir;
    assertSinglePathSegment('namespace', input.namespace);

    const locales = await this.getLocaleDirectories(localesRoot);

    if (locales.length === 0) {
      throw new Error('No locales exist yet');
    }

    const filesCreated: string[] = [];

    for (const locale of locales) {
      const localeDir = this.resolveLocaleDir(localesRoot, locale);
      const namespacePath = this.resolveNamespaceFile(
        localeDir,
        input.namespace,
      );

      if (await this.deps.fileExists(namespacePath)) {
        throw new Error(`Namespace "${input.namespace}" already exists`);
      }
    }

    try {
      for (const locale of locales) {
        const localeDir = this.resolveLocaleDir(localesRoot, locale);
        const namespacePath = this.resolveNamespaceFile(
          localeDir,
          input.namespace,
        );

        await this.deps.writeFile(namespacePath, this.serialize({}));
        filesCreated.push(namespacePath);
      }
    } catch (error) {
      await this.removeFiles(filesCreated);

      throw error;
    }

    return {
      success: true,
      namespace: input.namespace,
      files_created: filesCreated.map(toPosixPath),
    };
  }

  async addLocale(
    input: TranslationsAddLocaleInput,
  ): Promise<TranslationsAddLocaleOutput> {
    const localesRoot = this.messagesDir;
    assertSinglePathSegment('locale', input.locale);

    const localeDir = this.resolveLocaleDir(localesRoot, input.locale);

    if (await this.isDirectory(localeDir)) {
      throw new Error(`Locale "${input.locale}" already exists`);
    }

    const existingLocales = await this.getLocaleDirectories(localesRoot);
    const namespaces = new Set<string>();

    for (const locale of existingLocales) {
      const dir = this.resolveLocaleDir(localesRoot, locale);
      const files = await this.deps.readdir(dir);

      for (const file of files) {
        if (file.endsWith('.json')) {
          namespaces.add(file.replace(/\.json$/, ''));
        }
      }
    }

    await this.deps.mkdir(localeDir);

    const filesCreated: string[] = [];

    try {
      for (const namespace of Array.from(namespaces).sort()) {
        const namespacePath = this.resolveNamespaceFile(localeDir, namespace);
        await this.deps.writeFile(namespacePath, this.serialize({}));
        filesCreated.push(namespacePath);
      }
    } catch (error) {
      await this.removeFiles(filesCreated);

      try {
        await this.deps.rmdir(localeDir);
      } catch {
        // best-effort cleanup
      }

      throw error;
    }

    return {
      success: true,
      locale: input.locale,
      files_created: filesCreated.map(toPosixPath),
    };
  }

  async removeNamespace(
    input: TranslationsRemoveNamespaceInput,
  ): Promise<TranslationsRemoveNamespaceOutput> {
    const localesRoot = this.messagesDir;
    assertSinglePathSegment('namespace', input.namespace);

    const locales = await this.getLocaleDirectories(localesRoot);
    const filesRemoved: string[] = [];

    for (const locale of locales) {
      const localeDir = this.resolveLocaleDir(localesRoot, locale);
      const namespacePath = this.resolveNamespaceFile(
        localeDir,
        input.namespace,
      );

      if (await this.deps.fileExists(namespacePath)) {
        await this.deps.unlink(namespacePath);
        filesRemoved.push(namespacePath);
      }
    }

    if (filesRemoved.length === 0) {
      throw new Error(`Namespace "${input.namespace}" does not exist`);
    }

    return {
      success: true,
      namespace: input.namespace,
      files_removed: filesRemoved.map(toPosixPath),
    };
  }

  async removeLocale(
    input: TranslationsRemoveLocaleInput,
  ): Promise<TranslationsRemoveLocaleOutput> {
    const localesRoot = this.messagesDir;
    assertSinglePathSegment('locale', input.locale);

    const localeDir = this.resolveLocaleDir(localesRoot, input.locale);

    if (!(await this.isDirectory(localeDir))) {
      throw new Error(`Locale "${input.locale}" does not exist`);
    }

    const locales = await this.getLocaleDirectories(localesRoot);

    if (input.locale === this.resolveBaseLocale(locales)) {
      throw new Error(`Cannot remove base locale "${input.locale}"`);
    }

    await this.deps.rmdir(localeDir);

    return {
      success: true,
      locale: input.locale,
      path_removed: toPosixPath(localeDir),
    };
  }

  private resolveBaseLocale(locales: string[]) {
    const configured = this.deps.settings?.baseLocale;

    if (configured && locales.includes(configured)) {
      return configured;
    }

    return locales[0] ?? '';
  }

  private serialize(value: Record<string, unknown>) {
    return `${JSON.stringify(value, null, this.deps.settings?.indent ?? 2)}\n`;
  }

  private async removeFiles(filePaths: string[]) {
    for (const filePath of filePaths) {
      try {
        await this.deps.unlink(filePath);
      } catch {
        // best-effort cleanup
      }
    }
  }

  private async getLocaleDirectories(localesRoot: string) {
    if (!(await this.deps.fileExists(localesRoot))) {
      return [];
    }

    const entries = await this.deps.readdir(localesRoot);
    const locales: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(localesRoot, entry);

      if (await this.isDirectory(fullPath)) {
        locales.push(entry);
      }
    }

    return locales.sort();
  }

  private async isDirectory(targetPath: string) {
    try {
      const stats = await this.deps.stat(targetPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  private async readFlatTranslations(filePath: string) {
    try {
      const content = await this.deps.readFile(filePath);
      const parsed = this.parseJson(content, filePath);
      return flattenTranslations(parsed);
    } catch {
      return {};
    }
  }

  private parseJson(content: string, filePath: string) {
    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      throw new Error(`Invalid JSON in ${toPosixPath(filePath)}`);
    }
  }

  private resolveLocaleDir(localesRoot: string, locale: string) {
    const resolved = path.resolve(localesRoot, locale);
    return ensureInsideRoot(resolved, localesRoot, locale);
  }

  private resolveNamespaceFile(localeDir: string, namespace: string) {
    const resolved = path.resolve(localeDir, `${namespace}.json`);
    return ensureInsideRoot(resolved, localeDir, namespace);
  }
}

/**
 * Paths travel to the client POSIX-shaped so tool output does not change with
 * the host platform. Only emitted values are converted; the paths handed to
 * the fs deps stay native.
 */
function toPosixPath(filePath: string) {
  return filePath.split(path.sep).join('/');
}

function ensureInsideRoot(resolved: string, root: string, input: string) {
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;

  if (!resolved.startsWith(rootWithSep) && resolved !== root) {
    throw new Error(
      `Invalid path: "${input}" resolves outside the locales root`,
    );
  }

  return resolved;
}

function flattenTranslations(
  obj: Record<string, unknown>,
  prefix = '',
  result: Record<string, string> = {},
) {
  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'string') {
      result[newKey] = value;
      continue;
    }

    if (value && typeof value === 'object') {
      flattenTranslations(value as Record<string, unknown>, newKey, result);
      continue;
    }

    if (value !== undefined) {
      result[newKey] = String(value);
    }
  }

  return result;
}

const RESERVED_KEY_SEGMENTS = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

function setNestedValue(
  target: Record<string, unknown>,
  keys: string[],
  value: string,
) {
  // `__proto__` resolves to Object.prototype, which is a real object and so
  // walks straight past the "is this a group?" check below; traversing into it
  // and assigning would pollute every object in the process. These segments
  // can never name a real translation, so reject them outright.
  const reserved = keys.find((key) => RESERVED_KEY_SEGMENTS.has(key));

  if (reserved) {
    throw new Error(
      `Cannot set "${keys.join('.')}": "${reserved}" is a reserved property name.`,
    );
  }

  let current = target;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!;
    const next = current[key];

    if (next === undefined || next === null) {
      current[key] = {};
    } else if (Array.isArray(next)) {
      // `flattenTranslations` publishes array items as `key.0`, so an update
      // to a key that list() returned has to be able to walk back into the
      // array. Only a numeric index may do so.
      if (!/^\d+$/.test(keys[i + 1]!)) {
        throw new Error(
          `Cannot set "${keys.join('.')}": "${keys.slice(0, i + 1).join('.')}" is a list; address its items by numeric index.`,
        );
      }
    } else if (typeof next !== 'object') {
      throw new Error(
        `Cannot set "${keys.join('.')}": "${keys.slice(0, i + 1).join('.')}" is a translation value, not a group. Delete or rename it first.`,
      );
    }

    current = current[key] as Record<string, unknown>;
  }

  const lastKey = keys[keys.length - 1]!;
  const existing = current[lastKey];

  if (
    existing !== undefined &&
    existing !== null &&
    typeof existing === 'object'
  ) {
    throw new Error(
      `Cannot set "${keys.join('.')}": it is a group of ${Object.keys(existing).length} translations, not a single value.`,
    );
  }

  current[lastKey] = value;
}

function assertSinglePathSegment(name: string, value: string) {
  if (value === '.' || value === '..') {
    throw new Error(`${name} must be a valid path segment`);
  }

  if (value.includes('..')) {
    throw new Error(`${name} must not contain ".."`);
  }

  if (value.includes('/') || value.includes('\\')) {
    throw new Error(`${name} must not include path separators`);
  }

  if (value.includes('\0')) {
    throw new Error(`${name} must not contain null bytes`);
  }
}
