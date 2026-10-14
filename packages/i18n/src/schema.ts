import { z } from 'zod/v3';

const FlatTranslationsSchema = z.record(z.string(), z.string());
const NamespaceTranslationsSchema = z.record(
  z.string(),
  FlatTranslationsSchema,
);

// --- List ---

export const TranslationsListInputSchema = z.object({});

export const TranslationsListOutputSchema = z.object({
  base_locale: z.string(),
  locales: z.array(z.string()),
  namespaces: z.array(z.string()),
  translations: z.record(z.string(), NamespaceTranslationsSchema),
});

export type TranslationsListInput = z.infer<typeof TranslationsListInputSchema>;
export type TranslationsListOutput = z.infer<
  typeof TranslationsListOutputSchema
>;

// --- Update ---

export const TranslationsUpdateInputSchema = z.object({
  locale: z.string().min(1),
  namespace: z.string().min(1),
  key: z.string().min(1),
  value: z.string(),
});

export const TranslationsUpdateOutputSchema = z.object({
  success: z.boolean(),
  file: z.string(),
});

export type TranslationsUpdateInput = z.infer<
  typeof TranslationsUpdateInputSchema
>;
export type TranslationsUpdateOutput = z.infer<
  typeof TranslationsUpdateOutputSchema
>;

// --- Stats ---

export const TranslationsStatsInputSchema = z.object({});

export const TranslationsStatsOutputSchema = z.object({
  base_locale: z.string(),
  locale_count: z.number(),
  namespace_count: z.number(),
  total_keys: z.number(),
  coverage: z.record(
    z.string(),
    z.object({
      total: z.number(),
      translated: z.number(),
      missing: z.number(),
      percentage: z.number(),
    }),
  ),
});

export type TranslationsStatsInput = z.infer<
  typeof TranslationsStatsInputSchema
>;
export type TranslationsStatsOutput = z.infer<
  typeof TranslationsStatsOutputSchema
>;

// --- Add Namespace ---

export const TranslationsAddNamespaceInputSchema = z.object({
  namespace: z.string().min(1),
});

export const TranslationsAddNamespaceOutputSchema = z.object({
  success: z.boolean(),
  namespace: z.string(),
  files_created: z.array(z.string()),
});

export type TranslationsAddNamespaceInput = z.infer<
  typeof TranslationsAddNamespaceInputSchema
>;
export type TranslationsAddNamespaceOutput = z.infer<
  typeof TranslationsAddNamespaceOutputSchema
>;

// --- Add Locale ---

export const TranslationsAddLocaleInputSchema = z.object({
  locale: z.string().min(1),
});

export const TranslationsAddLocaleOutputSchema = z.object({
  success: z.boolean(),
  locale: z.string(),
  files_created: z.array(z.string()),
});

export type TranslationsAddLocaleInput = z.infer<
  typeof TranslationsAddLocaleInputSchema
>;
export type TranslationsAddLocaleOutput = z.infer<
  typeof TranslationsAddLocaleOutputSchema
>;

// --- Remove Namespace ---

export const TranslationsRemoveNamespaceInputSchema = z.object({
  namespace: z.string().min(1),
});

export const TranslationsRemoveNamespaceOutputSchema = z.object({
  success: z.boolean(),
  namespace: z.string(),
  files_removed: z.array(z.string()),
});

export type TranslationsRemoveNamespaceInput = z.infer<
  typeof TranslationsRemoveNamespaceInputSchema
>;
export type TranslationsRemoveNamespaceOutput = z.infer<
  typeof TranslationsRemoveNamespaceOutputSchema
>;

// --- Remove Locale ---

export const TranslationsRemoveLocaleInputSchema = z.object({
  locale: z.string().min(1),
});

export const TranslationsRemoveLocaleOutputSchema = z.object({
  success: z.boolean(),
  locale: z.string(),
  path_removed: z.string(),
});

export type TranslationsRemoveLocaleInput = z.infer<
  typeof TranslationsRemoveLocaleInputSchema
>;
export type TranslationsRemoveLocaleOutput = z.infer<
  typeof TranslationsRemoveLocaleOutputSchema
>;
