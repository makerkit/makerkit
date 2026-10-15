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
