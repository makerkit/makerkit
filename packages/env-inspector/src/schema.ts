import { z } from 'zod/v3';

import { NEXTJS_ENV_FILES, listEnvFileNames } from './env-files';

export const EnvVariableTypeSchema = z.enum([
  'string',
  'url',
  'email',
  'number',
  'boolean',
  'enum',
]);

export const EnvSchemaInputSchema = z.object({});

export const EnvSchemaOutputSchema = z.object({
  groups: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      variables: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          description: z.string(),
          required: z.boolean(),
          type: EnvVariableTypeSchema,
          /** True when values are treated as secret (and redacted). */
          sensitive: z.boolean(),
          values: z.array(z.string()).optional(),
          hint: z.string().optional(),
          dependencies: z
            .array(
              z.object({
                variable: z.string(),
                condition: z.string(),
              }),
            )
            .optional(),
        }),
      ),
    }),
  ),
});

export const EnvReadVariableSchema = z.object({
  key: z.string(),
  /** The effective value, "[REDACTED]" for secrets, or "" when missing. */
  value: z.string(),
  /** The env file the value comes from, or "MISSING". */
  source: z.string(),
  isOverridden: z.boolean(),
  /** Every definition, lowest precedence first (only when more than one). */
  overrideChain: z
    .array(
      z.object({
        source: z.string(),
        value: z.string(),
      }),
    )
    .optional(),
  validation: z.object({
    valid: z.boolean(),
    errors: z.array(z.string()),
  }),
  dependencies: z
    .array(
      z.object({
        variable: z.string(),
        condition: z.string(),
        satisfied: z.boolean(),
      }),
    )
    .optional(),
  /** True when the values above were replaced with "[REDACTED]". */
  redacted: z.boolean().optional(),
});

export const EnvReadOutputSchema = z.object({
  mode: z.string(),
  app: z.string().optional(),
  variables: z.record(EnvReadVariableSchema),
});

export const EnvUpdateOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export const EnvRawReadOutputSchema = z.object({
  content: z.string(),
  exists: z.boolean(),
  /** Variables whose values were replaced with "[REDACTED]" in `content`. */
  redactedKeys: z.array(z.string()).optional(),
});

export const EnvRawWriteOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export interface EnvInputSchemaOptions {
  /** Modes accepted by `mode`. */
  modes: readonly string[];
  /** File names accepted by `file`. */
  files: readonly string[];
  /** App names accepted by `app`. */
  apps: readonly string[];
  defaultMode: string;
}

/**
 * Input schemas for the configured modes, env files and apps. `file` only
 * accepts the configured env file names: env_raw_write overwrites whole files
 * and env_update creates missing ones, so a free-form name would let an agent
 * rewrite any file in the app directory.
 */
export function createEnvInputSchemas(options: EnvInputSchemaOptions) {
  const mode = z.enum(toTuple(options.modes, 'mode'));
  const file = z.enum(toTuple(options.files, 'env file'));
  const app = z.enum(toTuple(options.apps, 'app')).optional();

  return {
    mode,
    file,
    read: z.object({
      mode: mode.default(options.defaultMode),
      app,
    }),
    update: z.object({
      key: z.string().min(1),
      value: z.string(),
      mode: mode.optional(),
      file: file.optional(),
      app,
    }),
    rawRead: z.object({
      file,
      app,
    }),
    rawWrite: z.object({
      file,
      content: z.string(),
      app,
    }),
  };
}

/** Input schemas for the default settings (Next.js files, one app). */
export const DEFAULT_INPUT_SCHEMAS = createEnvInputSchemas({
  modes: Object.keys(NEXTJS_ENV_FILES),
  files: listEnvFileNames(NEXTJS_ENV_FILES),
  apps: ['app'],
  defaultMode: 'development',
});

function toTuple(values: readonly string[], label: string) {
  const [first, ...rest] = values;

  if (first === undefined) {
    throw new Error(`At least one ${label} must be configured`);
  }

  return [first, ...rest] as [string, ...string[]];
}

export type EnvSchemaOutput = z.infer<typeof EnvSchemaOutputSchema>;
export type EnvReadVariable = z.infer<typeof EnvReadVariableSchema>;
export type EnvReadOutput = z.infer<typeof EnvReadOutputSchema>;
export type EnvUpdateOutput = z.infer<typeof EnvUpdateOutputSchema>;
export type EnvRawReadOutput = z.infer<typeof EnvRawReadOutputSchema>;
export type EnvRawWriteOutput = z.infer<typeof EnvRawWriteOutputSchema>;
export type EnvInputSchemas = ReturnType<typeof createEnvInputSchemas>;
