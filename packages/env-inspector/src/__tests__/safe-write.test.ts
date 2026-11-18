import { describe, expect, it } from 'vitest';

import { createEnvInspectorService } from '../env-inspector.service';
import { parseEnvContent, setEnvValue } from '../parse';
import { WEB_APP, WEB_DIR, createMemoryDeps } from './helpers';

const BASE = [
  '# comment',
  'NEXT_PUBLIC_A=x',
  'STRIPE_SECRET_KEY=sk_live_SECRET',
  'DATABASE_URL="postgres://u:pw@h/db"',
  '',
].join('\n');

const NASTY_VALUES = [
  '"y',
  'z"',
  "'y",
  "z'",
  '`y',
  'a#b',
  'a #b',
  '#',
  '  leading',
  'trailing  ',
  ' ',
  '',
  'it\'s "quoted"',
  'back\\slash',
  'ends with \\',
  '\\"',
  'line1\nline2',
  'line1\n"line2"\nNEXT_PUBLIC_B=3',
  '-----BEGIN KEY-----\nabc\n-----END KEY-----\n',
  '[REDACTED]x',
];

function valuesOf(content: string) {
  return parseEnvContent(content).entries.map((entry) => [
    entry.key,
    entry.value,
  ]);
}

describe('setEnvValue round trip', () => {
  for (const value of NASTY_VALUES) {
    it(`appends ${JSON.stringify(value)} and reads it back exactly`, () => {
      const output = setEnvValue(BASE, 'NEXT_PUBLIC_Z', value);

      expect(valuesOf(output)).toEqual([
        ...valuesOf(BASE),
        ['NEXT_PUBLIC_Z', value],
      ]);
    });

    it(`replaces with ${JSON.stringify(value)} and reads it back exactly`, () => {
      const output = setEnvValue(BASE, 'NEXT_PUBLIC_A', value);

      expect(valuesOf(output)).toEqual(
        valuesOf(BASE).map(([key, current]) =>
          key === 'NEXT_PUBLIC_A' ? [key, value] : [key, current],
        ),
      );
    });

    it(`round-trips ${JSON.stringify(value)} in a CRLF file`, () => {
      const crlf = BASE.replace(/\n/g, '\r\n');
      const output = setEnvValue(crlf, 'NEXT_PUBLIC_Z', value);

      expect(valuesOf(output).at(-1)).toEqual(['NEXT_PUBLIC_Z', value]);
      expect(output.replace(/\r\n/g, '')).not.toMatch(/\n/);
    });
  }

  it('leaves plain values unquoted', () => {
    expect(setEnvValue('', 'A', 'https://x.dev/a?b=1&c=2')).toBe(
      'A=https://x.dev/a?b=1&c=2',
    );
  });

  it('refuses a carriage return in a value, writing nothing', () => {
    expect(() => setEnvValue(BASE, 'A', 'a\rb')).toThrow();
  });

  it('refuses a value with all three quotes, which dotenv cannot read back', () => {
    expect(() => setEnvValue(BASE, 'A', 'all \' " ` three')).toThrow(
      /all three quotes/,
    );
  });

  it('refuses a key that is not a variable name', () => {
    expect(() => setEnvValue(BASE, 'A\nSTRIPE_SECRET_KEY', 'x')).toThrow();
    expect(() => setEnvValue(BASE, 'A=B', 'x')).toThrow();
    expect(() => setEnvValue(BASE, '# A', 'x')).toThrow();
  });

  it('refuses a write that would change another variable', () => {
    // an unclosed quote a person left in the file: a value that closes it
    // would pull the lines in between into NEXT_PUBLIC_A
    const broken = 'NEXT_PUBLIC_A="open\nSTRIPE_SECRET_KEY=sk_live_SECRET\n';

    expect(() => setEnvValue(broken, 'NEXT_PUBLIC_Z', "it's")).toThrow(
      /Nothing was saved/,
    );
  });
});

describe('env_update cannot pull secrets into a public value', () => {
  it('keeps the secret out of NEXT_PUBLIC_A after two crafted updates', async () => {
    const { deps, store } = createMemoryDeps(
      { [`${WEB_DIR}/.env`]: BASE },
      {
        apps: WEB_APP,
        envFiles: { development: ['.env'] },
        writeTargets: { development: { secret: '.env', nonSecret: '.env' } },
      },
    );
    const service = createEnvInspectorService(deps);

    await service.update({ key: 'NEXT_PUBLIC_A', value: '"y' });
    await service.update({ key: 'NEXT_PUBLIC_Z', value: 'z"' });

    const { variables } = await service.read();

    expect(variables.NEXT_PUBLIC_A?.value).toBe('"y');
    expect(variables.NEXT_PUBLIC_Z?.value).toBe('z"');
    expect(variables.STRIPE_SECRET_KEY?.value).toBe('[REDACTED]');
    expect(JSON.stringify(variables)).not.toContain('sk_live_SECRET');
    expect(store[`${WEB_DIR}/.env`]).toContain(
      'STRIPE_SECRET_KEY=sk_live_SECRET\n',
    );
  });
});
