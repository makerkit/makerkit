import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { DepsUpgradeAdvisorService } from './deps-upgrade-advisor/deps-upgrade-advisor.service';
import {
  DepsUpgradeAdvisorInputSchema,
  DepsUpgradeAdvisorOutputSchema,
} from './deps-upgrade-advisor/schema';
import type { RunChecksService } from './run-checks/run-checks.service';
import {
  RunChecksInputSchema,
  RunChecksOutputSchema,
} from './run-checks/schema';
import {
  GetHealthcheckScriptsInputSchema,
  GetHealthcheckScriptsOutputSchema,
  GetScriptDetailsInputSchema,
  GetScriptDetailsOutputSchema,
  GetScriptsInputSchema,
  GetScriptsOutputSchema,
} from './scripts/schema';
import type { ScriptsService } from './scripts/scripts.service';
import {
  MUTATING_TOOL,
  READ_ONLY_OPEN_WORLD_TOOL,
  READ_ONLY_TOOL,
  buildErrorResponse,
  buildStructuredResponse,
} from './tool-response';

export interface RepoChecksServices {
  runChecks: RunChecksService;
  scripts: ScriptsService;
  depsUpgradeAdvisor: DepsUpgradeAdvisorService;
}

export interface RegisterRepoChecksOptions {
  /** Prepended to every tool name, e.g. "kit_" keeps a kit's existing names. */
  prefix?: string;
}

/** Registers run_checks, the script tools and deps_upgrade_advisor. */
export function registerRepoChecksTools(
  server: McpServer,
  services: RepoChecksServices,
  options: RegisterRepoChecksOptions = {},
) {
  const name = (tool: string) => `${options.prefix ?? ''}${tool}`;

  server.registerTool(
    name('run_checks'),
    {
      title: 'Run code quality checks',
      description:
        'Run typecheck, lint and format checks (check-only by default) and return parsed diagnostics with file, line, rule and message. ' +
        'Pass fix: true to run the auto-fix scripts instead, or includeTests: true to also run the test suite.',
      inputSchema: RunChecksInputSchema,
      outputSchema: RunChecksOutputSchema,
      // Read-only unless `fix: true`; declare the broader capability so
      // clients never auto-approve a call that could rewrite files.
      annotations: MUTATING_TOOL,
    },
    async (input) => {
      try {
        return buildStructuredResponse(
          await services.runChecks.run(RunChecksInputSchema.parse(input)),
        );
      } catch (error) {
        return buildErrorResponse(name('run_checks'), error);
      }
    },
  );

  server.registerTool(
    name('get_scripts'),
    {
      title: 'List root scripts',
      description:
        'List every root package.json script with category, importance, usage guidance and whether it changes files.',
      inputSchema: GetScriptsInputSchema,
      outputSchema: GetScriptsOutputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async () => {
      try {
        return buildStructuredResponse(await services.scripts.list());
      } catch (error) {
        return buildErrorResponse(name('get_scripts'), error);
      }
    },
  );

  server.registerTool(
    name('get_script_details'),
    {
      title: 'Describe a script',
      description:
        'Get detailed information about one root package.json script.',
      inputSchema: GetScriptDetailsInputSchema,
      outputSchema: GetScriptDetailsOutputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async (input) => {
      try {
        return buildStructuredResponse(
          await services.scripts.getDetails(
            GetScriptDetailsInputSchema.parse(input),
          ),
        );
      } catch (error) {
        return buildErrorResponse(name('get_script_details'), error);
      }
    },
  );

  server.registerTool(
    name('get_healthcheck_scripts'),
    {
      title: 'List verification scripts',
      description:
        'List the scripts that must pass after writing code (typecheck, lint, format, test) in the recommended order.',
      inputSchema: GetHealthcheckScriptsInputSchema,
      outputSchema: GetHealthcheckScriptsOutputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async () => {
      try {
        return buildStructuredResponse(
          await services.scripts.getHealthcheckScripts(),
        );
      } catch (error) {
        return buildErrorResponse(name('get_healthcheck_scripts'), error);
      }
    },
  );

  server.registerTool(
    name('deps_upgrade_advisor'),
    {
      title: 'Advise on dependency upgrades',
      description:
        'Analyze outdated dependencies and return risk-bucketed upgrade recommendations (pnpm projects).',
      inputSchema: DepsUpgradeAdvisorInputSchema,
      outputSchema: DepsUpgradeAdvisorOutputSchema,
      annotations: READ_ONLY_OPEN_WORLD_TOOL,
    },
    async (input) => {
      try {
        return buildStructuredResponse(
          await services.depsUpgradeAdvisor.advise(
            DepsUpgradeAdvisorInputSchema.parse(input),
          ),
        );
      } catch (error) {
        return buildErrorResponse(name('deps_upgrade_advisor'), error);
      }
    },
  );
}
