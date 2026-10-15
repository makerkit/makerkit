import { describe, expect, it } from 'vitest';

import { VITE_ENV_FILES } from '../env-files';
import { processEnvDefinitions } from '../resolve';
import type { EnvFileInfo, EnvVariableModel } from '../types';
import { kitModel } from './fixtures/kit-model';

type Definition = EnvFileInfo['variables'][number];

function envInfo(variables: Definition[]): EnvFileInfo {
  return { appName: 'web', filePath: '/repo/apps/web', variables };
}

function resolveVariables(
  variables: Definition[],
  mode = 'development',
  model: readonly EnvVariableModel[] = kitModel,
) {
  return processEnvDefinitions(envInfo(variables), mode, { model }).variables;
}

describe('processEnvDefinitions: override chains', () => {
  it('resolves development precedence (.env < .env.development < .env.local)', () => {
    const variable = resolveVariables([
      {
        key: 'NEXT_PUBLIC_SITE_URL',
        value: 'https://base.com',
        source: '.env',
      },
      {
        key: 'NEXT_PUBLIC_SITE_URL',
        value: 'https://local.com',
        source: '.env.local',
      },
      {
        key: 'NEXT_PUBLIC_SITE_URL',
        value: 'https://dev.com',
        source: '.env.development',
      },
    ])['NEXT_PUBLIC_SITE_URL']!;

    expect(variable.effectiveValue).toBe('https://local.com');
    expect(variable.effectiveSource).toBe('.env.local');
    expect(variable.isOverridden).toBe(true);
    expect(variable.definitions.map((def) => def.source)).toEqual([
      '.env',
      '.env.development',
      '.env.local',
    ]);
  });

  it('resolves production precedence (.env < .env.production < .env.local < .env.production.local)', () => {
    const variable = resolveVariables(
      [
        {
          key: 'NEXT_PUBLIC_SITE_URL',
          value: 'https://base.com',
          source: '.env',
        },
        {
          key: 'NEXT_PUBLIC_SITE_URL',
          value: 'https://prod.com',
          source: '.env.production',
        },
        {
          key: 'NEXT_PUBLIC_SITE_URL',
          value: 'https://local.com',
          source: '.env.local',
        },
        {
          key: 'NEXT_PUBLIC_SITE_URL',
          value: 'https://prod-local.com',
          source: '.env.production.local',
        },
      ],
      'production',
    )['NEXT_PUBLIC_SITE_URL']!;

    expect(variable.effectiveValue).toBe('https://prod-local.com');
    expect(variable.effectiveSource).toBe('.env.production.local');
    expect(variable.isOverridden).toBe(true);
  });

  it('uses the Vite order when configured (.env.development beats .env.local)', () => {
    const state = processEnvDefinitions(
      envInfo([
        { key: 'A', value: 'local', source: '.env.local' },
        { key: 'A', value: 'dev', source: '.env.development' },
      ]),
      'development',
      { envFiles: VITE_ENV_FILES },
    );

    expect(state.variables['A']!.effectiveValue).toBe('dev');
    expect(state.variables['A']!.effectiveSource).toBe('.env.development');
  });

  it('marks a single-source variable as not overridden', () => {
    const variable = resolveVariables([
      {
        key: 'NEXT_PUBLIC_SITE_URL',
        value: 'https://site.com',
        source: '.env',
      },
    ])['NEXT_PUBLIC_SITE_URL']!;

    expect(variable.isOverridden).toBe(false);
    expect(variable.effectiveSource).toBe('.env');
  });
});

