import { describe, expect, it } from 'vitest';

import { createEnvInspectorService } from '../env-inspector.service';
import { DEFAULT_INPUT_SCHEMAS } from '../schema';
import type { EnvInspectorSettings } from '../types';
import { kitModel } from './fixtures/kit-model';
import { ROOT, WEB_APP, WEB_DIR, createMemoryDeps } from './helpers';

/** The kit's configuration: its model, apps/web, values shown. */
const KIT_SETTINGS: EnvInspectorSettings = {
  model: kitModel,
  apps: WEB_APP,
  revealValues: true,
};

function createService(
  files: Record<string, string> = {},
  settings: EnvInspectorSettings = KIT_SETTINGS,
) {
  const { deps, store } = createMemoryDeps(files, settings);

  return { service: createEnvInspectorService(deps), store };
}

describe('EnvInspectorService.getSchema', () => {
  it('returns grouped env variables with the expected shape', async () => {
    const { service } = createService();
    const result = await service.getSchema();

    expect(result.groups.length).toBeGreaterThan(0);

    for (const group of result.groups) {
      expect(group.name).toBeTruthy();
      expect(group.description).toBeTruthy();
      expect(group.variables.length).toBeGreaterThan(0);

      for (const variable of group.variables) {
        expect(variable.key).toBeTruthy();
        expect(typeof variable.required).toBe('boolean');
        expect(typeof variable.sensitive).toBe('boolean');
        expect(
          ['string', 'url', 'email', 'number', 'boolean', 'enum'].includes(
            variable.type,
          ),
        ).toBe(true);
      }
    }
  });

  it('includes Stripe variables with dependency metadata', async () => {
    const { service } = createService();
    const result = await service.getSchema();

    const billingGroup = result.groups.find((g) => g.name === 'Billing');
    expect(billingGroup).toBeDefined();

    const stripeSecret = billingGroup!.variables.find(
      (v) => v.key === 'STRIPE_SECRET_KEY',
    );
    expect(stripeSecret).toBeDefined();
    expect(stripeSecret!.sensitive).toBe(true);
    expect(stripeSecret!.dependencies![0]!.variable).toBe(
      'NEXT_PUBLIC_BILLING_PROVIDER',
    );
  });

  it('does not throw when a variable has no contextualValidation', async () => {
    const { service } = createService();
    const result = await service.getSchema();
    const allVariables = result.groups.flatMap((group) => group.variables);

    expect(
      allVariables.find((variable) => variable.dependencies === undefined),
    ).toBeDefined();
  });

  it('returns no groups without a model', async () => {
    const { service } = createService({}, {});

    expect(await service.getSchema()).toEqual({ groups: [] });
  });
});

