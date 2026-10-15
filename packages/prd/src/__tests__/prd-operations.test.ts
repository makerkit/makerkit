import { describe, expect, it } from 'vitest';

import {
  assignStoryToPhase,
  createPhase,
  deleteStory,
  nextStoryId,
  updateStory,
} from '../prd-operations';
import { normalizePrd } from '../prd.service';
import type { StructuredPRD, UserStory } from '../types';

const TODAY = '2026-09-06';

function prdWith(stories: Partial<UserStory>[] = []): StructuredPRD {
  const prd = normalizePrd({}, TODAY);

  prd.userStories = stories.map((overrides, index) => ({
    id: `US${String(index + 1).padStart(3, '0')}`,
    title: `Story ${index + 1}`,
    userStory: 'As a member, I want to export data so that I can audit it',
    businessValue: 'audit',
    acceptanceCriteria: [],
    status: 'not_started' as const,
    priority: 'P2' as const,
    estimatedComplexity: 'M' as const,
    dependencies: [],
    ...overrides,
  }));

  return prd;
}

describe('updateStory', () => {
  it('changes only the fields supplied', () => {
    const prd = prdWith([{}]);
    const before = prd.userStories[0]!.userStory;

    const result = updateStory(
      prd,
      { filename: 'f.json', storyId: 'US001', title: 'Bulk CSV export' },
      TODAY,
    );

    expect(result.updated_fields).toEqual(['title']);
    expect(prd.userStories[0]!.title).toBe('Bulk CSV export');
    expect(prd.userStories[0]!.userStory).toBe(before);
  });

  it('patches one part of the user-story sentence and keeps the rest', () => {
    const prd = prdWith([{}]);

    updateStory(
      prd,
      { filename: 'f.json', storyId: 'US001', userType: 'workspace owner' },
      TODAY,
    );

    expect(prd.userStories[0]!.userStory).toBe(
      'As a workspace owner, I want to export data so that I can audit it',
    );
  });

  it('keeps businessValue in step with a changed benefit', () => {
    const prd = prdWith([{}]);

    updateStory(
      prd,
      {
        filename: 'f.json',
        storyId: 'US001',
        benefit: 'I can prove compliance',
      },
      TODAY,
    );

    expect(prd.userStories[0]!.businessValue).toBe('I can prove compliance');
  });

  it('lets an explicit businessValue win over the derived one', () => {
    const prd = prdWith([{}]);

    updateStory(
      prd,
      {
        filename: 'f.json',
        storyId: 'US001',
        benefit: 'I can prove compliance',
        businessValue: 'Unblocks the SOC2 audit',
      },
      TODAY,
    );

    expect(prd.userStories[0]!.businessValue).toBe('Unblocks the SOC2 audit');
  });

  it('refuses a partial sentence edit when the story is not in the standard form', () => {
    const prd = prdWith([{ userStory: 'Export things, somehow' }]);

    expect(() =>
      updateStory(
        prd,
        { filename: 'f.json', storyId: 'US001', action: 'export as CSV' },
        TODAY,
      ),
    ).toThrow(/cannot be patched individually/);
  });

  it('rebuilds a non-standard sentence when all three parts are supplied', () => {
    const prd = prdWith([{ userStory: 'Export things, somehow' }]);

    updateStory(
      prd,
      {
        filename: 'f.json',
        storyId: 'US001',
        userType: 'owner',
        action: 'export as CSV',
        benefit: 'I can audit access',
      },
      TODAY,
    );

    expect(prd.userStories[0]!.userStory).toBe(
      'As a owner, I want to export as CSV so that I can audit access',
    );
  });

  it('rejects an update that names no fields', () => {
    const prd = prdWith([{}]);

    expect(() =>
      updateStory(prd, { filename: 'f.json', storyId: 'US001' }, TODAY),
    ).toThrow(/No fields supplied/);
  });

  it('names the known stories when the id is wrong', () => {
    const prd = prdWith([{}, {}]);

    expect(() =>
      updateStory(
        prd,
        { filename: 'f.json', storyId: 'US009', title: 'x' },
        TODAY,
      ),
    ).toThrow(/Known stories: US001, US002/);
  });

  it('records a change-log entry', () => {
    const prd = prdWith([{}]);

    updateStory(
      prd,
      { filename: 'f.json', storyId: 'US001', title: 'New' },
      TODAY,
    );

    expect(prd.changeLog.at(-1)).toBe('2026-09-06: Updated US001 (title)');
  });

  describe('dependencies', () => {
    it('accepts references to other stories and de-duplicates them', () => {
      const prd = prdWith([{}, {}]);

      updateStory(
        prd,
        {
          filename: 'f.json',
          storyId: 'US002',
          dependencies: ['US001', 'US001'],
        },
        TODAY,
      );

      expect(prd.userStories[1]!.dependencies).toEqual(['US001']);
    });

    it('rejects a self-dependency', () => {
      const prd = prdWith([{}]);

      expect(() =>
        updateStory(
          prd,
          { filename: 'f.json', storyId: 'US001', dependencies: ['US001'] },
          TODAY,
        ),
      ).toThrow(/cannot depend on itself/);
    });

    it('rejects an unknown dependency', () => {
      const prd = prdWith([{}]);

      expect(() =>
        updateStory(
          prd,
          { filename: 'f.json', storyId: 'US001', dependencies: ['US404'] },
          TODAY,
        ),
      ).toThrow(/not found/);
    });

    it('rejects a dependency cycle', () => {
      const prd = prdWith([{}, {}, {}]);

      prd.userStories[1]!.dependencies = ['US001'];
      prd.userStories[2]!.dependencies = ['US002'];

      // US001 -> US003 would close the loop US001 -> US003 -> US002 -> US001.
      expect(() =>
        updateStory(
          prd,
          { filename: 'f.json', storyId: 'US001', dependencies: ['US003'] },
          TODAY,
        ),
      ).toThrow(/Dependency cycle/);

      // The rejected edit must not have been partially applied.
      expect(prd.userStories[0]!.dependencies).toEqual([]);
    });
  });
});

