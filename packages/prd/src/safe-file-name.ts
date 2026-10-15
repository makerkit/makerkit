/**
 * Accept only a bare file name. Anything that could escape the intended
 * directory (path separators, parent references, hidden files) is rejected
 * before the filesystem is touched.
 */
export function assertSafeFileName(value: string, label = 'file name') {
  const name = value.trim();

  if (
    name.length === 0 ||
    name.includes('..') ||
    name.includes('/') ||
    name.includes('\\') ||
    name.startsWith('.')
  ) {
    throw new Error(`Invalid ${label} "${value}"`);
  }

  return name;
}

/**
 * Accept only a relative path that stays inside the directory it is joined
 * to: no absolute paths, no `..`, no backslashes, no empty or hidden segments.
 * This is a check on the text only; code that serves the file must still
 * resolve symlinks before reading it.
 */
export function assertSafeRelativePath(value: string, label = 'path') {
  const path = value.trim();
  const segments = path.split('/');

  if (
    path.length === 0 ||
    path.includes('\\') ||
    /^[a-zA-Z]:/.test(path) ||
    segments.some((segment) => segment.length === 0 || segment.startsWith('.'))
  ) {
    throw new Error(`Invalid ${label} "${value}"`);
  }

  return path;
}
