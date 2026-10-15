import {
  DEFAULT_APPS,
  DEFAULT_MODE,
  DEFAULT_PUBLIC_PREFIXES,
  DEFAULT_WRITE_TARGETS,
  NEXTJS_ENV_FILES,
  getWriteTarget,
  listEnvFileNames,
} from './env-files';
import { setEnvValue } from './parse';
import {
  REDACTED,
  createSecretMatcher,
  isPlaceholder,
  redactEnvContent,
  restoreRedactedContent,
  scrubValues,
} from './redact';
import { isDependencySatisfied } from './resolve';
import { getEnvState } from './scanner';
import type {
  EnvRawReadOutput,
  EnvRawWriteOutput,
  EnvReadOutput,
  EnvReadVariable,
  EnvSchemaOutput,
  EnvUpdateOutput,
} from './schema';
import type {
  AppEnvState,
  EnvApp,
  EnvFilePrecedence,
  EnvInspectorSettings,
  EnvMode,
  EnvVariableModel,
  EnvVariableModelList,
  EnvVariableState,
  EnvVariableType,
  EnvWriteTargets,
} from './types';

import path from 'node:path';

export interface EnvInspectorDeps {
  /** Absolute project root; app paths are resolved against it. */
  rootPath: string;
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  fileExists(filePath: string): Promise<boolean>;
  settings?: EnvInspectorSettings;
}

export interface EnvUpdateInput {
  key?: string;
  value?: string;
  /** Env file name. Default: chosen from the mode and whether it is secret. */
  file?: string;
  mode?: EnvMode;
  app?: string;
}

type SchemaVariable = EnvSchemaOutput['groups'][number]['variables'][number];

export function createEnvInspectorService(deps: EnvInspectorDeps) {
  return new EnvInspectorService(deps);
}

export class EnvInspectorService {
  readonly model: EnvVariableModelList;
  readonly apps: readonly EnvApp[];
  readonly envFiles: EnvFilePrecedence;
  readonly modes: string[];
  readonly envFileNames: string[];
  readonly defaultMode: EnvMode;
  /** False when secret values are redacted in read and raw-read output. */
  readonly revealValues: boolean;

  private readonly writeTargets: Record<EnvMode, EnvWriteTargets>;
  private readonly models: Map<string, EnvVariableModel>;
  private readonly isSecret: (key: string) => boolean;

  constructor(private readonly deps: EnvInspectorDeps) {
    const settings = deps.settings ?? {};

    this.model = settings.model ?? [];
    this.apps = settings.apps ?? DEFAULT_APPS;
    this.envFiles = settings.envFiles ?? NEXTJS_ENV_FILES;
    this.modes = Object.keys(this.envFiles);
    this.envFileNames = listEnvFileNames(this.envFiles);
    this.writeTargets = settings.writeTargets ?? DEFAULT_WRITE_TARGETS;
    this.revealValues = settings.revealValues ?? false;
    this.models = new Map(this.model.map((item) => [item.name, item]));
    this.isSecret = createSecretMatcher(
      this.model,
      settings.publicPrefixes ?? DEFAULT_PUBLIC_PREFIXES,
    );

    if (this.apps.length === 0) {
      throw new Error('At least one app must be configured');
    }

    if (this.modes.length === 0) {
      throw new Error('At least one mode must be configured in envFiles');
    }

    this.defaultMode =
      settings.defaultMode ??
      (this.modes.includes(DEFAULT_MODE) ? DEFAULT_MODE : this.modes[0]!);
  }

