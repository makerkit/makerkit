import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';

import {
  KIT_TOOL_SCHEMAS,
  KitDbSeedInputSchema,
  KitDbStatusOutputSchema,
  KitStatusOutputSchema,
  checkKitToolsContract,
} from '../index';

const status = {
  variant: 'void-cloudflare',
  framework: 'void',
  database: 'postgres',
  auth: 'better-auth',
  project_name: 'acme',
  node_version: '26.12.0',
  package_manager: 'pnpm',
  deps_installed: true,
  git_clean: true,
  git_branch: 'main',
  git_modified_files: [],
  git_untracked_files: [],
  services: {
    app: {
      name: 'App',
      running: true,
      port: 5173,
      url: 'http://localhost:5173',
    },
    database: { name: 'Postgres (PGlite)', running: true, port: 54323 },
  },
  diagnostics: [{ id: 'env', status: 'pass', message: '.env is complete' }],
};

const registered = (name: keyof typeof KIT_TOOL_SCHEMAS) => ({
  name,
  inputSchema: KIT_TOOL_SCHEMAS[name].input,
  outputSchema: KIT_TOOL_SCHEMAS[name].output,
});

describe('schemas', () => {
  it('take any kit: services by id, no Supabase-specific fields', () => {
    expect(KitStatusOutputSchema.parse(status).services).toHaveProperty(
      'database',
    );
    expect(JSON.stringify(z.toJSONSchema(KitStatusOutputSchema))).not.toMatch(
      /supabase/i,
    );
  });

  it('db status can name applied migrations that no longer have a file', () => {
    const migrations = { applied: 2, pending: 0, pending_names: [] };
    const status = { connected: true, tool: 'void', migrations };

    expect(KitDbStatusOutputSchema.parse(status).migrations).toEqual(
      migrations,
    );
    expect(
      KitDbStatusOutputSchema.parse({
        ...status,
        migrations: { ...migrations, unknown_names: ['0002_old'] },
      }).migrations.unknown_names,
    ).toEqual(['0002_old']);
  });

  it('seed only runs with confirm: true (false by default)', () => {
    expect(KitDbSeedInputSchema.parse({})).toEqual({ confirm: false });
  });
});

describe('checkKitToolsContract', () => {
  it('passes a kit that registers the shared schemas', () => {
    expect(
      checkKitToolsContract([
        registered('kit_status'),
        registered('kit_db_status'),
      ]),
    ).toEqual([]);
  });

  it('names a tool whose schema drifted', () => {
    const drifted = {
      ...registered('kit_status'),
      outputSchema: KitStatusOutputSchema.extend({
        supabase: z.object({ api_port: z.number() }),
      }),
    };

    expect(checkKitToolsContract([drifted])).toEqual([
      "kit_status's output schema differs from @makerkit/kit-tools",
    ]);
  });

  it('names a missing schema, a non-zod-4 schema and a missing required tool', () => {
    expect(
      checkKitToolsContract(
        [
          { name: 'kit_db_status', inputSchema: KitDbSeedInputSchema },
          { name: 'kit_dev_status', inputSchema: {}, outputSchema: {} },
        ],
        { required: ['kit_status'] },
      ),
    ).toEqual([
      'kit_status is not registered',
      "kit_db_status's input schema differs from @makerkit/kit-tools",
      'kit_db_status has no output schema',
      "kit_dev_status's input schema is not a zod v4 schema: use @makerkit/kit-tools",
      "kit_dev_status's output schema is not a zod v4 schema: use @makerkit/kit-tools",
    ]);
  });

  it('ignores tools that are not shared data tools', () => {
    expect(checkKitToolsContract([{ name: 'kit_translations_list' }])).toEqual(
      [],
    );
  });
});
