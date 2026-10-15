import { describe, expect, it } from 'vitest';

import { createEnvInspectorService } from '../env-inspector.service';
import {
  REDACTED,
  createSecretMatcher,
  redactEnvContent,
  restoreRedactedContent,
} from '../redact';
import type { EnvInspectorSettings } from '../types';
import { kitModel } from './fixtures/kit-model';
import { WEB_APP, WEB_DIR, createMemoryDeps } from './helpers';

const FILES = {
  [`${WEB_DIR}/.env`]: [
    'NEXT_PUBLIC_SITE_URL=http://localhost:3000',
    'NEXT_PUBLIC_BILLING_PROVIDER=stripe',
    'EMAIL_SENDER=team@example.com',
    'STRIPE_SECRET_KEY=sk_base_value',
  ].join('\n'),
  [`${WEB_DIR}/.env.local`]: [
    '# local secrets',
    'STRIPE_SECRET_KEY=bad_local_value',
    'UNKNOWN_TOKEN="abc123"',
    'EMPTY_SECRET=',
  ].join('\n'),
};

function createService(settings: EnvInspectorSettings = {}) {
  const { deps, store } = createMemoryDeps(FILES, {
    model: kitModel,
    apps: WEB_APP,
    ...settings,
  });

  return { service: createEnvInspectorService(deps), store };
}

describe('createSecretMatcher', () => {
  const isSecret = createSecretMatcher(kitModel, ['NEXT_PUBLIC_']);

  it('uses the model flag, then public prefixes, then treats the rest as secret', () => {
    expect(isSecret('STRIPE_SECRET_KEY')).toBe(true);
    expect(isSecret('EMAIL_SENDER')).toBe(false);
    expect(isSecret('NEXT_PUBLIC_SITE_URL')).toBe(false);
    expect(isSecret('UNKNOWN_TOKEN')).toBe(true);
  });
});

describe('read redaction', () => {
  it('redacts secret values, override chains and echoed values by default', async () => {
    const { service } = createService();
    const result = await service.read('development');
    const stripe = result.variables['STRIPE_SECRET_KEY']!;

    expect(stripe).toMatchObject({
      value: REDACTED,
      source: '.env.local',
      redacted: true,
      overrideChain: [
        { source: '.env', value: REDACTED },
        { source: '.env.local', value: REDACTED },
      ],
    });
    // Validation still runs on the real value.
    expect(stripe.validation).toEqual({
      valid: false,
      errors: ['The STRIPE_SECRET_KEY variable must start with sk_ or rk_'],
    });

    expect(result.variables['UNKNOWN_TOKEN']).toMatchObject({
      value: REDACTED,
      source: '.env.local',
      redacted: true,
    });
  });

  it('keeps public, non-secret and empty values', async () => {
    const { service } = createService();
    const { variables } = await service.read('development');

    expect(variables['NEXT_PUBLIC_SITE_URL']!.value).toBe(
      'http://localhost:3000',
    );
    expect(variables['EMAIL_SENDER']!.value).toBe('team@example.com');
    expect(variables['EMPTY_SECRET']!.value).toBe('');
    expect(variables['EMPTY_SECRET']!.redacted).toBeUndefined();
  });

  it('removes secret values that a validator echoes in its message', async () => {
    const { deps } = createMemoryDeps(
      { [`${WEB_DIR}/.env`]: 'API_KEY=super-secret-value' },
      {
        apps: WEB_APP,
        model: [
          {
            name: 'API_KEY',
            secret: true,
            validate: ({ value }) => ({
              success: false,
              error: { issues: [{ message: `Received "${value}"` }] },
            }),
          },
        ],
      },
    );

    const { variables } = await createEnvInspectorService(deps).read();

    expect(variables['API_KEY']!.validation.errors).toEqual([
      `Received "${REDACTED}"`,
    ]);
  });

  it('shows every value with revealValues: true', async () => {
    const { service } = createService({ revealValues: true });
    const { variables } = await service.read('development');

    expect(variables['STRIPE_SECRET_KEY']!.value).toBe('bad_local_value');
    expect(variables['STRIPE_SECRET_KEY']!.redacted).toBeUndefined();
    expect(variables['UNKNOWN_TOKEN']!.value).toBe('abc123');
  });

  it('never redacts the code-only getAppState and getVariable', async () => {
    const { service } = createService();

    expect(await service.getVariable('STRIPE_SECRET_KEY')).toBe(
      'bad_local_value',
    );

    const [state] = await service.getAppState();
    expect(state!.variables['UNKNOWN_TOKEN']!.effectiveValue).toBe('abc123');
  });
});