  /** The variable model grouped by category. Contains no values. */
  async getSchema(): Promise<EnvSchemaOutput> {
    const groups = new Map<string, SchemaVariable[]>();

    for (const variable of this.model) {
      const category = variable.category ?? 'General';
      const variables = groups.get(category) ?? [];

      variables.push({
        key: variable.name,
        label: variable.displayName ?? variable.name,
        description: variable.description ?? '',
        required: variable.required ?? false,
        type: mapType(variable.type),
        sensitive: this.isSecret(variable.name),
        values: variable.values?.filter(
          (value): value is string => typeof value === 'string',
        ),
        hint: variable.hint,
        dependencies: variable.contextualValidation?.dependencies?.map(
          (dep) => ({
            variable: dep.variable,
            condition: dep.message,
          }),
        ),
      });

      groups.set(category, variables);
    }

    return {
      groups: Array.from(groups.entries()).map(([name, variables]) => ({
        name,
        description: `${name} configuration`,
        variables,
      })),
    };
  }

  /**
   * Every variable of one app for `mode`: effective value, source file,
   * override chain and validation. Secret values are redacted unless
   * `revealValues` is set.
   */
  async read(mode: EnvMode = this.defaultMode, app?: string) {
    const target = this.resolveApp(app);
    const [state] = await this.loadStates(mode, [target]);
    const variables = state?.variables ?? {};

    const allVariables = Object.fromEntries(
      Object.values(variables).map((variable) => [
        variable.key,
        variable.effectiveValue,
      ]),
    );

    const output: EnvReadOutput = {
      mode,
      app: target.name,
      variables: Object.fromEntries(
        Object.entries(variables).map(([key, variable]) => [
          key,
          this.toReadVariable(variable, allVariables),
        ]),
      ),
    };

    return output;
  }

  /**
   * Sets one variable. Without `file`, writes to the mode's secret file
   * (e.g. .env.local) when the model marks the variable secret or does not
   * know it, and to the mode's committed file otherwise.
   */
  async update(input: EnvUpdateInput): Promise<EnvUpdateOutput> {
    if (!input.key || typeof input.value !== 'string') {
      throw new Error('Both key and value are required for env_update');
    }

    // A value copied from a redacted read would replace the real secret.
    if (!this.revealValues && isPlaceholder(input.value)) {
      throw new Error(
        `${REDACTED} is not a value. Pass the real value of ${input.key}, or use env_raw_write, which keeps the current value of lines set to ${REDACTED}.`,
      );
    }

    const mode = input.mode ?? this.defaultMode;
    this.assertMode(mode);

    const fileName = input.file ?? this.resolveDefaultFile(input.key, mode);
    const targetPath = this.resolveAppFile(fileName, input.app);

    const content = (await this.deps.fileExists(targetPath))
      ? await this.deps.readFile(targetPath)
      : '';

    await this.deps.writeFile(
      targetPath,
      setEnvValue(content, input.key, input.value),
    );

    return {
      success: true,
      message: `Updated ${input.key} in ${fileName}`,
    };
  }

  /** The content of one env file, with secret values redacted by default. */
  async rawRead(file: string, app?: string): Promise<EnvRawReadOutput> {
    const targetPath = this.resolveAppFile(file, app);

    if (!(await this.deps.fileExists(targetPath))) {
      return {
        content: '',
        exists: false,
      };
    }

    const content = await this.deps.readFile(targetPath);

    if (this.revealValues) {
      return { content, exists: true };
    }

    return { ...redactEnvContent(content, this.isSecret), exists: true };
  }

  /**
   * Replaces the content of one env file. When values are redacted, lines
   * whose value is "[REDACTED]" keep the value the file has now, so content
   * from a redacted rawRead can be written back without losing secrets.
   */
  async rawWrite(
    file: string,
    content: string,
    app?: string,
  ): Promise<EnvRawWriteOutput> {
    const targetPath = this.resolveAppFile(file, app);
    let output = content;

    if (!this.revealValues) {
      const current = (await this.deps.fileExists(targetPath))
        ? await this.deps.readFile(targetPath)
        : '';

      output = restoreRedactedContent(content, current);
    }

    await this.deps.writeFile(targetPath, output);

    return {
      success: true,
      message: `Saved ${file}`,
    };
  }

