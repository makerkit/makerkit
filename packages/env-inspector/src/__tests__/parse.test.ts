import { describe, expect, it } from 'vitest';

import { parseEnvFile, setEnvValue } from '../parse';

describe('parseEnvFile', () => {
  it('reads keys, values and 1-based lines, skipping comments and blanks', () => {
    const content = [
      '# comment',
      '',
      'A=1',
      'B="quoted value"',
      "C='single'",
      'export D=exported',
      'E=say \\"hi\\"',
      'F=',
    ].join('\n');

    expect(parseEnvFile(content, '.env')).toEqual([
      { key: 'A', value: '1', source: '.env', line: 3 },
      { key: 'B', value: 'quoted value', source: '.env', line: 4 },
      { key: 'C', value: 'single', source: '.env', line: 5 },
      { key: 'D', value: 'exported', source: '.env', line: 6 },
      { key: 'E', value: 'say "hi"', source: '.env', line: 7 },
      { key: 'F', value: '', source: '.env', line: 8 },
    ]);
  });

  it('reads a double-quoted value across lines', () => {
    const content = 'KEY="line one\nline two=x"\nNEXT=1';

    expect(parseEnvFile(content, '.env')).toEqual([
      { key: 'KEY', value: 'line one\nline two=x', source: '.env', line: 1 },
      { key: 'NEXT', value: '1', source: '.env', line: 3 },
    ]);
  });

  it('does not treat a closed quote followed by a comment as multiline', () => {
    const content = 'A="x" # note\nB="y"';

    expect(parseEnvFile(content, '.env').map((entry) => entry.key)).toEqual([
      'A',
      'B',
    ]);
  });
});

describe('setEnvValue', () => {
  it('replaces every assignment of the key, keeping export and comments', () => {
    expect(setEnvValue('# c\nexport A=1\nB=2\nA=3', 'A', 'new')).toBe(
      '# c\nexport A=new\nB=2\nA=new',
    );
  });

  it('replaces a multiline value as a whole', () => {
    expect(setEnvValue('K="a\nb"\nZ=1', 'K', 'v')).toBe('K=v\nZ=1');
  });

  it('quotes values that contain a newline', () => {
    expect(setEnvValue('', 'K', 'a\nb')).toBe('K="a\nb"');
  });
});
