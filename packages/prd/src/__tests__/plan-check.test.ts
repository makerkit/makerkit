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
      prd({
        userStories: [story('US001')],
        nonGoals: ['Email sync'],
        edgeCases: [
          {
            id: 'EC001',
            case: 'Email already invited',
            expectedBehavior: 'Resend the invite',
            status: 'decided',
          },
        ],
      }),
    );

    expect(result.ready_to_build).toBe(true);
    expect(ids(result)).toEqual([
      'recommended:design-guidance',
      'recommended:security',
      'recommended:scope',
      'recommended:success-metrics',
      'recommended:global-acceptance-criteria',
      'recommended:target-metrics',
      'recommended:rollout',
      'recommended:data-models',
    ]);
  });

  it('requires permissions once there is data or an outside service to protect', () => {
    const base = {
      userStories: [story('US001')],
      nonGoals: ['x'],
      outOfScope: ['y'],
      edgeCases: [{ id: 'EC001', case: 'c', expectedBehavior: 'b', status: 'decided' as const }],
    };

    expect(ids(checkPlan(prd(base)))).not.toContain('required:permissions');

    const withData = checkPlan(
      prd({
        ...base,
        technicalContracts: { ...prd().technicalContracts, dataModels: ['Invoice: ...'] },
      }),
    );

    expect(withData.ready_to_build).toBe(false);
    expect(ids(withData)).toContain('required:permissions');
  });

  it('stops asking for parts marked not applicable, but not for open edge cases', () => {
    const result = checkPlan(
      prd({
        userStories: [story('US001')],
        nonGoals: ['x'],
        outOfScope: ['y'],
        technicalContracts: { ...prd().technicalContracts, dataModels: ['Invoice'] },
        edgeCases: [{ id: 'EC001', case: 'c', expectedBehavior: '', status: 'open' }],
        notApplicable: { rollout: 'Internal tool', measurement: '', security: 'Local only' },
      }),
    );

    expect(ids(result)).not.toContain('recommended:rollout');
    expect(ids(result)).not.toContain('recommended:target-metrics');
    expect(ids(result)).not.toContain('required:permissions');
    expect(ids(result)).not.toContain('recommended:security');
    expect(ids(result)).toContain('required:open-edge-cases');
  });

  it('requires edge cases once there are stories', () => {
    const result = checkPlan(
      prd({ userStories: [story('US001')], nonGoals: ['x'], outOfScope: ['y'] }),
    );

    expect(result.ready_to_build).toBe(false);
    expect(ids(result)).toContain('required:edge-cases');
  });

  it('blocks while an edge case is open, naming its stories', () => {
    const result = checkPlan(
      prd({
        userStories: [story('US001'), story('US002')],
        nonGoals: ['x'],
        outOfScope: ['y'],
        designGuidance: ['Use the kit components'],
        edgeCases: [
          { id: 'EC001', case: 'Partial payment', expectedBehavior: '', status: 'open', storyIds: ['US002'] },
          { id: 'EC002', case: 'Bounce', expectedBehavior: 'Pause', status: 'decided' },
        ],
      }),
    );

    const open = result.items.find((item) => item.id === 'open-edge-cases');

    expect(result.ready_to_build).toBe(false);
    expect(open).toMatchObject({ severity: 'required', storyIds: ['US002'] });
    expect(open?.message).toMatch(/^1 edge cases are still open/);
    expect(ids(result)).not.toContain('recommended:design-guidance');
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

  it('requires answers to questions that block unfinished stories', () => {
    const result = checkPlan(
      prd({
        userStories: [story('US001'), story('US002', { status: 'completed' })],
        nonGoals: ['x'],
        outOfScope: ['y'],
        edgeCases: [{ id: 'EC001', case: 'c', expectedBehavior: 'b', status: 'decided' }],
        openQuestions: [
          { id: 'Q001', question: 'Blocks US001', storyIds: ['US001'] },
          { id: 'Q002', question: 'Only blocks a completed story', storyIds: ['US002'] },
          { id: 'Q003', question: 'Blocks nothing' },
        ],
      }),
    );

    const byId = Object.fromEntries(result.items.map((item) => [item.id, item]));

    expect(result.ready_to_build).toBe(false);
    expect(byId['blocking-questions']).toMatchObject({ severity: 'required', storyIds: ['US001'] });
    expect(byId['open-questions']?.message).toMatch(/^2 open questions/);
  });
});