  /** The effective value of one variable. Never redacted (code use only). */
  async getVariable(
    key: string,
    mode: EnvMode = this.defaultMode,
    app?: string,
  ) {
    const [state] = await this.loadStates(mode, [this.resolveApp(app)]);

    return state?.variables[key]?.effectiveValue ?? '';
  }

  /** Full state of every app for `mode`. Never redacted (code use only). */
  async getAppState(mode: EnvMode = this.defaultMode): Promise<AppEnvState[]> {
    return this.loadStates(mode, this.apps);
  }

  private loadStates(mode: EnvMode, apps: readonly EnvApp[]) {
    this.assertMode(mode);

    return getEnvState({
      rootPath: this.deps.rootPath,
      mode,
      apps,
      envFiles: this.envFiles,
      model: this.model,
      fs: {
        readFile: (filePath) => this.deps.readFile(filePath),
        fileExists: (filePath) => this.deps.fileExists(filePath),
      },
    });
  }

  private toReadVariable(
    variable: EnvVariableState,
    allVariables: Record<string, string>,
  ): EnvReadVariable {
    const model = this.models.get(variable.key);
    const redact =
      !this.revealValues &&
      this.isSecret(variable.key) &&
      variable.definitions.some((def) => def.value !== '');

    const secretValues = redact
      ? variable.definitions.map((def) => def.value)
      : [];
    const show = (value: string) => (redact && value ? REDACTED : value);

    return {
      key: variable.key,
      value: show(variable.effectiveValue),
      source: variable.effectiveSource,
      isOverridden: variable.isOverridden,
      overrideChain:
        variable.definitions.length > 1
          ? variable.definitions.map((definition) => ({
              source: definition.source,
              value: show(definition.value),
            }))
          : undefined,
      validation: {
        valid: variable.validation.success,
        errors: variable.validation.error.issues.map((issue) =>
          scrubValues(issue, secretValues),
        ),
      },
      dependencies: model?.contextualValidation?.dependencies?.map((dep) => ({
        variable: dep.variable,
        condition: dep.message,
        satisfied: isDependencySatisfied(dep, allVariables),
      })),
      ...(redact ? { redacted: true } : {}),
    };
  }

  private resolveDefaultFile(key: string, mode: EnvMode) {
    // Unknown variables go to the secret (gitignored) file to be safe.
    const secret = this.models.get(key)?.secret ?? true;

    return getWriteTarget(this.writeTargets, mode, secret);
  }

  private resolveApp(name?: string) {
    if (name === undefined) {
      return this.apps[0]!;
    }

    const app = this.apps.find((item) => item.name === name);

    if (!app) {
      throw new Error(
        `Unknown app "${name}". Configured apps: ${this.apps.map((item) => item.name).join(', ')}`,
      );
    }

    return app;
  }

  private resolveAppFile(fileName: string, appName?: string) {
    if (!this.envFileNames.includes(fileName)) {
      throw new Error(
        `Invalid env file "${fileName}". Expected one of: ${this.envFileNames.join(', ')}`,
      );
    }

    const appDir = path.resolve(
      this.deps.rootPath,
      this.resolveApp(appName).path,
    );
    const resolved = path.resolve(appDir, fileName);

    // Guards against env file names in settings that contain a path.
    if (!resolved.startsWith(appDir + path.sep)) {
      throw new Error(
        `Invalid file path: "${fileName}" resolves outside the app directory`,
      );
    }

    return resolved;
  }

  private assertMode(mode: EnvMode) {
    if (!this.modes.includes(mode)) {
      throw new Error(
        `Unknown mode "${mode}". Configured modes: ${this.modes.join(', ')}`,
      );
    }
  }
}

function mapType(type?: EnvVariableType): SchemaVariable['type'] {
  if (
    type === 'url' ||
    type === 'email' ||
    type === 'number' ||
    type === 'boolean' ||
    type === 'enum'
  ) {
    return type;
  }

  return 'string';
}