describe('processEnvDefinitions: conditional requirements', () => {
  it('flags STRIPE_SECRET_KEY when the provider is stripe and the key is missing', () => {
    const stripeKey = resolveVariables([
      { key: 'NEXT_PUBLIC_BILLING_PROVIDER', value: 'stripe', source: '.env' },
    ])['STRIPE_SECRET_KEY']!;

    expect(stripeKey.effectiveSource).toBe('MISSING');
    expect(stripeKey.validation.success).toBe(false);
    // The contextual message is kept, not replaced by "required but missing".
    expect(
      stripeKey.validation.error.issues.some((issue) =>
        issue.includes('NEXT_PUBLIC_BILLING_PROVIDER'),
      ),
    ).toBe(true);
  });

  it('does not flag STRIPE_SECRET_KEY when the provider is lemon-squeezy', () => {
    const variables = resolveVariables([
      {
        key: 'NEXT_PUBLIC_BILLING_PROVIDER',
        value: 'lemon-squeezy',
        source: '.env',
      },
    ]);

    expect(variables['STRIPE_SECRET_KEY']).toBeUndefined();
    expect(variables['LEMON_SQUEEZY_SECRET_KEY']!.effectiveSource).toBe(
      'MISSING',
    );
    expect(variables['LEMON_SQUEEZY_SECRET_KEY']!.validation.success).toBe(
      false,
    );
  });

  it('validates the Stripe key format (must start with sk_ or rk_)', () => {
    const stripeKey = resolveVariables([
      { key: 'NEXT_PUBLIC_BILLING_PROVIDER', value: 'stripe', source: '.env' },
      {
        key: 'STRIPE_SECRET_KEY',
        value: 'invalid_key_123',
        source: '.env.local',
      },
    ])['STRIPE_SECRET_KEY']!;

    expect(stripeKey.validation.success).toBe(false);
    expect(stripeKey.validation.error.issues).toContain(
      'The STRIPE_SECRET_KEY variable must start with sk_ or rk_',
    );
  });

  it('passes the Stripe key when the format is correct', () => {
    const stripeKey = resolveVariables([
      { key: 'NEXT_PUBLIC_BILLING_PROVIDER', value: 'stripe', source: '.env' },
      {
        key: 'STRIPE_SECRET_KEY',
        value: 'sk_test_abc123',
        source: '.env.local',
      },
    ])['STRIPE_SECRET_KEY']!;

    expect(stripeKey.validation.success).toBe(true);
  });

  it('falls back to the plain validator when the dependencies are not met', () => {
    const stripeKey = resolveVariables([
      {
        key: 'NEXT_PUBLIC_BILLING_PROVIDER',
        value: 'lemon-squeezy',
        source: '.env',
      },
      // Not a Stripe-format key, but Stripe is not the provider: only the
      // plain validator (min length) applies.
      { key: 'STRIPE_SECRET_KEY', value: 'whatever', source: '.env.local' },
    ])['STRIPE_SECRET_KEY']!;

    expect(stripeKey.validation.success).toBe(true);
  });

  it('flags CAPTCHA_SECRET_TOKEN when CAPTCHA_SITE_KEY is set', () => {
    const captchaSecret = resolveVariables([
      {
        key: 'NEXT_PUBLIC_CAPTCHA_SITE_KEY',
        value: 'cap_site_123',
        source: '.env',
      },
    ])['CAPTCHA_SECRET_TOKEN']!;

    expect(captchaSecret.effectiveSource).toBe('MISSING');
    expect(captchaSecret.validation.success).toBe(false);
  });

  it('does not flag CAPTCHA_SECRET_TOKEN when CAPTCHA_SITE_KEY is absent', () => {
    expect(resolveVariables([])['CAPTCHA_SECRET_TOKEN']).toBeUndefined();
  });
});

describe('processEnvDefinitions: contextual validation without dependencies', () => {
  const model: EnvVariableModel[] = [
    {
      name: 'DATABASE_URL',
      contextualValidation: {
        dependencies: [],
        validate: ({ value, mode }) =>
          mode === 'production' && !value
            ? {
                success: false,
                error: { issues: [{ message: 'Required in production' }] },
              }
            : { success: true },
      },
    },
  ];

  it('always lists the variable and validates it for the mode', () => {
    const development = resolveVariables([], 'development', model)[
      'DATABASE_URL'
    ]!;
    const production = resolveVariables([], 'production', model)[
      'DATABASE_URL'
    ]!;

    expect(development.effectiveSource).toBe('MISSING');
    expect(development.validation.success).toBe(true);
    expect(production.validation.error.issues).toEqual([
      'Required in production',
    ]);
  });

  it('runs the contextual validator on a set value', () => {
    const variable = resolveVariables(
      [{ key: 'DATABASE_URL', value: 'postgres://x', source: '.env' }],
      'production',
      model,
    )['DATABASE_URL']!;

    expect(variable.validation.success).toBe(true);
  });
});

