import { describe, expect, it } from 'vitest';
import { z as z4 } from 'zod/v4';

import { VITE_ENV_FILES } from '../env-files';
import { createEnvInspectorService } from '../env-inspector.service';
import { registerEnvInspectorTools } from '../mcp';
import { EnvReadOutputSchema } from '../schema';
import { createFakeMcpServer } from '../testing/fake-mcp-server';
import type { EnvInspectorSettings, EnvVariableModel } from '../types';
import { WEB_APP, WEB_DIR, createMemoryDeps } from './helpers';

/** A model written for a non-Makerkit project. */
const CUSTOM_MODEL: EnvVariableModel[] = [
  {
    name: 'DATABASE_URL',
    description: 'Postgres connection string',
    category: 'Database',
    required: true,
    secret: true,
    type: 'url',
    validate: ({ value }) =>
      value.startsWith('postgres://')
        ? { success: true }
        : {
            success: false,
            error: { issues: [{ message: 'Must start with postgres://' }] },
          },
  },
  {
    name: 'PORT',
    type: 'number',
    secret: false,
    // A zod v4 safeParse result is accepted as a validation result.
    validate: ({ value }) => z4.coerce.number().int().safeParse(value),
  },
];

function setup(
  files: Record<string, string> = {},
  settings: EnvInspectorSettings = {},
  prefix?: string,
) {
  const { deps, store } = createMemoryDeps(files, {
    apps: WEB_APP,
    ...settings,
  });
  const fake = createFakeMcpServer();

  registerEnvInspectorTools(
    fake.server,
    createEnvInspectorService(deps),
    prefix ? { prefix } : {},
  );

  return { fake, store };
}

describe('registerEnvInspectorTools', () => {
  it('registers the five tools with annotations', () => {
    const { fake } = setup();

    expect(fake.tools.map((tool) => tool.name)).toEqual([
      'env_schema',
      'env_read',
      'env_update',
      'env_raw_read',
      'env_raw_write',
    ]);
    expect(fake.tool('env_read').config.annotations).toMatchObject({
      readOnlyHint: true,
    });
    expect(fake.tool('env_update').config.annotations).toMatchObject({
      readOnlyHint: false,
      idempotentHint: true,
    });
    expect(fake.tool('env_raw_write').config.annotations).toMatchObject({
      destructiveHint: true,
    });
  });

  it('keeps the kit tool names with the kit_ prefix', () => {
    const { fake } = setup({}, {}, 'kit_');

    expect(fake.tools.map((tool) => tool.name)).toEqual([
      'kit_env_schema',
      'kit_env_read',
      'kit_env_update',
      'kit_env_raw_read',
      'kit_env_raw_write',
    ]);
  });

  it('mentions redaction in the descriptions only when values are hidden', () => {
    const hidden = setup().fake.tool('env_read').config.description;
    const shown = setup({}, { revealValues: true }).fake.tool('env_read').config
      .description;

    expect(hidden).toContain('[REDACTED]');
    expect(shown).not.toContain('[REDACTED]');
  });

  it('validates a custom model and redacts its secrets', async () => {
    const { fake } = setup(
      {
        [`${WEB_DIR}/.env`]: 'PORT=3000\nDATABASE_URL=mysql://nope\n',
      },
      { model: CUSTOM_MODEL },
    );

    const schema = await fake.call('env_schema');
    expect(schema.structuredContent).toEqual({
      groups: [
        {
          name: 'Database',
          description: 'Database configuration',
          variables: [
            {
              key: 'DATABASE_URL',
              label: 'DATABASE_URL',
              description: 'Postgres connection string',
              required: true,
              type: 'url',
              sensitive: true,
            },
          ],
        },
        {
          name: 'General',
          description: 'General configuration',
          variables: [
            {
              key: 'PORT',
              label: 'PORT',
              description: '',
              required: false,
              type: 'number',
              sensitive: false,
            },
          ],
        },
      ],
    });

    const read = await fake.call('env_read', {});
    const output = EnvReadOutputSchema.parse(read.structuredContent);

    expect(output.mode).toBe('development');
    expect(output.variables['PORT']!.value).toBe('3000');
    expect(output.variables['PORT']!.validation.valid).toBe(true);
    expect(output.variables['DATABASE_URL']).toMatchObject({
      value: '[REDACTED]',
      source: '.env',
      validation: { valid: false, errors: ['Must start with postgres://'] },
    });
  });

  it('reports required variables that no file sets', async () => {
    const { fake } = setup({}, { model: CUSTOM_MODEL });

    const read = await fake.call('env_read', { mode: 'production' });
    const output = EnvReadOutputSchema.parse(read.structuredContent);

    expect(output.variables['DATABASE_URL']).toMatchObject({
      value: '',
      source: 'MISSING',
      validation: { valid: false },
    });
  });

  it('updates, reads and writes files through the tools', async () => {
    const { fake, store } = setup();

    const update = await fake.call('env_update', {
      key: 'FOO',
      value: 'bar',
      file: '.env',
    });
    expect(update.structuredContent).toEqual({
      success: true,
      message: 'Updated FOO in .env',
    });

    await fake.call('env_raw_write', { file: '.env', content: 'A=1' });
    expect(store[`${WEB_DIR}/.env`]).toBe('A=1');

    const raw = await fake.call('env_raw_read', { file: '.env' });
    expect(raw.structuredContent).toEqual({
      content: 'A=[REDACTED]',
      exists: true,
      redactedKeys: ['A'],
    });
  });

  it('rejects unknown modes and files with an error response', async () => {
    const { fake } = setup({}, { envFiles: VITE_ENV_FILES });

    const badMode = await fake.call('env_read', { mode: 'staging' });
    expect(badMode.isError).toBe(true);

    const badFile = await fake.call('env_raw_read', { file: 'package.json' });
    expect(badFile.isError).toBe(true);
    expect(JSON.stringify(badFile.content)).toContain('env_raw_read failed');
  });
});
