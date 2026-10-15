import { describe, expect, it } from 'vitest';

import { checkPlan } from '../plan-check';
import { normalizePrd } from '../prd.service';
import type { StructuredPRD, UserStory } from '../types';

function story(id: string, overrides: Partial<UserStory> = {}): UserStory {
  return {
    id,
    title: id,
    userStory: 'As a founder, I want to do it so that it helps',
    businessValue: 'it helps',
    acceptanceCriteria: ['First', 'Second'],
    status: 'not_started',
    priority: 'P2',
    estimatedComplexity: 'S',
    dependencies: [],
    testSeams: ['someAction'],
    ...overrides,
  };
}

function prd(overrides: Partial<StructuredPRD> = {}): StructuredPRD {
  return { ...normalizePrd({}, '2026-10-14'), ...overrides };
}

const ids = (result: ReturnType<typeof checkPlan>) =>
  result.items.map((item) => `${item.severity}:${item.id}`);

describe('checkPlan', () => {
  it('blocks an empty plan', () => {
    const result = checkPlan(prd());

    expect(result.ready_to_build).toBe(false);
    expect(ids(result)).toEqual(
      expect.arrayContaining(['required:stories', 'required:scope']),
    );
  });

  it('is ready once the required items are covered, leaving recommendations', () => {
    const result = checkPlan(
      prd({ userStories: [story('US001')], nonGoals: ['Email sync'] }),
    );

    expect(result.ready_to_build).toBe(true);
    expect(ids(result)).toEqual([
      'recommended:scope',
      'recommended:success-metrics',
      'recommended:global-acceptance-criteria',
      'recommended:target-metrics',
      'recommended:rollout',
      'recommended:data-models',
    ]);
  });

  it('names the stories an item is about', () => {
    const result = checkPlan(
      prd({
        nonGoals: ['x'],
        outOfScope: ['y'],
        userStories: [
          story('US001', { acceptanceCriteria: [] }),
          story('US002', { acceptanceCriteria: ['Only one'] }),
          story('US003', { testSeams: undefined }),
          story('US004', { status: 'blocked' }),
        ],
      }),
    );

    const byId = Object.fromEntries(
      result.items.map((item) => [item.id, item]),
    );

    expect(result.ready_to_build).toBe(false);
    expect(byId['stories-without-criteria']?.storyIds).toEqual(['US001']);
    expect(byId['vague-stories']?.storyIds).toEqual(['US002']);
    expect(byId['test-seams']?.storyIds).toEqual(['US003']);
    expect(byId['blocked-stories']?.storyIds).toEqual(['US004']);
  });

  it('recommends phases only once there are more than five stories', () => {
    const five = ['1', '2', '3', '4', '5'].map((n) => story(`US00${n}`));

    expect(ids(checkPlan(prd({ userStories: five })))).not.toContain(
      'recommended:phases',
    );
    expect(
      ids(checkPlan(prd({ userStories: [...five, story('US006')] }))),
    ).toContain('recommended:phases');
  });

  it('asks for data models once there are stories', () => {
    const base = prd();

    expect(ids(checkPlan(base))).not.toContain('recommended:data-models');
    expect(ids(checkPlan(prd({ userStories: [story('US001')] })))).toContain(
      'recommended:data-models',
    );
    expect(
      ids(
        checkPlan(
          prd({
            userStories: [story('US001')],
            technicalContracts: {
              ...base.technicalContracts,
              dataModels: ['Bookmark: a saved link. Belongs to one account.'],
            },
          }),
        ),
      ),
    ).not.toContain('recommended:data-models');
  });

  it('does not ask completed stories for test seams', () => {
    const result = checkPlan(
      prd({
        userStories: [story('US001', { status: 'completed', testSeams: [] })],
      }),
    );

    expect(ids(result)).not.toContain('recommended:test-seams');
  });
});