describe('EnvInspectorService.update', () => {
  it('replaces an existing key in place', async () => {
    const { service, store } = createService({
      [`${WEB_DIR}/.env.local`]:
        '# Comment\nEMAIL_SENDER=team@example.com\nOTHER=foo\n',
    });

    const result = await service.update({
      key: 'EMAIL_SENDER',
      value: 'hello@example.com',
      file: '.env.local',
    });

    expect(result).toEqual({
      success: true,
      message: 'Updated EMAIL_SENDER in .env.local',
    });
    expect(store[`${WEB_DIR}/.env.local`]).toBe(
      '# Comment\nEMAIL_SENDER=hello@example.com\nOTHER=foo\n',
    );
  });

  it('appends a new key when it does not exist', async () => {
    const { service, store } = createService({
      [`${WEB_DIR}/.env.local`]: 'EXISTING=value\n',
    });

    await service.update({
      key: 'NEW_KEY',
      value: 'new_value',
      file: '.env.local',
    });

    expect(store[`${WEB_DIR}/.env.local`]).toBe(
      'EXISTING=value\n\nNEW_KEY=new_value',
    );
  });

  it('creates the file if it does not exist', async () => {
    const { service, store } = createService();

    await service.update({
      key: 'BRAND_NEW',
      value: 'value',
      file: '.env.local',
    });

    expect(store[`${WEB_DIR}/.env.local`]).toBe('BRAND_NEW=value');
  });

  it('throws when key or value is missing', async () => {
    const { service } = createService();

    await expect(service.update({ value: 'v' })).rejects.toThrow(
      'Both key and value are required',
    );
    await expect(service.update({ key: 'FOO' })).rejects.toThrow(
      'Both key and value are required',
    );
  });

  it('writes secret keys to .env.local in development by default', async () => {
    const { service, store } = createService();

    await service.update({
      key: 'STRIPE_SECRET_KEY',
      value: 'sk_test_123',
      mode: 'development',
    });

    expect(store[`${WEB_DIR}/.env.local`]).toContain(
      'STRIPE_SECRET_KEY=sk_test_123',
    );
  });

  it('treats keys without an explicit secret flag as secret when choosing the file', async () => {
    const { service, store } = createService();

    // NEXT_PUBLIC_SITE_URL has no `secret` field in the model.
    await service.update({
      key: 'NEXT_PUBLIC_SITE_URL',
      value: 'http://localhost:3000',
      mode: 'development',
    });

    expect(store[`${WEB_DIR}/.env.local`]).toContain(
      'NEXT_PUBLIC_SITE_URL=http://localhost:3000',
    );
  });

  it('writes non-secret keys to the committed mode file', async () => {
    const { service, store } = createService();

    await service.update({ key: 'EMAIL_SENDER', value: 'a@b.co' });

    expect(store[`${WEB_DIR}/.env.development`]).toBe('EMAIL_SENDER=a@b.co');
  });

  it('writes secret keys to .env.production.local in production', async () => {
    const { service, store } = createService();

    await service.update({
      key: 'STRIPE_SECRET_KEY',
      value: 'sk_live_abc',
      mode: 'production',
    });

    expect(store[`${WEB_DIR}/.env.production.local`]).toContain(
      'STRIPE_SECRET_KEY=sk_live_abc',
    );
  });

  it('uses custom write targets', async () => {
    const { service, store } = createService(
      {},
      {
        ...KIT_SETTINGS,
        writeTargets: {
          development: { secret: '.env.development.local', nonSecret: '.env' },
        },
      },
    );

    await service.update({ key: 'STRIPE_SECRET_KEY', value: 'sk_1' });

    expect(store[`${WEB_DIR}/.env.development.local`]).toBe(
      'STRIPE_SECRET_KEY=sk_1',
    );
  });

  it('rejects unknown modes', async () => {
    const { service } = createService();

    await expect(
      service.update({ key: 'A', value: 'b', mode: 'staging' }),
    ).rejects.toThrow('Unknown mode "staging"');
  });

  it('does not default the file in the input schema', () => {
    const parsed = DEFAULT_INPUT_SCHEMAS.update.parse({
      key: 'FOO',
      value: 'bar',
      mode: 'production',
    });

    expect(parsed.file).toBeUndefined();
  });
});

describe('EnvInspectorService file guard', () => {
  it.each([
    ['traversal', '../../../../etc/passwd'],
    ['a source file', 'src/app.ts'],
    ['a near miss', '.env.staging'],
  ])('rejects %s in rawRead, rawWrite and update', async (_label, file) => {
    const { service } = createService();

    await expect(service.rawRead(file)).rejects.toThrow('Invalid env file');
    await expect(service.rawWrite(file, 'x')).rejects.toThrow(
      'Invalid env file',
    );
    await expect(
      service.update({ key: 'FOO', value: 'bar', file }),
    ).rejects.toThrow('Invalid env file');
  });

  it('allows configured env file names inside the app directory', async () => {
    const { service } = createService({
      [`${WEB_DIR}/.env.local`]: 'KEY=val',
    });

    expect((await service.rawRead('.env.local')).exists).toBe(true);
  });

  it('rejects env file names in settings that resolve outside the app', async () => {
    const { service } = createService(
      {},
      { ...KIT_SETTINGS, envFiles: { development: ['../.env'] } },
    );

    await expect(service.rawRead('../.env')).rejects.toThrow(
      'resolves outside the app directory',
    );
  });
});

