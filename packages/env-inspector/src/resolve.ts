import { NEXTJS_ENV_FILES, getSourcePrecedence } from './env-files';
import type {
  AppEnvState,
  EnvFileInfo,
  EnvFilePrecedence,
  EnvMode,
  EnvValidationResult,
  EnvVariableDependency,
  EnvVariableModel,
  EnvVariableModelList,
  EnvVariableState,
} from './types';

export const MISSING_SOURCE = 'MISSING';

export const REQUIRED_MISSING_MESSAGE =
  'This variable is required but missing from your environment files';

/** Category of variables that are not in the model. */
export const CUSTOM_CATEGORY = 'Custom';

export const DEFAULT_CATEGORY = 'General';

export interface ProcessEnvOptions {
  /** Default: no model, so variables are listed but not validated. */
  model?: EnvVariableModelList;
  /** Default: NEXTJS_ENV_FILES. */
  envFiles?: EnvFilePrecedence;
}

type Validation = EnvVariableState['validation'];

const VALID: Validation = { success: true, error: { issues: [] } };

/**
 * Resolves the effective value of every variable of one app for `mode`, and
 * validates it against the model. Variables the model marks as required (or
 * whose contextual validation applies) are added with source "MISSING" when
 * no file sets them.
 */
export function processEnvDefinitions(
  envInfo: EnvFileInfo,
  mode: EnvMode,
  options: ProcessEnvOptions = {},
): AppEnvState {
  const model = options.model ?? [];
  const envFiles = options.envFiles ?? NEXTJS_ENV_FILES;
  const models = new Map(model.map((item) => [item.name, item]));
  const precedence = (source: string) =>
    getSourcePrecedence(envFiles, source, mode);

  const variableMap: Record<string, EnvVariableState> = {};

  // First pass: collect all definitions.
  for (const variable of envInfo.variables) {
    const varState = (variableMap[variable.key] ??= {
      key: variable.key,
      isVisible: true,
      definitions: [],
      effectiveValue: variable.value,
      effectiveSource: variable.source,
      isOverridden: false,
      category: categoryOf(models.get(variable.key)),
      validation: VALID,
    });

    varState.definitions.push({
      key: variable.key,
      value: variable.value,
      source: variable.source,
      ...(variable.line !== undefined ? { line: variable.line } : {}),
    });
  }

  // Same key defined more than once in one file: the last definition wins
  // (matching dotenv parsing), and the earlier ones are almost always a
  // mistake, so they are reported as a validation issue below.
  const duplicateIssues: Record<string, string> = {};

  // Second pass: effective values and override status.
  for (const varState of Object.values(variableMap)) {
    // Stable sort: definitions in one file keep their line order.
    varState.definitions.sort(
      (a, b) => precedence(a.source) - precedence(b.source),
    );

    const lastDef = varState.definitions[varState.definitions.length - 1];

    if (varState.definitions.length > 1 && lastDef) {
      const highestPrecedence = precedence(lastDef.source);

      varState.isOverridden = true;
      varState.effectiveValue = lastDef.value;
      varState.effectiveSource = lastDef.source;

      const conflictingDefs = varState.definitions.filter(
        (def) => precedence(def.source) === highestPrecedence,
      );

      if (conflictingDefs.length > 1) {
        varState.effectiveSource = `${varState.effectiveSource} (conflict)`;
      }
    }

    const duplicateIssue = describeDuplicates(varState);

    if (duplicateIssue) {
      duplicateIssues[varState.key] = duplicateIssue;
    }
  }

  const allVariables: Record<string, string> = {};

  for (const varState of Object.values(variableMap)) {
    allVariables[varState.key] = varState.effectiveValue;
  }

  // Third pass: validate the variables that are set.
  for (const varState of Object.values(variableMap)) {
    const item = models.get(varState.key);
    let validation = item
      ? validateDefined(item, varState.effectiveValue, allVariables, mode)
      : VALID;

    const duplicateIssue = duplicateIssues[varState.key];

    if (duplicateIssue) {
      validation = {
        success: false,
        error: { issues: [...validation.error.issues, duplicateIssue] },
      };
    }

    varState.validation = validation;
  }

  // Final pass: model variables that no file sets.
  for (const item of model) {
    if (variableMap[item.name]) {
      continue;
    }

    const validation = validateMissing(item, allVariables, mode);

    if (!validation) {
      continue;
    }

    variableMap[item.name] = {
      key: item.name,
      effectiveValue: '',
      effectiveSource: MISSING_SOURCE,
      isVisible: true,
      category: categoryOf(item),
      isOverridden: false,
      definitions: [],
      validation,
    };
  }

  return {
    appName: envInfo.appName,
    filePath: envInfo.filePath,
    mode,
    variables: variableMap,
  };
}