describe('deleteStory', () => {
  it('removes the story and recomputes progress', () => {
    const prd = prdWith([{ status: 'completed' }, {}]);

    const result = deleteStory(prd, 'US002', TODAY);

    expect(result.total_stories).toBe(1);
    expect(result.progress).toBe(100);
    expect(prd.userStories.map((story) => story.id)).toEqual(['US001']);
  });

  it('cleans up dependency references and reports them', () => {
    const prd = prdWith([
      {},
      { dependencies: ['US001'] },
      { dependencies: ['US001'] },
    ]);

    const result = deleteStory(prd, 'US001', TODAY);

    expect(result.dependency_references_removed).toEqual(['US002', 'US003']);
    expect(
      prd.userStories.every((story) => story.dependencies.length === 0),
    ).toBe(true);
  });

  it('removes the story from any phase', () => {
    const prd = prdWith([{}]);

    createPhase(
      prd,
      { filename: 'f.json', name: 'MVP', description: '', color: '#4f46e5' },
      TODAY,
    );
    assignStoryToPhase(
      prd,
      { filename: 'f.json', storyId: 'US001', phaseId: 'PHASE001' },
      TODAY,
    );

    const result = deleteStory(prd, 'US001', TODAY);

    expect(result.phases_updated).toEqual(['PHASE001']);
    expect(prd.customPhases[0]!.userStoryIds).toEqual([]);
  });

  it('supersedes decisions about the deleted story', () => {
    const prd = prdWith([{}]);

    prd.decisionLog.push({
      id: 'DEC001',
      date: TODAY,
      decision: 'none',
      rationale: 'standalone',
      status: 'accepted',
      topic: 'story:US001:dependencies',
    });

    deleteStory(prd, 'US001', TODAY);

    expect(prd.decisionLog[0]!.status).toBe('superseded');
  });
});

