import { describe, expect, it } from 'vitest';

import { VITE_ENV_FILES, listEnvFileNames } from '../env-files';
import { DEFAULT_INPUT_SCHEMAS, createEnvInputSchemas } from '../schema';

/**
 * env_raw_write overwrites a whole file and env_update creates a missing one.
 * Both resolve `file` inside the app directory, so a free-form string could
 * still overwrite any source file there. The schema is the first guard; the
 * service checks the same list.
 */
describe('env tools only accept configured env file names', () => {
  const allowed = [
    '.env',
    '.env.local',
    '.env.development',
    '.env.development.local',
    '.env.production',
    '.env.production.local',
    '.env.test',
    '.env.test.local',
  ];

  it('accepts every Next.js env file name', () => {
    for (const file of allowed) {
      expect(DEFAULT_INPUT_SCHEMAS.file.parse(file)).toBe(file);
    }
  });

  it.each([
    ['a source file', 'src/router.tsx'],
    ['app config', 'src/config/app.config.ts'],
    ['package manifest', 'package.json'],
    ['traversal', '../../.env'],
    ['absolute path', '/etc/passwd'],
    ['near miss', '.env.staging'],
    ['empty', ''],
  ])('rejects %s', (_label, file) => {
    expect(() =>
      DEFAULT_INPUT_SCHEMAS.rawWrite.parse({ file, content: 'x' }),
    ).toThrow();
    expect(() => DEFAULT_INPUT_SCHEMAS.rawRead.parse({ file })).toThrow();
    expect(() =>
      DEFAULT_INPUT_SCHEMAS.update.parse({ key: 'K', value: 'v', file }),
    ).toThrow();
  });

  it('allows env_update to omit the file', () => {
    expect(() =>
      DEFAULT_INPUT_SCHEMAS.update.parse({ key: 'K', value: 'v' }),
    ).not.toThrow();
  });

  it('builds the mode and file lists from the settings', () => {
    const schemas = createEnvInputSchemas({
      modes: ['development', 'production'],
      files: listEnvFileNames({
        development: VITE_ENV_FILES['development']!,
        production: VITE_ENV_FILES['production']!,
      }),
      apps: ['web'],
      defaultMode: 'development',
    });

    expect(schemas.read.parse({})).toEqual({ mode: 'development' });
    expect(() => schemas.read.parse({ mode: 'test' })).toThrow();
    expect(() => schemas.rawRead.parse({ file: '.env.test' })).toThrow();
    expect(() => schemas.read.parse({ app: 'admin' })).toThrow();
  });
});