describe('raw read / write redaction', () => {
  it('redacts secret lines in raw content and lists the keys', async () => {
    const { service } = createService();

    expect(await service.rawRead('.env.local')).toEqual({
      content: [
        '# local secrets',
        `STRIPE_SECRET_KEY=${REDACTED}`,
        `UNKNOWN_TOKEN=${REDACTED}`,
        'EMPTY_SECRET=',
      ].join('\n'),
      exists: true,
      redactedKeys: ['STRIPE_SECRET_KEY', 'UNKNOWN_TOKEN'],
    });
  });

  it('returns raw content unchanged with revealValues: true', async () => {
    const { service } = createService({ revealValues: true });

    expect((await service.rawRead('.env.local')).content).toBe(
      FILES[`${WEB_DIR}/.env.local`],
    );
  });

  it('keeps current values when redacted content is written back', async () => {
    const { service, store } = createService();
    const { content } = await service.rawRead('.env.local');

    await service.rawWrite('.env.local', `${content}\nNEW_FLAG=true`);

    expect(store[`${WEB_DIR}/.env.local`]).toBe(
      `${FILES[`${WEB_DIR}/.env.local`]}\nNEW_FLAG=true`,
    );
  });

  it('refuses a placeholder that has no current value', async () => {
    const { service } = createService();

    await expect(
      service.rawWrite('.env.local', `NEW_SECRET=${REDACTED}`),
    ).rejects.toThrow('NEW_SECRET is set to [REDACTED]');
  });

  it('writes the placeholder literally with revealValues: true', async () => {
    const { service, store } = createService({ revealValues: true });

    await service.rawWrite('.env.local', `NEW_SECRET=${REDACTED}`);

    expect(store[`${WEB_DIR}/.env.local`]).toBe(`NEW_SECRET=${REDACTED}`);
  });
});

describe('update redaction', () => {
  it('rejects the placeholder as a value so a secret is not overwritten', async () => {
    const { service, store } = createService();

    await expect(
      service.update({
        key: 'STRIPE_SECRET_KEY',
        value: REDACTED,
        file: '.env.local',
      }),
    ).rejects.toThrow('[REDACTED] is not a value');
    await expect(
      service.update({ key: 'STRIPE_SECRET_KEY', value: `"${REDACTED}"` }),
    ).rejects.toThrow('[REDACTED] is not a value');

    expect(store[`${WEB_DIR}/.env.local`]).toBe(FILES[`${WEB_DIR}/.env.local`]);
  });

  it('accepts the placeholder literally with revealValues: true', async () => {
    const { service } = createService({ revealValues: true });

    await expect(
      service.update({ key: 'K', value: REDACTED }),
    ).resolves.toMatchObject({ success: true });
  });
});

describe('redactEnvContent / restoreRedactedContent', () => {
  const isSecret = () => true;

  it('redacts every line of a multiline quoted value', () => {
    const content = [
      'A=1',
      'PRIVATE_KEY="-----BEGIN KEY-----',
      'MIIEvQIBADANBgkqhkiG9w0BAQEFAAOCBKcw==',
      '-----END KEY-----"',
      'B=2',
    ].join('\n');

    const redacted = redactEnvContent(content, isSecret);

    expect(redacted.content).toBe(
      ['A=[REDACTED]', 'PRIVATE_KEY=[REDACTED]', 'B=[REDACTED]'].join('\n'),
    );
    expect(restoreRedactedContent(redacted.content, content)).toBe(content);
  });

  it('restores duplicates in order', () => {
    const current = 'K=first\nK=second';

    expect(restoreRedactedContent('K=[REDACTED]\nK=[REDACTED]', current)).toBe(
      current,
    );
  });
});
