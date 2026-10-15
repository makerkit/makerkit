import { describe, expect, it } from 'vitest';

import { createDepsUpgradeAdvisorService } from '../deps-upgrade-advisor/deps-upgrade-advisor.service';
import { DepsUpgradeAdvisorOutputSchema } from '../deps-upgrade-advisor/schema';
import { type RepoChecksServices, registerRepoChecksTools } from '../mcp';
import { createRunChecksService } from '../run-checks/run-checks.service';
import { RunChecksOutputSchema } from '../run-checks/schema';
import { createScriptsService } from '../scripts/scripts.service';
import { createFakeMcpServer } from '../testing/fake-mcp-server';

const ROOT_SCRIPTS = {
  typecheck: 'tsc',
  lint: 'oxlint',
  format: 'oxfmt --check',
  test: 'vitest',
};

function createServices(packageManager = 'pnpm'): RepoChecksServices {
  const readRootPackageJson = async () => ({ scripts: ROOT_SCRIPTS });

  return {
    runChecks: createRunChecksService({
      rootPath: '/repo',
      packageManager,
      readRootPackageJson,
      executeCommand: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      now: () => 0,
    }),
    scripts: createScriptsService({ rootPath: '/repo', readRootPackageJson }),
    depsUpgradeAdvisor: createDepsUpgradeAdvisorService({
      packageManager,
      executeCommand: async () => ({ stdout: '[]', stderr: '', exitCode: 0 }),
      nowIso: () => '2026-10-14T00:00:00.000Z',
    }),
  };
}

describe('registerRepoChecksTools', () => {
  it('registers the five tools with annotations', () => {
    const fake = createFakeMcpServer();

    registerRepoChecksTools(fake.server, createServices());

    expect(fake.tools.map((tool) => tool.name).sort()).toEqual([
      'deps_upgrade_advisor',
      'get_healthcheck_scripts',
      'get_script_details',
      'get_scripts',
      'run_checks',
    ]);

    // run_checks can rewrite files with fix: true, so it is never read-only.
    expect(fake.tool('run_checks').config.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    expect(fake.tool('get_scripts').config.annotations).toMatchObject({
      readOnlyHint: true,
    });
  });

  it('prefixes tool names so kits keep their existing names', () => {
    const fake = createFakeMcpServer();

    registerRepoChecksTools(fake.server, createServices(), { prefix: 'kit_' });

    expect(fake.tools.map((tool) => tool.name)).toContain('kit_run_checks');
    expect(fake.tools.every((tool) => tool.name.startsWith('kit_'))).toBe(true);
  });

  it('returns typed output from run_checks and errors for invalid input', async () => {
    const fake = createFakeMcpServer();
    registerRepoChecksTools(fake.server, createServices());

    const result = await fake.call('run_checks', {});
    const parsed = RunChecksOutputSchema.parse(result.structuredContent);

    expect(parsed.overall).toBe('pass');
    expect(parsed.summary.total).toBe(3);

    const invalid = await fake.call('run_checks', { maxOutputChars: 1 });
    expect(invalid.isError).toBe(true);
  });

  it('lists scripts and the verification order', async () => {
    const fake = createFakeMcpServer();
    registerRepoChecksTools(fake.server, createServices());

    const scripts = await fake.call('get_scripts');
    expect((scripts.structuredContent as { total: number }).total).toBe(4);

    const healthcheck = await fake.call('get_healthcheck_scripts');
    expect(
      (healthcheck.structuredContent as { recommended_order: string[] })
        .recommended_order,
    ).toEqual(['typecheck', 'lint', 'format', 'test']);
  });

  it('advises on upgrades in pnpm projects and refuses others clearly', async () => {
    const pnpm = createFakeMcpServer();
    registerRepoChecksTools(pnpm.server, createServices('pnpm'));

    const result = await pnpm.call('deps_upgrade_advisor', {});
    const parsed = DepsUpgradeAdvisorOutputSchema.parse(
      result.structuredContent,
    );
    expect(Array.isArray(parsed.recommendations)).toBe(true);

    const npm = createFakeMcpServer();
    registerRepoChecksTools(npm.server, createServices('npm'));

    const refused = await npm.call('deps_upgrade_advisor', {});
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toContain('pnpm projects only');
  });
});