describe('processEnvDefinitions: mode-aware validations', () => {
  const siteUrl = (value: string, mode: string) =>
    resolveVariables(
      [{ key: 'NEXT_PUBLIC_SITE_URL', value, source: '.env' }],
      mode,
    )['NEXT_PUBLIC_SITE_URL']!;

  it('accepts an http SITE_URL in development', () => {
    expect(
      siteUrl('http://localhost:3000', 'development').validation.success,
    ).toBe(true);
  });

  it('rejects an http SITE_URL in production', () => {
    const variable = siteUrl('http://example.com', 'production');

    expect(variable.validation.success).toBe(false);
    expect(
      variable.validation.error.issues.some((issue) =>
        issue.toLowerCase().includes('https'),
      ),
    ).toBe(true);
  });

  it('accepts an https SITE_URL in production', () => {
    expect(
      siteUrl('https://example.com', 'production').validation.success,
    ).toBe(true);
  });
});

describe('processEnvDefinitions: cross-variable validations', () => {
  const serviceKey = (anon: string, service: string) =>
    resolveVariables([
      { key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', value: anon, source: '.env' },
      {
        key: 'SUPABASE_SERVICE_ROLE_KEY',
        value: service,
        source: '.env.local',
      },
    ])['SUPABASE_SERVICE_ROLE_KEY']!;

  it('flags SUPABASE_SERVICE_ROLE_KEY when it equals the anon key', () => {
    const variable = serviceKey('same-key', 'same-key');

    expect(variable.validation.success).toBe(false);
    expect(variable.validation.error.issues[0]).toContain('different');
  });

  it('passes when the keys differ', () => {
    expect(serviceKey('anon-123', 'service-456').validation.success).toBe(true);
  });
});

describe('processEnvDefinitions: missing variables', () => {
  it('adds missing required variables with source MISSING', () => {
    const siteUrl = resolveVariables([
      { key: 'NEXT_PUBLIC_BILLING_PROVIDER', value: 'stripe', source: '.env' },
    ])['NEXT_PUBLIC_SITE_URL']!;

    expect(siteUrl.effectiveSource).toBe('MISSING');
    expect(siteUrl.validation.error.issues).toEqual([
      'This variable is required but missing from your environment files',
    ]);
  });

  it('flags a required variable that is set to an empty value', () => {
    const siteUrl = resolveVariables([
      { key: 'NEXT_PUBLIC_SITE_URL', value: '', source: '.env' },
    ])['NEXT_PUBLIC_SITE_URL']!;

    expect(siteUrl.effectiveSource).toBe('.env');
    expect(siteUrl.validation.success).toBe(false);
  });
});

describe('processEnvDefinitions: same-file duplicates', () => {
  it('keeps every definition with its line, lets the last one win, and reports it', () => {
    const variable = resolveVariables([
      {
        key: 'STRIPE_WEBHOOK_SECRET',
        value: 'first',
        source: '.env.local',
        line: 3,
      },
      {
        key: 'STRIPE_WEBHOOK_SECRET',
        value: 'second',
        source: '.env.local',
        line: 44,
      },
    ])['STRIPE_WEBHOOK_SECRET']!;

    expect(variable.definitions.map((def) => def.line)).toEqual([3, 44]);
    expect(variable.effectiveValue).toBe('second');
    expect(variable.effectiveSource).toBe('.env.local (conflict)');
    expect(variable.validation.success).toBe(false);
    expect(variable.validation.error.issues).toContain(
      'Defined 2 times in .env.local (lines 3, 44); the last definition wins. Remove the earlier ones.',
    );
  });
});

describe('processEnvDefinitions: no model', () => {
  it('lists every variable as Custom and valid', () => {
    const state = processEnvDefinitions(
      envInfo([{ key: 'ANYTHING', value: 'x', source: '.env' }]),
      'development',
    );

    expect(state.variables['ANYTHING']).toMatchObject({
      category: 'Custom',
      effectiveSource: '.env',
      validation: { success: true },
    });
  });
});
