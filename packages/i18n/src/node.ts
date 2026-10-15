import type { I18nSettings, TranslationsDeps } from './translations.service';

import {
  access,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';

export interface I18nNodeOptions {
  settings?: I18nSettings;
}

/** Filesystem dependencies for a project on disk at `rootPath`. */
export function createI18nDeps(
  rootPath = process.cwd(),
  options: I18nNodeOptions = {},
): TranslationsDeps {
  return {
    rootPath,
    settings: options.settings,
    readFile(filePath) {
      return readFile(filePath, 'utf8');
    },
    writeFile(filePath, content) {
      return writeFile(filePath, content, 'utf8');
    },
    readdir(dirPath) {
      return readdir(dirPath);
    },
    stat(pathname) {
      return stat(pathname);
    },
    async fileExists(filePath) {
      try {
        await access(filePath);
        return true;
      } catch {
        return false;
      }
    },
    async mkdir(dirPath) {
      await mkdir(dirPath, { recursive: true });
    },
    unlink(filePath) {
      return unlink(filePath);
    },
    rmdir(dirPath) {
      return rm(dirPath, { recursive: true, force: true });
    },
  };
}
