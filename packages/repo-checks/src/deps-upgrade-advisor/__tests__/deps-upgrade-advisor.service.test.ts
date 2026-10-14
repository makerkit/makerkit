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
});