describe('phases', () => {
  it('numbers phases from the highest existing id', () => {
    const prd = prdWith();

    createPhase(
      prd,
      { filename: 'f.json', name: 'MVP', description: '', color: '#4f46e5' },
      TODAY,
    );
    const second = createPhase(
      prd,
      {
        filename: 'f.json',
        name: 'Fast follow',
        description: '',
        color: '#4f46e5',
      },
      TODAY,
    );

    expect(second.phase.id).toBe('PHASE002');
    expect(second.total_phases).toBe(2);
  });

  it('rejects a duplicate phase name regardless of case', () => {
    const prd = prdWith();

    createPhase(
      prd,
      { filename: 'f.json', name: 'MVP', description: '', color: '#4f46e5' },
      TODAY,
    );

    expect(() =>
      createPhase(
        prd,
        { filename: 'f.json', name: 'mvp', description: '', color: '#4f46e5' },
        TODAY,
      ),
    ).toThrow(/already exists/);
  });

  it('moves a story between phases rather than duplicating it', () => {
    const prd = prdWith([{}]);

    createPhase(
      prd,
      { filename: 'f.json', name: 'A', description: '', color: '#4f46e5' },
      TODAY,
    );
    createPhase(
      prd,
      { filename: 'f.json', name: 'B', description: '', color: '#4f46e5' },
      TODAY,
    );

    assignStoryToPhase(
      prd,
      { filename: 'f.json', storyId: 'US001', phaseId: 'PHASE001' },
      TODAY,
    );
    const result = assignStoryToPhase(
      prd,
      { filename: 'f.json', storyId: 'US001', phaseId: 'PHASE002' },
      TODAY,
    );

    expect(result.moved_from).toBe('PHASE001');
    expect(prd.customPhases[0]!.userStoryIds).toEqual([]);
    expect(prd.customPhases[1]!.userStoryIds).toEqual(['US001']);
  });

  it('unassigns a story when phaseId is null', () => {
    const prd = prdWith([{}]);

    createPhase(
      prd,
      { filename: 'f.json', name: 'A', description: '', color: '#4f46e5' },
      TODAY,
    );
    assignStoryToPhase(
      prd,
      { filename: 'f.json', storyId: 'US001', phaseId: 'PHASE001' },
      TODAY,
    );

    const result = assignStoryToPhase(
      prd,
      { filename: 'f.json', storyId: 'US001', phaseId: null },
      TODAY,
    );

    expect(result.phase_id).toBeNull();
    expect(result.moved_from).toBe('PHASE001');
    expect(prd.customPhases[0]!.userStoryIds).toEqual([]);
  });

  it('names the known phases when the phase id is wrong', () => {
    const prd = prdWith([{}]);

    createPhase(
      prd,
      { filename: 'f.json', name: 'A', description: '', color: '#4f46e5' },
      TODAY,
    );

    expect(() =>
      assignStoryToPhase(
        prd,
        { filename: 'f.json', storyId: 'US001', phaseId: 'PHASE404' },
        TODAY,
      ),
    ).toThrow(/Known phases: PHASE001/);
  });
});

describe('nextStoryId', () => {
  it('never reissues the id of a deleted story', () => {
    const prd = prdWith();

    expect(nextStoryId(prd)).toBe('US001');
    expect(nextStoryId(prd)).toBe('US002');

    // Even with the document emptied, the mark keeps counting.
    prd.userStories = [];

    expect(nextStoryId(prd)).toBe('US003');
  });

  it('falls back to the highest present id on a PRD written before the mark existed', () => {
    const prd = prdWith([{}, {}, {}]);

    delete prd.metadata.lastStoryNumber;

    expect(nextStoryId(prd)).toBe('US004');
  });
});
