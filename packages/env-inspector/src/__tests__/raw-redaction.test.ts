import { describe, expect, it } from 'vitest';

import { createEnvInspectorService } from '../env-inspector.service';
import { parseEnvContent } from '../parse';
import { REDACTED, redactEnvContent, restoreRedactedContent } from '../redact';
import { WEB_APP, WEB_DIR, createMemoryDeps } from './helpers';

const isSecret = (key: string) => !key.startsWith('NEXT_PUBLIC_');

const CURRENT = [
  '# OLD STRIPE_SECRET_KEY=sk_live_COMMENTED',
  'NEXT_PUBLIC_SITE_URL=http://localhost:3000',
  '',
  'sk_live_BARE_LINE',
  'STRIPE_SECRET_KEY=sk_live_SECRET',
  'EMPTY_SECRET=',
  'COMMENT_ONLY_SECRET= # sk_live_INLINE',
  'PEM=`-----BEGIN KEY-----',
  'NEXT_PUBLIC_INSIDE=sk_live_BACKTICK',
  '-----END KEY-----`',
  'NEXT_PUBLIC_LAST=ok',
].join('\n');

function rawService(files: Record<string, string>) {
  const { deps, store } = createMemoryDeps(files, {
    apps: WEB_APP,
    envFiles: { development: ['.env'] },
  });

  return { service: createEnvInspectorService(deps), store };
}

describe('raw read hides every line that is not a public entry', () => {
  it('redacts comments, bare lines and backtick bodies', () => {
    const { content, redactedKeys } = redactEnvContent(CURRENT, isSecret);

    expect(content).not.toContain('sk_live');
    expect(content.split('\n')).toEqual([
      `# ${REDACTED}:1`,
      'NEXT_PUBLIC_SITE_URL=http://localhost:3000',
      '',
      `# ${REDACTED}:2`,
      `STRIPE_SECRET_KEY=${REDACTED}`,
      'EMPTY_SECRET=',
      `COMMENT_ONLY_SECRET=${REDACTED}`,
      `PEM=${REDACTED}`,
      'NEXT_PUBLIC_LAST=ok',
    ]);
    expect(redactedKeys).toEqual([
      'STRIPE_SECRET_KEY',
      'COMMENT_ONLY_SECRET',
      'PEM',
    ]);
  });

  it('parses a backtick value across lines', () => {
    const { entries } = parseEnvContent(CURRENT);

    expect(entries.map((entry) => entry.key)).not.toContain(
      'NEXT_PUBLIC_INSIDE',
    );
    expect(entries.find((entry) => entry.key === 'PEM')?.value).toBe(
      '-----BEGIN KEY-----\nNEXT_PUBLIC_INSIDE=sk_live_BACKTICK\n-----END KEY-----',
    );
  });

  it('writes the redacted content back byte for byte', () => {
    const { content } = redactEnvContent(CURRENT, isSecret);

    expect(restoreRedactedContent(content, CURRENT)).toBe(CURRENT);
  });

  it('keeps CRLF line endings on redact and restore', () => {
    const crlf = CURRENT.replace(/\n/g, '\r\n');
    const { content } = redactEnvContent(crlf, isSecret);

    expect(content).not.toMatch(/[^\r]\n/);
    expect(restoreRedactedContent(content, crlf)).toBe(crlf);
  });

  it('refuses a line placeholder the current file has no line for', () => {
    expect(() => restoreRedactedContent(`# ${REDACTED}:9`, CURRENT)).toThrow(
      /read the file again/,
    );
  });

  it('refuses a restore that would pull a secret into a public value', () => {
    const current = 'STRIPE_SECRET_KEY="sk_live_QUOTED"\n';
    const written = `NEXT_PUBLIC_A="y\nSTRIPE_SECRET_KEY=${REDACTED}\n`;

    expect(() => restoreRedactedContent(written, current)).toThrow(
      /Nothing was saved/,
    );
  });

  it('rawWrite writes nothing when the restore is refused', async () => {
    const file = `${WEB_DIR}/.env`;
    const { service, store } = rawService({
      [file]: 'STRIPE_SECRET_KEY="sk_live_QUOTED"\n',
    });

    await expect(
      service.rawWrite(
        '.env',
        `NEXT_PUBLIC_A="y\nSTRIPE_SECRET_KEY=${REDACTED}\n`,
      ),
    ).rejects.toThrow();

    expect(store[file]).toBe('STRIPE_SECRET_KEY="sk_live_QUOTED"\n');
    const { variables } = await service.read();
    expect(JSON.stringify(variables)).not.toContain('sk_live');
  });

  it('hides lines that only look like assignments, and public tails', () => {
    const current = [
      'postgres://u:pw@h/db?sslmode=require',
      'ab+cd/ef==',
      'NEXT_PUBLIC_A=x # was sk_live_TAIL',
      'NEXT_PUBLIC_B="x" # was sk_live_AFTER',
      'NEXT_PUBLIC_C="quoted \\"ok\\""',
    ].join('\n');

    const { content } = redactEnvContent(current, isSecret);

    expect(content).not.toMatch(/pw@h|sk_live/);
    expect(content.split('\n')).toEqual([
      `# ${REDACTED}:1`,
      `# ${REDACTED}:2`,
      `NEXT_PUBLIC_A=${REDACTED}`,
      `NEXT_PUBLIC_B=${REDACTED}`,
      'NEXT_PUBLIC_C="quoted \\"ok\\""',
    ]);
    expect(restoreRedactedContent(content, current)).toBe(current);
    expect(parseEnvContent(current).entries.map((entry) => entry.key)).toEqual([
      'NEXT_PUBLIC_A',
      'NEXT_PUBLIC_B',
      'NEXT_PUBLIC_C',
    ]);
  });
});
