import type {
  EnvApp,
  EnvFilePrecedence,
  EnvMode,
  EnvWriteTargets,
} from './types';

/**
 * Next.js load order, lowest precedence first. `.env.local` is not loaded in
 * test mode.
 */
export const NEXTJS_ENV_FILES: EnvFilePrecedence = {
  development: [
    '.env',
    '.env.development',
    '.env.local',
    '.env.development.local',
  ],
  production: [
    '.env',
    '.env.production',
    '.env.local',
    '.env.production.local',
  ],
  test: ['.env', '.env.test', '.env.test.local'],
};

/**
 * Vite load order, lowest precedence first: mode-specific files override
 * `.env.local`.
 */
export const VITE_ENV_FILES: EnvFilePrecedence = {
  development: [
    '.env',
    '.env.local',
    '.env.development',
    '.env.development.local',
  ],
  production: [
    '.env',
    '.env.local',
    '.env.production',
    '.env.production.local',
  ],
  test: ['.env', '.env.local', '.env.test', '.env.test.local'],
};

/**
 * Secrets go to a gitignored `.local` file; other values to the committed
 * mode file. Modes not listed here use `.env.<mode>.local` and `.env.<mode>`.
 */
export const DEFAULT_WRITE_TARGETS: Record<EnvMode, EnvWriteTargets> = {
  development: { secret: '.env.local', nonSecret: '.env.development' },
  production: {
    secret: '.env.production.local',
    nonSecret: '.env.production',
  },
  test: { secret: '.env.test.local', nonSecret: '.env.test' },
};

/** Prefixes that frameworks inline into client code. */
export const DEFAULT_PUBLIC_PREFIXES = [
  'NEXT_PUBLIC_',
  'VITE_',
  'PUBLIC_',
  'EXPO_PUBLIC_',
] as const;

export const DEFAULT_APPS: readonly EnvApp[] = [{ name: 'app', path: '.' }];

export const DEFAULT_MODE = 'development';

/** Position of `source` in the mode's precedence list (-1 when unknown). */
export function getSourcePrecedence(
  envFiles: EnvFilePrecedence,
  source: string,
  mode: EnvMode,
) {
  return (envFiles[mode] ?? []).indexOf(source);
}

/** Every file name that appears in any mode, in first-seen order. */
export function listEnvFileNames(envFiles: EnvFilePrecedence) {
  return [...new Set(Object.values(envFiles).flat())];
}

export function getWriteTarget(
  targets: Record<EnvMode, EnvWriteTargets>,
  mode: EnvMode,
  secret: boolean,
) {
  const target = targets[mode] ?? {
    secret: `.env.${mode}.local`,
    nonSecret: `.env.${mode}`,
  };

  return secret ? target.secret : target.nonSecret;
}