/** Whether a dependency's condition holds for the current values. */
export function isDependencySatisfied(
  dependency: EnvVariableDependency,
  variables: Record<string, string>,
) {
  return dependency.condition(variables[dependency.variable] ?? '', variables);
}

function validateDefined(
  item: EnvVariableModel,
  value: string,
  variables: Record<string, string>,
  mode: EnvMode,
): Validation {
  const context = { value, variables, mode };

  if (item.required && !value) {
    return invalid([REQUIRED_MISSING_MESSAGE]);
  }

  const contextual = item.contextualValidation;

  if (contextual) {
    // With no dependencies, the contextual validation always applies.
    const dependenciesMet =
      contextual.dependencies.length === 0 ||
      contextual.dependencies.some((dep) =>
        isDependencySatisfied(dep, variables),
      );

    if (dependenciesMet) {
      if (!value) {
        // Report the message of each dependency that applies.
        const messages = contextual.dependencies
          .filter((dep) => isDependencySatisfied(dep, variables))
          .filter(() => !contextual.validate(context).success)
          .map((dep) => dep.message)
          .filter(Boolean);

        return messages.length > 0 ? invalid(messages) : VALID;
      }

      return toValidation(contextual.validate(context));
    }

    // Dependencies not met: fall back to the plain validator.
    if (item.validate && value) {
      return toValidation(item.validate(context));
    }

    return VALID;
  }

  if (item.validate && value) {
    return toValidation(item.validate(context));
  }

  return VALID;
}

/** Validation for a model variable no file sets, or null to leave it out. */
function validateMissing(
  item: EnvVariableModel,
  variables: Record<string, string>,
  mode: EnvMode,
): Validation | null {
  const contextual = item.contextualValidation;
  const context = { value: '', variables, mode };

  if (contextual) {
    // With no dependencies, always list the variable, validated as empty.
    if (contextual.dependencies.length === 0) {
      return toValidation(contextual.validate(context));
    }

    const errors = contextual.dependencies.flatMap((dep) => {
      if (!isDependencySatisfied(dep, variables)) {
        return [];
      }

      return contextual.validate(context).success ? [] : [dep.message];
    });

    return errors.length > 0 ? invalid(errors) : null;
  }

  if (item.required) {
    return invalid([REQUIRED_MISSING_MESSAGE]);
  }

  return null;
}

function describeDuplicates(varState: EnvVariableState) {
  const bySource = new Map<string, number[]>();

  for (const def of varState.definitions) {
    const lines = bySource.get(def.source) ?? [];
    lines.push(def.line ?? 0);
    bySource.set(def.source, lines);
  }

  const duplicates = [...bySource.entries()].filter(
    ([, lines]) => lines.length > 1,
  );

  if (duplicates.length === 0) {
    return null;
  }

  return duplicates
    .map(([source, lines]) => {
      const where = lines.some((line) => line > 0)
        ? ` (lines ${lines.filter(Boolean).join(', ')})`
        : '';

      return `Defined ${lines.length} times in ${source}${where}; the last definition wins. Remove the earlier ones.`;
    })
    .join(' ');
}

function toValidation(result: EnvValidationResult): Validation {
  if (result.success) {
    return VALID;
  }

  return invalid(
    result.error.issues.map((issue) => issue.message).filter(Boolean),
  );
}

function invalid(issues: string[]): Validation {
  return { success: false, error: { issues } };
}

function categoryOf(item: EnvVariableModel | undefined) {
  if (!item) {
    return CUSTOM_CATEGORY;
  }

  return item.category ?? DEFAULT_CATEGORY;
}
