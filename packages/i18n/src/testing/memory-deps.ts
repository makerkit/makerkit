import type { I18nSettings, TranslationsDeps } from '../translations.service';

import path from 'node:path';

// The service builds absolute paths with `path.resolve`, so the fixtures are
// anchored the same way. Inside the mock every path is canonicalized to forward
// slashes, which keeps the fixture keys readable and platform-independent.
export const ROOT = path.resolve('/repo');

export const toPosix = (filePath: string) => filePath.split(path.sep).join('/');

/** Absolute POSIX path of `segments` under the fake repository root. */
export function repoPath(...segments: string[]) {
  return toPosix(path.resolve(ROOT, ...segments));
}

/** In-memory TranslationsDeps; `_files` exposes the file store for assertions. */
export function createMemoryDeps(
  files: Record<string, string>,
  directories: string[],
  settings?: I18nSettings,
): TranslationsDeps & { _files: Record<string, string> } {
  const store = Object.fromEntries(
    Object.entries(files).map(([filePath, content]) => [
      toPosix(filePath),
      content,
    ]),
  );

  const dirSet = new Set(directories.map(toPosix));

  return {
    rootPath: ROOT,
    settings,
    async readFile(rawPath: string) {
      const filePath = toPosix(rawPath);

      if (!(filePath in store)) {
        const error = new Error(
          `ENOENT: no such file: ${filePath}`,
        ) as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }

      return store[filePath]!;
    },
    async writeFile(rawPath: string, content: string) {
      store[toPosix(rawPath)] = content;
    },
    async readdir(rawPath: string) {
      const dirPath = toPosix(rawPath);
      const entries = new Set<string>();

      for (const filePath of Object.keys(store)) {
        if (path.posix.dirname(filePath) === dirPath) {
          entries.add(path.posix.basename(filePath));
        }
      }

      for (const dir of dirSet) {
        if (path.posix.dirname(dir) === dirPath) {
          entries.add(path.posix.basename(dir));
        }
      }

      return Array.from(entries.values());
    },
    async stat(rawPath: string) {
      const targetPath = toPosix(rawPath);

      if (dirSet.has(targetPath)) {
        return { isDirectory: () => true };
      }

      if (targetPath in store) {
        return { isDirectory: () => false };
      }

      const error = new Error(
        `ENOENT: no such file or directory: ${targetPath}`,
      ) as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      throw error;
    },
    async fileExists(rawPath: string) {
      const filePath = toPosix(rawPath);

      return filePath in store || dirSet.has(filePath);
    },
    async mkdir(rawPath: string) {
      dirSet.add(toPosix(rawPath));
    },
    async unlink(rawPath: string) {
      delete store[toPosix(rawPath)];
    },
    async rmdir(rawPath: string) {
      const dirPath = toPosix(rawPath);
      const prefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;

      for (const key of Object.keys(store)) {
        if (key.startsWith(prefix)) {
          delete store[key];
        }
      }

      for (const dir of dirSet) {
        if (dir === dirPath || dir.startsWith(prefix)) {
          dirSet.delete(dir);
        }
      }
    },
    get _files() {
      return store;
    },
  };
}
