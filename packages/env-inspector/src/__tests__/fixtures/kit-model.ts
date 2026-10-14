import { z } from 'zod/v3';

/**
 * A subset of a Makerkit kit's variable model, used to port the kit's tests.
 * Typed with the kit's narrower mode union to check that such models are
 * accepted by the package.
 */
type KitMode = 'development' | 'production';

interface KitVariable {
  name: string;
  displayName: string;
  description: string;
  category: string;
  hint?: string;
  secret?: boolean;
  required?: boolean;
  type?: 'string' | 'url' | 'enum';
  values?: string[];
  validate?: (props: {
    value: string;
    variables: Record<string, string>;
    mode: KitMode;
  }) => z.SafeParseReturnType<unknown, unknown>;
  contextualValidation?: {
    dependencies: Array<{
      variable: string;
      condition: (value: string, variables: Record<string, string>) => boolean;
      message: string;
    }>;
    validate: (props: {
      value: string;
      variables: Record<string, string>;
      mode: KitMode;
    }) => z.SafeParseReturnType<unknown, unknown>;
  };
}

const minOne = (name: string) =>
  z.string().min(1, `The ${name} variable must be at least 1 character`);

export const kitModel: KitVariable[] = [
  {
    name: 'NEXT_PUBLIC_SITE_URL',
    displayName: 'Site URL',
    description: 'The URL of your site.',
    category: 'Site Configuration',
    required: true,
    type: 'url',
    validate: ({ value, mode }) => {
      const url = z.string().url({
        message: `The NEXT_PUBLIC_SITE_URL variable must be a valid URL`,
      });

      if (mode === 'development') {
        return url.safeParse(value);
      }

      return url
        .startsWith(
          'https',
          `The NEXT_PUBLIC_SITE_URL variable must start with https`,
        )
        .safeParse(value);
    },
  },
  {
    name: 'NEXT_PUBLIC_BILLING_PROVIDER',
    displayName: 'Billing Provider',
    description: 'Your chosen billing provider.',
    category: 'Billing',
    required: true,
    type: 'enum',
    values: ['stripe', 'lemon-squeezy'],
    validate: ({ value }) =>
      z.enum(['stripe', 'lemon-squeezy']).optional().safeParse(value),
  },
  {
    name: 'STRIPE_SECRET_KEY',
    displayName: 'Stripe Secret Key',
    description: 'Your Stripe secret key.',
    category: 'Billing',
    secret: true,
    type: 'string',
    contextualValidation: {
      dependencies: [
        {
          variable: 'NEXT_PUBLIC_BILLING_PROVIDER',
          condition: (value) => value === 'stripe',
          message:
            'STRIPE_SECRET_KEY is required when NEXT_PUBLIC_BILLING_PROVIDER is set to "stripe"',
        },
      ],
      validate: ({ value }) =>
        minOne('STRIPE_SECRET_KEY')
          .refine((key) => key.startsWith('sk_') || key.startsWith('rk_'), {
            message: `The STRIPE_SECRET_KEY variable must start with sk_ or rk_`,
          })
          .safeParse(value),
    },
    validate: ({ value }) =>
      minOne('STRIPE_SECRET_KEY').optional().safeParse(value),
  },
  {
    name: 'LEMON_SQUEEZY_SECRET_KEY',
    displayName: 'Lemon Squeezy Secret Key',
    description: 'Your Lemon Squeezy secret key.',
    category: 'Billing',
    secret: true,
    type: 'string',
    contextualValidation: {
      dependencies: [
        {
          variable: 'NEXT_PUBLIC_BILLING_PROVIDER',
          condition: (value) => value === 'lemon-squeezy',
          message:
            'LEMON_SQUEEZY_SECRET_KEY is required when NEXT_PUBLIC_BILLING_PROVIDER is set to "lemon-squeezy"',
        },
      ],
      validate: ({ value }) =>
        minOne('LEMON_SQUEEZY_SECRET_KEY').safeParse(value),
    },
  },
  {
    name: 'CAPTCHA_SECRET_TOKEN',
    displayName: 'Captcha Secret Token',
    description: 'Your Captcha secret token.',
    category: 'Security',
    secret: true,
    type: 'string',
    contextualValidation: {
      dependencies: [
        {
          variable: 'NEXT_PUBLIC_CAPTCHA_SITE_KEY',
          condition: (value) => value !== '',
          message:
            'CAPTCHA_SECRET_TOKEN is required when NEXT_PUBLIC_CAPTCHA_SITE_KEY is set',
        },
      ],
      validate: ({ value }) => minOne('CAPTCHA_SECRET_TOKEN').safeParse(value),
    },
  },
  {
    name: 'SUPABASE_SERVICE_ROLE_KEY',
    displayName: 'Supabase Service Role Key',
    description: 'Your Supabase service role key.',
    category: 'Supabase',
    secret: true,
    type: 'string',
    validate: ({ value, variables }) =>
      minOne('SUPABASE_SERVICE_ROLE_KEY')
        .refine((key) => key !== variables['NEXT_PUBLIC_SUPABASE_ANON_KEY'], {
          message: `The SUPABASE_SERVICE_ROLE_KEY variable must be different from NEXT_PUBLIC_SUPABASE_ANON_KEY`,
        })
        .safeParse(value),
  },
  {
    name: 'EMAIL_SENDER',
    displayName: 'Email Sender',
    description: 'The address emails are sent from.',
    category: 'Email',
    secret: false,
    type: 'string',
  },
];
