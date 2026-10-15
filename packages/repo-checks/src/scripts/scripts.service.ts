import type {
  GetHealthcheckScriptsOutput,
  GetScriptDetailsInput,
  GetScriptsOutput,
  ScriptInfo,
} from './schema';

export interface ScriptsDeps {
  rootPath: string;
  readRootPackageJson(): Promise<{ scripts?: Record<string, unknown> }>;
  /** Extra or overriding script guidance, merged over the default catalog. */
  catalog?: ScriptCatalog;
}

type ScriptMetadata = Omit<ScriptInfo, 'name' | 'command'>;

export type ScriptCatalog = Record<string, Partial<ScriptMetadata>>;

/**
 * Guidance for common root scripts. Scripts not listed here are still
 * returned, with metadata inferred from their name. Projects add or override
 * entries through `ScriptsDeps.catalog`.
 */
export const DEFAULT_SCRIPT_CATALOG: ScriptCatalog = {
  dev: {
    category: 'development',
    description: 'Start the development server(s) with hot reloading',
    usage: 'Run this to start developing.',
    importance: 'medium',
  },
  build: {
    category: 'build',
    description: 'Build the project for production',
    usage: 'Run before deploying to make sure everything compiles.',
    importance: 'medium',
  },
  typecheck: {
    category: 'linting',
    description: 'Check the code for type errors',
    usage: 'Run after changing code. Must pass before committing.',
    importance: 'critical',
    healthcheck: true,
  },
  lint: {
    category: 'linting',
    description: 'Check code quality with the project linter',
    usage: 'Run after changing code. Must pass before committing.',
    importance: 'critical',
    healthcheck: true,
  },
  'lint:fix': {
    category: 'linting',
    description: 'Run the linter and apply automatic fixes',
    usage: 'Use to fix lint issues that can be fixed automatically.',
    importance: 'high',
    healthcheck: true,
    mutates_files: true,
  },
  format: {
    category: 'linting',
    description: 'Check that the code is formatted',
    usage: 'Verify formatting without changing files.',
    importance: 'high',
    healthcheck: true,
  },
  'format:fix': {
    category: 'linting',
    description: 'Format the code in place',
    usage: 'Use to format code before committing.',
    importance: 'high',
    healthcheck: true,
    mutates_files: true,
  },
  test: {
    category: 'testing',
    description: 'Run the test suites',
    usage: 'Run to verify behaviour. Should pass before committing.',
    importance: 'high',
    healthcheck: true,
  },
  'test:unit': {
    category: 'testing',
    description: 'Run the unit tests only',
    usage: 'Faster than the full test script; use during development.',
    importance: 'medium',
  },
  clean: {
    category: 'maintenance',
    description: 'Remove generated files and dependencies',
    usage: 'Use when build output is corrupted. Reinstall afterwards.',
    importance: 'medium',
  },
};

const IMPORTANCE_ORDER = { critical: 0, high: 1, medium: 2, low: 3 } as const;

/** Check-only first, so a failing run never leaves the tree half-rewritten. */
const HEALTHCHECK_ORDER = ['typecheck', 'lint', 'format', 'test'];

export function createScriptsService(deps: ScriptsDeps) {
  return new ScriptsService(deps);
}

export class ScriptsService {
  private readonly catalog: ScriptCatalog;

  constructor(private readonly deps: ScriptsDeps) {
    this.catalog = { ...DEFAULT_SCRIPT_CATALOG, ...deps.catalog };
  }

  async list(): Promise<GetScriptsOutput> {
    const scripts = await this.readScripts();

    return {
      scripts,
      total: scripts.length,
    };
  }

  async getDetails(input: GetScriptDetailsInput): Promise<ScriptInfo> {
    const scripts = await this.readScripts();
    const script = scripts.find((item) => item.name === input.scriptName);

    if (!script) {
      throw new Error(`Script "${input.scriptName}" not found`);
    }

    return script;
  }

  async getHealthcheckScripts(): Promise<GetHealthcheckScriptsOutput> {
    const scripts = (await this.readScripts()).filter(
      (script) => script.healthcheck,
    );

    const names = new Set(scripts.map((script) => script.name));

    return {
      scripts,
      recommended_order: HEALTHCHECK_ORDER.filter((name) => names.has(name)),
      note: 'Run these after every change. Prefer the run_checks tool, which parses their output into diagnostics.',
    };
  }

  private async readScripts(): Promise<ScriptInfo[]> {
    const packageJson = await this.deps.readRootPackageJson();
    const entries = Object.entries(packageJson.scripts ?? {});

    const scripts = entries.flatMap(([name, command]) =>
      typeof command === 'string'
        ? [describeScript(name, command, this.catalog)]
        : [],
    );

    return scripts.sort(
      (a, b) =>
        IMPORTANCE_ORDER[a.importance] - IMPORTANCE_ORDER[b.importance] ||
        a.name.localeCompare(b.name),
    );
  }
}

export function describeScript(
  name: string,
  command: string,
  catalog: ScriptCatalog = DEFAULT_SCRIPT_CATALOG,
): ScriptInfo {
  const metadata = catalog[name] ?? {};

  return {
    name,
    command,
    category: metadata.category ?? inferCategory(name),
    description: metadata.description ?? `Custom script: ${name}`,
    usage: metadata.usage ?? 'See package.json for command details.',
    importance: metadata.importance ?? 'low',
    healthcheck: metadata.healthcheck ?? false,
    mutates_files: metadata.mutates_files ?? false,
  };
}

function inferCategory(name: string): ScriptInfo['category'] {
  if (name.startsWith('supabase') || name.includes('db')) return 'database';
  if (name.startsWith('test')) return 'testing';
  if (name.startsWith('lint') || name.startsWith('format')) return 'linting';
  if (name.startsWith('build')) return 'build';
  if (name.startsWith('dev') || name.startsWith('stripe')) return 'development';
  if (name.startsWith('env')) return 'environment';

  return 'maintenance';
}
