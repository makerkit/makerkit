import { DEFAULT_APPS, NEXTJS_ENV_FILES } from './env-files';
import { parseEnvFile } from './parse';
import { processEnvDefinitions } from './resolve';
import type {
  AppEnvState,
  EnvApp,
  EnvFileInfo,
  EnvFilePrecedence,
  EnvMode,
  EnvReadFs,
  EnvVariableModelList,
} from './types';

import path from 'node:path';

export interface ScanOptions {
  /** Absolute project root. */
  rootPath: string;
  mode: EnvMode;
  fs: EnvReadFs;
  /** Default: one app at the root. */
  apps?: readonly EnvApp[];
  /** Default: NEXTJS_ENV_FILES. */
  envFiles?: EnvFilePrecedence;
}

export interface EnvStateOptions extends ScanOptions {
  model?: EnvVariableModelList;
}

/**
 * Reads the env files of `mode` for every app, in precedence order. Files
 * that do not exist are skipped.
 */
export async function scanEnvFiles(
  options: ScanOptions,
): Promise<EnvFileInfo[]> {
  const envFiles = options.envFiles ?? NEXTJS_ENV_FILES;
  const files = envFiles[options.mode];

  if (!files) {
    throw new Error(
      `Unknown mode "${options.mode}". Configured modes: ${Object.keys(envFiles).join(', ')}`,
    );
  }

  const results: EnvFileInfo[] = [];

  for (const app of options.apps ?? DEFAULT_APPS) {
    const appDir = path.resolve(options.rootPath, app.path);
    const appInfo: EnvFileInfo = {
      appName: app.name,
      filePath: appDir,
      variables: [],
    };

    for (const fileName of files) {
      const envPath = path.join(appDir, fileName);

      if (!(await options.fs.fileExists(envPath))) {
        continue;
      }

      const content = await options.fs.readFile(envPath);
      appInfo.variables.push(...parseEnvFile(content, fileName));
    }

    results.push(appInfo);
  }

  return results;
}

/** The resolved and validated variables of every app for `mode`. */
export async function getEnvState(
  options: EnvStateOptions,
): Promise<AppEnvState[]> {
  const envInfos = await scanEnvFiles(options);

  return envInfos.map((info) =>
    processEnvDefinitions(info, options.mode, {
      model: options.model,
      envFiles: options.envFiles,
    }),
  );
}