describe('EnvInspectorService.rawRead / rawWrite', () => {
  it('returns content when the file exists', async () => {
    const { service } = createService({
      [`${WEB_DIR}/.env.local`]: '# My env\nFOO=bar\n',
    });

    expect(await service.rawRead('.env.local')).toEqual({
      content: '# My env\nFOO=bar\n',
      exists: true,
    });
  });

  it('returns empty content and exists: false when the file is missing', async () => {
    const { service } = createService();

    expect(await service.rawRead('.env.local')).toEqual({
      content: '',
      exists: false,
    });
  });

  it('overwrites a file with raw content', async () => {
    const { service, store } = createService({
      [`${WEB_DIR}/.env.local`]: 'OLD=content',
    });

    const result = await service.rawWrite('.env.local', '# New\nNEW=value');

    expect(result.success).toBe(true);
    expect(store[`${WEB_DIR}/.env.local`]).toBe('# New\nNEW=value');
  });

  it('creates the file when it does not exist', async () => {
    const { service, store } = createService();

    await service.rawWrite('.env.production', 'PROD_KEY=val');

    expect(store[`${WEB_DIR}/.env.production`]).toBe('PROD_KEY=val');
  });
});

describe('EnvInspectorService read / getAppState / getVariable', () => {
  it('getAppState reads the configured app', async () => {
    const { service } = createService({ [`${WEB_DIR}/.env`]: 'FOO=bar\n' });
    const states = await service.getAppState('development');

    expect(states).toHaveLength(1);
    expect(states[0]!.appName).toBe('web');
    expect(states[0]!.variables['FOO']!.effectiveValue).toBe('bar');
  });

  it('getVariable returns the effective value', async () => {
    const { service } = createService({
      [`${WEB_DIR}/.env`]: 'HELLO=world\n',
      [`${WEB_DIR}/.env.local`]: 'HELLO=local\n',
    });

    expect(await service.getVariable('HELLO', 'development')).toBe('local');
    expect(await service.getVariable('NOPE', 'development')).toBe('');
  });

  it('read handles model variables without contextualValidation', async () => {
    const { service } = createService({
      [`${WEB_DIR}/.env`]: 'NEXT_PUBLIC_SITE_URL=http://localhost:3000\n',
    });

    const result = await service.read('development');
    const variable = result.variables['NEXT_PUBLIC_SITE_URL'];

    expect(result.app).toBe('web');
    expect(variable?.value).toBe('http://localhost:3000');
    expect(variable?.dependencies).toBeUndefined();
  });

  it('read reports the override chain and dependency state', async () => {
    const { service } = createService({
      [`${WEB_DIR}/.env`]:
        'NEXT_PUBLIC_BILLING_PROVIDER=stripe\nSTRIPE_SECRET_KEY=sk_base\n',
      [`${WEB_DIR}/.env.local`]: 'STRIPE_SECRET_KEY=sk_local\n',
    });

    const result = await service.read('development');

    expect(result.variables['STRIPE_SECRET_KEY']).toEqual({
      key: 'STRIPE_SECRET_KEY',
      value: 'sk_local',
      source: '.env.local',
      isOverridden: true,
      overrideChain: [
        { source: '.env', value: 'sk_base' },
        { source: '.env.local', value: 'sk_local' },
      ],
      validation: { valid: true, errors: [] },
      dependencies: [
        {
          variable: 'NEXT_PUBLIC_BILLING_PROVIDER',
          condition:
            'STRIPE_SECRET_KEY is required when NEXT_PUBLIC_BILLING_PROVIDER is set to "stripe"',
          satisfied: true,
        },
      ],
    });
  });

  it('targets a second app by name', async () => {
    const { service } = createService(
      {
        [`${WEB_DIR}/.env`]: 'APP=web\n',
        [`${ROOT}/apps/admin/.env`]: 'APP=admin\n',
      },
      {
        apps: [...WEB_APP, { name: 'admin', path: 'apps/admin' }],
        revealValues: true,
      },
    );

    expect(
      (await service.read('development', 'admin')).variables['APP']!.value,
    ).toBe('admin');
    expect(await service.getAppState('development')).toHaveLength(2);
    await expect(service.read('development', 'docs')).rejects.toThrow(
      'Unknown app "docs"',
    );
  });
});
