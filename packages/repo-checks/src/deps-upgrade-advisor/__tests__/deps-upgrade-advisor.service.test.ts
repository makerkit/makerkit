import { describe, expect, it } from 'vitest';

import {
  type DepsUpgradeAdvisorDeps,
  createDepsUpgradeAdvisorService,
} from '../deps-upgrade-advisor.service';

function createDeps(
  output: unknown,
  overrides: Partial<DepsUpgradeAdvisorDeps> = {},
): DepsUpgradeAdvisorDeps {
  return {
    async executeCommand() {
      return {
        stdout: JSON.stringify(output),
        stderr: '',
        exitCode: 0,
      };
    },
    nowIso() {
      return '2026-02-09T00:00:00.000Z';
    },
    ...overrides,
  };
}

describe('DepsUpgradeAdvisorService', () => {
  it('flags major updates as potentially breaking', async () => {
    const service = createDepsUpgradeAdvisorService(
      createDeps([
        {
          name: 'zod',
          current: '3.25.0',
          wanted: '3.26.0',
          latest: '4.0.0',
          workspace: 'root',
          dependencyType: 'dependencies',
        },
      ]),
    );

    const result = await service.advise({});
    const zod = result.recommendations.find((item) => item.package === 'zod');

    expect(zod?.update_type).toBe('major');
    expect(zod?.potentially_breaking).toBe(true);
    expect(zod?.risk).toBe('high');
  });

  it('prefers wanted for major updates when includeMajor is false', async () => {
    const service = createDepsUpgradeAdvisorService(
      createDeps([
        {
          name: 'example-lib',
          current: '1.2.0',
          wanted: '1.9.0',
          latest: '2.1.0',
          workspace: 'root',
          dependencyType: 'dependencies',
        },
      ]),
    );

    const result = await service.advise({});
    const item = result.recommendations[0];

    expect(item?.recommended_target).toBe('1.9.0');
  });

  it('filters out dev dependencies when requested', async () => {
    const service = createDepsUpgradeAdvisorService(
      createDeps([
        {
          name: 'vitest',
          current: '2.1.0',
          wanted: '2.1.8',
          latest: '2.1.8',
          workspace: 'root',
          dependencyType: 'devDependencies',
        },
        {
          name: 'zod',
          current: '3.25.0',
          wanted: '3.25.1',
          latest: '3.25.1',
          workspace: 'root',
          dependencyType: 'dependencies',
        },
      ]),
    );

    const result = await service.advise({
      state: { includeDevDependencies: false },
    });

    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]?.package).toBe('zod');
  });

  it('reads the flat object pnpm outdated --recursive --format json prints', async () => {
    const service = createDepsUpgradeAdvisorService(
      createDeps({
        '@types/node': {
          current: '26.6.3',
          latest: '26.6.5',
          wanted: '26.6.3',
          isDeprecated: false,
          dependencyType: 'devDependencies',
          dependentPackages: [
            { name: 'web', location: '/repo/apps/web' },
            { name: '@kit/ui', location: '/repo/packages/ui' },
          ],
        },
        zod: {
          current: '3.25.0',
          latest: '4.0.0',
          wanted: '3.26.0',
          isDeprecated: false,
          dependencyType: 'dependencies',
          dependentPackages: [{ name: 'web', location: '/repo/apps/web' }],
        },
      }),
    );

    const result = await service.advise({});

    expect(result.summary.total_outdated).toBe(2);
    expect(result.summary.major_available).toBe(1);

    const types = result.recommendations.find(
      (item) => item.package === '@types/node',
    );

    expect(types?.workspace).toBe('web, @kit/ui');
    expect(types?.dependency_type).toBe('devDependencies');
    expect(types?.update_type).toBe('patch');
  });

  it('drops the version and (dev) suffix pnpm adds to keys of packages listed twice', async () => {
    const service = createDepsUpgradeAdvisorService(
      createDeps({
        '@tanstack/react-table@8.21.3': {
          current: '8.21.3',
          latest: '8.22.0',
          wanted: '8.21.3',
          dependencyType: 'dependencies',
          dependentPackages: [{ name: 'web', location: '/repo/apps/web' }],
        },
        '@tanstack/react-table@8.21.3 (dev)': {
          current: '8.21.3',
          latest: '8.22.0',
          wanted: '8.21.3',
          dependencyType: 'devDependencies',
          dependentPackages: [
            { name: '@kit/ui', location: '/repo/packages/ui' },
          ],
        },
      }),
    );

    const result = await service.advise({});

    expect(result.summary.total_outdated).toBe(1);
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]).toMatchObject({
      package: '@tanstack/react-table',
      workspace: 'web, @kit/ui',
      dependency_type: 'dependencies',
    });
    expect(result.recommendations[0]?.recommended_command).toBe(
      'pnpm --filter web --filter @kit/ui up @tanstack/react-table@8.22.0',
    );
    expect(result.grouped_commands.safe_batch_command).toBe(
      'pnpm --filter web --filter @kit/ui up @tanstack/react-table@8.22.0',
    );
  });

  it('scopes upgrade commands to the dependent workspaces so others are not downgraded', async () => {
    const service = createDepsUpgradeAdvisorService(
      createDeps({
        semver: {
          current: '6.0.0',
          latest: '7.8.5',
          wanted: '6.3.1',
          dependencyType: 'dependencies',
          dependentPackages: [{ name: 'c', location: '/repo/packages/c' }],
        },
        ms: {
          current: '2.1.1',
          latest: '2.1.3',
          wanted: '2.1.1',
          dependencyType: 'dependencies',
          dependentPackages: [{ name: 'a', location: '/repo/packages/a' }],
        },
        zod: {
          current: '3.25.0',
          latest: '3.25.1',
          wanted: '3.25.1',
          dependencyType: 'dependencies',
          dependentPackages: [{ name: 'a', location: '/repo/packages/a' }],
        },
      }),
    );

    const result = await service.advise({});
    const semver = result.recommendations.find(
      (item) => item.package === 'semver',
    );

    // Workspace d may already use semver 7: an unscoped `pnpm up -r` would
    // rewrite it to ^6.3.1.
    expect(semver?.recommended_command).toBe('pnpm --filter c up semver@6.3.1');
    expect(result.grouped_commands.safe_batch_command).toBe(
      'pnpm --filter a up ms@2.1.3 zod@3.25.1',
    );
  });

  it('keeps the production row of a duplicate when dev dependencies are excluded', async () => {
    const service = createDepsUpgradeAdvisorService(
      createDeps({
        'lucide-react@1.56.0': {
          current: '1.56.0',
          latest: '1.57.0',
          wanted: '1.57.0',
          dependencyType: 'dependencies',
          dependentPackages: [{ name: 'web', location: '/repo/apps/web' }],
        },
        'lucide-react@1.56.0 (dev)': {
          current: '1.56.0',
          latest: '1.57.0',
          wanted: '1.57.0',
          dependencyType: 'devDependencies',
          dependentPackages: [
            { name: '@kit/ui', location: '/repo/packages/ui' },
          ],
        },
      }),
    );

    const result = await service.advise({
      state: { includeDevDependencies: false },
    });

    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]?.workspace).toBe('web');
  });

  it('still reads outdated output grouped by workspace', async () => {
    const service = createDepsUpgradeAdvisorService(
      createDeps({
        web: {
          zod: {
            current: '3.25.0',
            latest: '3.26.0',
            wanted: '3.26.0',
            dependencyType: 'dependencies',
          },
        },
      }),
    );

    const result = await service.advise({});

    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]?.workspace).toBe('web');
  });
});
