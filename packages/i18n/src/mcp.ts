import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  TranslationsAddLocaleInputSchema,
  TranslationsAddLocaleOutputSchema,
  TranslationsAddNamespaceInputSchema,
  TranslationsAddNamespaceOutputSchema,
  TranslationsListInputSchema,
  TranslationsListOutputSchema,
  TranslationsRemoveLocaleInputSchema,
  TranslationsRemoveLocaleOutputSchema,
  TranslationsRemoveNamespaceInputSchema,
  TranslationsRemoveNamespaceOutputSchema,
  TranslationsStatsInputSchema,
  TranslationsStatsOutputSchema,
  TranslationsUpdateInputSchema,
  TranslationsUpdateOutputSchema,
} from './schema';
import {
  DESTRUCTIVE_TOOL,
  IDEMPOTENT_MUTATING_TOOL,
  MUTATING_TOOL,
  READ_ONLY_TOOL,
  buildErrorResponse,
  buildStructuredResponse,
} from './tool-response';
import type { TranslationsService } from './translations.service';

export interface RegisterI18nOptions {
  /** Prepended to every tool name, e.g. "kit_" keeps a kit's existing names. */
  prefix?: string;
}

/** Registers the seven translations_* tools. */
export function registerI18nTools(
  server: McpServer,
  service: TranslationsService,
  options: RegisterI18nOptions = {},
) {
  const name = (tool: string) => `${options.prefix ?? ''}${tool}`;

  server.registerTool(
    name('translations_list'),
    {
      title: 'List translations',
      description:
        'List translations across locales and namespaces. Keys are flattened with dots (e.g. "header.title").',
      inputSchema: TranslationsListInputSchema,
      outputSchema: TranslationsListOutputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async () => {
      try {
        return buildStructuredResponse(await service.list());
      } catch (error) {
        return buildErrorResponse(name('translations_list'), error);
      }
    },
  );

  server.registerTool(
    name('translations_update'),
    {
      title: 'Update a translation',
      description:
        'Set a translation value in a locale namespace. Use a dot-separated key for nested values; missing groups are created.',
      inputSchema: TranslationsUpdateInputSchema,
      outputSchema: TranslationsUpdateOutputSchema,
      annotations: IDEMPOTENT_MUTATING_TOOL,
    },
    async (input) => {
      try {
        const parsed = TranslationsUpdateInputSchema.parse(input);

        return buildStructuredResponse(await service.update(parsed));
      } catch (error) {
        return buildErrorResponse(name('translations_update'), error);
      }
    },
  );

  server.registerTool(
    name('translations_stats'),
    {
      title: 'Translation coverage',
      description:
        'Get translation coverage per locale, measured against the keys of the base locale.',
      inputSchema: TranslationsStatsInputSchema,
      outputSchema: TranslationsStatsOutputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async () => {
      try {
        return buildStructuredResponse(await service.stats());
      } catch (error) {
        return buildErrorResponse(name('translations_stats'), error);
      }
    },
  );

  server.registerTool(
    name('translations_add_namespace'),
    {
      title: 'Add a namespace',
      description:
        'Create a new translation namespace (an empty JSON file) in every locale.',
      inputSchema: TranslationsAddNamespaceInputSchema,
      outputSchema: TranslationsAddNamespaceOutputSchema,
      annotations: MUTATING_TOOL,
    },
    async (input) => {
      try {
        const parsed = TranslationsAddNamespaceInputSchema.parse(input);

        return buildStructuredResponse(await service.addNamespace(parsed));
      } catch (error) {
        return buildErrorResponse(name('translations_add_namespace'), error);
      }
    },
  );

  server.registerTool(
    name('translations_add_locale'),
    {
      title: 'Add a locale',
      description:
        'Add a new locale with an empty file for every existing namespace.',
      inputSchema: TranslationsAddLocaleInputSchema,
      outputSchema: TranslationsAddLocaleOutputSchema,
      annotations: MUTATING_TOOL,
    },
    async (input) => {
      try {
        const parsed = TranslationsAddLocaleInputSchema.parse(input);

        return buildStructuredResponse(await service.addLocale(parsed));
      } catch (error) {
        return buildErrorResponse(name('translations_add_locale'), error);
      }
    },
  );

  server.registerTool(
    name('translations_remove_namespace'),
    {
      title: 'Remove a namespace',
      description: 'Delete a translation namespace file from every locale.',
      inputSchema: TranslationsRemoveNamespaceInputSchema,
      outputSchema: TranslationsRemoveNamespaceOutputSchema,
      annotations: DESTRUCTIVE_TOOL,
    },
    async (input) => {
      try {
        const parsed = TranslationsRemoveNamespaceInputSchema.parse(input);

        return buildStructuredResponse(await service.removeNamespace(parsed));
      } catch (error) {
        return buildErrorResponse(name('translations_remove_namespace'), error);
      }
    },
  );

  server.registerTool(
    name('translations_remove_locale'),
    {
      title: 'Remove a locale',
      description:
        'Delete a locale folder and all its translation files. The base locale cannot be removed.',
      inputSchema: TranslationsRemoveLocaleInputSchema,
      outputSchema: TranslationsRemoveLocaleOutputSchema,
      annotations: DESTRUCTIVE_TOOL,
    },
    async (input) => {
      try {
        const parsed = TranslationsRemoveLocaleInputSchema.parse(input);

        return buildStructuredResponse(await service.removeLocale(parsed));
      } catch (error) {
        return buildErrorResponse(name('translations_remove_locale'), error);
      }
    },
  );
}
