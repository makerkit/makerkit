/**
 * A mode such as `development`, `production` or `test`. The modes that exist
 * are the keys of the `envFiles` setting.
 */
export type EnvMode = string;

/** Env files for each mode, ordered from lowest to highest precedence. */
export type EnvFilePrecedence = Record<EnvMode, readonly string[]>;

export type EnvVariableType =
  | 'string'
  | 'longString'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'url'
  | 'email';

/**
 * What a validator returns. Zod's `safeParse` result (v3 and v4) has this
 * shape, so validators can return `schema.safeParse(value)` directly.
 */
export type EnvValidationResult =
  | { success: true }
  | {
      success: false;
      error: { issues: ReadonlyArray<{ message: string }> };
    };

export interface EnvValidationContext {
  /** The effective value of the variable, or '' when it is not set. */
  value: string;
  /** The effective value of every variable of the app. */
  variables: Record<string, string>;
  mode: EnvMode;
}

export interface EnvVariableDependency {
  /** The variable this one depends on. */
  variable: string;
  /** Message shown when the condition holds and this variable is invalid. */
  message: string;
  /** True when this variable must be validated, e.g. a provider is chosen. */
  condition(value: string, variables: Record<string, string>): boolean;
}

/**
 * One entry of the variable model. Only `name` is required. Validators are
 * declared with method syntax so models typed with a narrower mode union
 * (e.g. 'development' | 'production') are still accepted.
 */
export interface EnvVariableModel {
  name: string;
  /** Short label. Default: the name. */
  displayName?: string;
  description?: string;
  /** Example value or format, shown next to the description. */
  hint?: string;
  /**
   * True when the value must not be shown to agents. When omitted, variables
   * with a public prefix (see `publicPrefixes`) are treated as not secret and
   * every other variable as secret.
   */
  secret?: boolean;
  type?: EnvVariableType;
  /** Allowed values for `enum` variables. */
  values?: ReadonlyArray<string | null>;
  /** Group name. Default: "General". */
  category?: string;
  /** Reported as missing when no env file of the mode sets it. */
  required?: boolean;
  deprecated?: {
    reason: string;
    alternative?: string;
  };
  /** Validates a non-empty value. */
  validate?(context: EnvValidationContext): EnvValidationResult;
  /**
   * Validation that only applies when one of the dependency conditions holds
   * (e.g. STRIPE_SECRET_KEY only when the billing provider is "stripe"). With
   * an empty dependency list it always applies, including to a missing value.
   */
  contextualValidation?: {
    dependencies: readonly EnvVariableDependency[];
    validate(context: EnvValidationContext): EnvValidationResult;
  };
}

export type EnvVariableModelList = readonly EnvVariableModel[];

export interface EnvApp {
  /** Name used in results and in the tools' `app` input. */
  name: string;
  /** Directory holding the app's env files, relative to the root. */
  path: string;
}

export interface EnvWriteTargets {
  /** File for variables treated as secret (usually gitignored). */
  secret: string;
  /** File for other variables (usually committed). */
  nonSecret: string;
}

export interface EnvInspectorSettings {
  /** Variables to describe and validate. Default: none. */
  model?: EnvVariableModelList;
  /** Apps whose env files are read. Default: one app at the root. */
  apps?: readonly EnvApp[];
  /** Env files per mode, lowest precedence first. Default: Next.js order. */
  envFiles?: EnvFilePrecedence;
  /** Mode used when a call does not name one. Default: development. */
  defaultMode?: EnvMode;
  /** Where env_update writes when no file is given, per mode. */
  writeTargets?: Record<EnvMode, EnvWriteTargets>;
  /**
   * Show secret values in tool output. Default: false, which replaces them
   * with "[REDACTED]".
   */
  revealValues?: boolean;
  /**
   * Prefixes of variables that are inlined into client bundles and therefore
   * not secret, unless the model says otherwise.
   */
  publicPrefixes?: readonly string[];
}

export type EnvDefinition = {
  key: string;
  value: string;
  /** The env file name, e.g. ".env.local". */
  source: string;
  /** 1-based line in the source file; absent for synthetic definitions. */
  line?: number;
};

export type EnvVariableState = {
  key: string;
  category: string;
  /** Every definition, sorted from lowest to highest precedence. */
  definitions: EnvDefinition[];
  effectiveValue: string;
  /** True when more than one file (or line) defines the variable. */
  isOverridden: boolean;
  /**
   * File the effective value comes from. "MISSING" when no file sets it, and
   * suffixed with " (conflict)" when the winning file defines it twice.
   */
  effectiveSource: string;
  /** UI flag; always true from the engine. */
  isVisible: boolean;
  validation: {
    success: boolean;
    error: {
      issues: string[];
    };
  };
};

export type AppEnvState = {
  appName: string;
  /** Absolute directory of the app. */
  filePath: string;
  mode: EnvMode;
  variables: Record<string, EnvVariableState>;
};

export type EnvFileInfo = {
  appName: string;
  filePath: string;
  variables: Array<{
    key: string;
    value: string;
    line?: number;
    source: string;
  }>;
};

/** Filesystem access used to read env files. */
export interface EnvReadFs {
  readFile(filePath: string): Promise<string>;
  fileExists(filePath: string): Promise<boolean>;
}
