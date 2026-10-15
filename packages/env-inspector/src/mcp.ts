import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { EnvInspectorService } from './env-inspector.service';
import {
  EnvRawReadOutputSchema,
  EnvRawWriteOutputSchema,
  EnvReadOutputSchema,
  EnvSchemaInputSchema,
  EnvSchemaOutputSchema,
  EnvUpdateOutputSchema,
  createEnvInputSchemas,
} from './schema';
import {
  DESTRUCTIVE_TOOL,
  IDEMPOTENT_MUTATING_TOOL,
  READ_ONLY_TOOL,
  buildErrorResponse,
  buildStructuredResponse,
} from './tool-response';

export interface RegisterEnvInspectorOptions {
  /** Prepended to every tool name, e.g. "kit_" keeps a kit's existing names. */
  prefix?: string;
}

/**
 * Registers env_schema, env_read, env_update, env_raw_read and env_raw_write.
 * The accepted modes, env file names and apps come from the service settings.
 */
export function registerEnvInspectorTools(
  server: McpServer,
  service: EnvInspectorService,
  options: RegisterEnvInspectorOptions = {},
) {
  const name = (tool: string) => `${options.prefix ?? ''}${tool}`;

  const inputs = createEnvInputSchemas({
    modes: service.modes,
    files: service.envFileNames,
    apps: service.apps.map((app) => app.name),
    defaultMode: service.defaultMode,
  });

  const redactionNote = service.revealValues
    ? ''
    : ' Values of secret variables are returned as "[REDACTED]".';

  server.registerTool(
    name('env_schema'),
    {
      title: 'Describe environment variables',
      description:
        'List the known environment variables by group with description, type, whether they are required or secret, and the variables they depend on. Contains no values.',
      inputSchema: EnvSchemaInputSchema,
      outputSchema: EnvSchemaOutputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async () => {
      try {
        return buildStructuredResponse(await service.getSchema());
      } catch (error) {
        return buildErrorResponse(name('env_schema'), error);
      }
    },
  );

  server.registerTool(
    name('env_read'),
    {
      title: 'Read environment variables',
      description:
        'Read the environment variables of an app for a mode (development, production...): effective value, the .env file it comes from, the override chain across files, and validation errors. ' +
        'Required variables that no file sets are listed with source "MISSING".' +
        redactionNote,
      inputSchema: inputs.read,
      outputSchema: EnvReadOutputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async (input) => {
      try {
        const parsed = inputs.read.parse(input);

        return buildStructuredResponse(
          await service.read(parsed.mode, parsed.app),
        );
      } catch (error) {
        return buildErrorResponse(name('env_read'), error);
      }
    },
  );

  server.registerTool(
    name('env_update'),
    {
      title: 'Set an environment variable',
      description:
        'Set one environment variable in an .env file, replacing its existing line or appending it. ' +
        "Without `file`, secrets go to the mode's gitignored .local file and other variables to the mode's committed file." +
        (service.revealValues ? '' : ' "[REDACTED]" is rejected as a value.'),
      inputSchema: inputs.update,
      outputSchema: EnvUpdateOutputSchema,
      annotations: IDEMPOTENT_MUTATING_TOOL,
    },
    async (input) => {
      try {
        return buildStructuredResponse(
          await service.update(inputs.update.parse(input)),
        );
      } catch (error) {
        return buildErrorResponse(name('env_update'), error);
      }
    },
  );

  server.registerTool(
    name('env_raw_read'),
    {
      title: 'Read an .env file',
      description: 'Read the raw content of one .env file.' + redactionNote,
      inputSchema: inputs.rawRead,
      outputSchema: EnvRawReadOutputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async (input) => {
      try {
        const parsed = inputs.rawRead.parse(input);

        return buildStructuredResponse(
          await service.rawRead(parsed.file, parsed.app),
        );
      } catch (error) {
        return buildErrorResponse(name('env_raw_read'), error);
      }
    },
  );

  server.registerTool(
    name('env_raw_write'),
    {
      title: 'Write an .env file',
      description:
        'Replace the content of one .env file.' +
        (service.revealValues
          ? ''
          : ' Lines whose value is "[REDACTED]" keep the value the file has now.'),
      inputSchema: inputs.rawWrite,
      outputSchema: EnvRawWriteOutputSchema,
      annotations: DESTRUCTIVE_TOOL,
    },
    async (input) => {
      try {
        const parsed = inputs.rawWrite.parse(input);

        return buildStructuredResponse(
          await service.rawWrite(parsed.file, parsed.content, parsed.app),
        );
      } catch (error) {
        return buildErrorResponse(name('env_raw_write'), error);
      }
    },
  );
}
