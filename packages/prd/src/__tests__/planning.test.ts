import { describe, expect, it } from 'vitest';

import { registerPRDTools } from '../mcp';
import {
  type PrdDeps,
  PrdRevisionConflictError,
  createPrdService,
} from '../prd.service';
import { createFakeMcpServer } from '../testing/fake-mcp-server';
import type { StructuredPRD } from '../types';

const basename = (path: string) => path.replace(/\\/g, '/').split('/').pop()!;

function createDeps(files: Record<string, string>): PrdDeps {
  return {
    rootPath: '/repo',
    async readdir() {
      return Object.keys(files);
    },
    async readFile(path) {
      const content = files[basename(path)];

      if (content === undefined) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }

      return content;
    },
    async writeFile(path, content) {
      files[basename(path)] = content;
    },
    async mkdir() {},
    async unlink(path) {
      delete files[basename(path)];
    },
    async fileExists(path) {
      return basename(path) in files;
    },
    now: () => new Date('2026-10-14T10:00:00Z'),
    verifyCompletion: async () => ({
      passed: true,
      checks: [],
      errors: 0,
      warnings: 0,
      diagnostics: [],
      messages: [],
    }),
  };
}

async function seed() {
  const files: Record<string, string> = {};
  const service = createPrdService(createDeps(files));

  const { filename } = await service.create({
    title: 'Simple CRM',
    overview: 'Track contacts and deals',
    problemStatement: 'Spreadsheets lose context',
    marketOpportunity: 'Internal tool',
    targetUsers: ['Founder'],
    solutionDescription: 'Contacts, deals and a pipeline board',
    keyFeatures: ['Contacts', 'Deals'],
    successMetrics: ['Every deal has a next step'],
    openQuestions: [
      'Can a deal have several contacts?',
      'Do we need custom fields?',
    ],
  });

  const read = () => JSON.parse(files[filename]!) as StructuredPRD;

  return { files, filename, service, read };
}

describe('update_prd_section', () => {
  it('merges object sections and keeps keys that were not given', async () => {
    const { filename, service, read } = await seed();

    const result = await service.updatePrdSection({
      filename,
      section: 'solutionOverview',
      value: { keyFeatures: ['Contacts', 'Deals', 'Pipeline board'] },
    });

    expect(result.updated).toEqual(['keyFeatures']);
    expect(read().solutionOverview).toMatchObject({
      description: 'Contacts, deals and a pipeline board',
      keyFeatures: ['Contacts', 'Deals', 'Pipeline board'],
    });
  });

  it('replaces list sections', async () => {
    const { filename, service, read } = await seed();

    await service.updatePrdSection({
      filename,
      section: 'nonGoals',
      value: ['Custom fields', 'Email sync'],
    });

    expect(read().nonGoals).toEqual(['Custom fields', 'Email sync']);
  });

  it('assigns ids to risks that have none', async () => {
    const { filename, service, read } = await seed();

    await service.updatePrdSection({
      filename,
      section: 'risks',
      value: [
        {
          description: 'Data loss',
          mitigation: 'Backups',
          owner: 'me',
          severity: 'high',
        },
        {
          id: 'RISK009',
          description: 'Scope creep',
          mitigation: 'Non-goals',
          owner: 'me',
          severity: 'low',
        },
      ],
    });

    expect(read().risks.map((risk) => risk.id)).toEqual(['RISK001', 'RISK009']);
  });

  it('rejects a value with the wrong shape and says why', async () => {
    const { filename, service } = await seed();

    await expect(
      service.updatePrdSection({
        filename,
        section: 'nonGoals',
        value: 'Custom fields',
      }),
    ).rejects.toThrow(/Invalid value for section "nonGoals"/);

    await expect(
      service.updatePrdSection({
        filename,
        section: 'constraints',
        value: { deadline: 'Friday' },
      }),
    ).rejects.toThrow(/Unrecognized key/);
  });

  it('applies the change when expectedRevision matches the PRD', async () => {
    const { filename, service, read } = await seed();
    const revision = read().metadata.revision ?? 0;

    await service.updatePrdSection({
      filename,
      section: 'nonGoals',
      value: ['Mobile app'],
      expectedRevision: revision,
    });

    expect(read().nonGoals).toEqual(['Mobile app']);
    expect(read().metadata.revision).toBe(revision + 1);
  });

  it('rejects a change based on an older revision and leaves the PRD as is', async () => {
    const { filename, service, read } = await seed();
    const seen = read().metadata.revision ?? 0;

    // Someone else edits the same section after it was read
    await service.updatePrdSection({
      filename,
      section: 'nonGoals',
      value: ['Changed by the agent'],
    });

    const error = await service
      .updatePrdSection({
        filename,
        section: 'nonGoals',
        value: ['Stale edit'],
        expectedRevision: seen,
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PrdRevisionConflictError);
    expect(error).toMatchObject({
      code: 'PRD_REVISION_CONFLICT',
      expectedRevision: seen,
      currentRevision: seen + 1,
    });
    expect(read().nonGoals).toEqual(['Changed by the agent']);
  });
});

describe('decisions and open questions', () => {
  it('supersedes an earlier decision', async () => {
    const { filename, service, read } = await seed();

    await service.addDecision({
      filename,
      decision: 'Pipeline stages are hard-coded',
      rationale: 'Internal tool, one user',
      status: 'accepted',
    });
    const second = await service.addDecision({
      filename,
      decision: 'Pipeline stages are configurable',
      rationale: 'A second team will use it',
      status: 'accepted',
      supersedes: 'DEC001',
    });

    expect(second).toEqual({
      decision_id: 'DEC002',
      superseded: 'DEC001',
      total_decisions: 2,
    });
    expect(read().decisionLog.map((entry) => entry.status)).toEqual([
      'superseded',
      'accepted',
    ]);
  });

  it('resolves an open question into the decision log', async () => {
    const { filename, service, read } = await seed();

    const result = await service.resolveOpenQuestion({
      filename,
      question: '  can a deal have several CONTACTS? ',
      answer: 'Yes, a deal has one or more contacts',
      recordDecision: true,
    });

    expect(result).toEqual({ remaining_questions: 1, decision_id: 'DEC001' });
    expect(read().openQuestions).toEqual([
      { id: 'Q002', question: 'Do we need custom fields?' },
    ]);
    expect(read().decisionLog[0]).toMatchObject({
      decision: 'Yes, a deal has one or more contacts',
      topic: 'open-question:Q001',
    });
  });

  it('lists the open questions when the question does not match', async () => {
    const { filename, service } = await seed();

    await expect(
      service.resolveOpenQuestion({
        filename,
        question: 'Nope',
        answer: 'x',
        recordDecision: true,
      }),
    ).rejects.toThrow(/Do we need custom fields\?/);
  });
});

describe('glossary', () => {
  it('adds terms and redefines existing ones regardless of casing', async () => {
    const { filename, service, read } = await seed();

    await service.addGlossaryTerm({
      filename,
      term: 'Deal',
      definition: 'A potential sale',
      avoid: ['Opportunity'],
    });
    const redefined = await service.addGlossaryTerm({
      filename,
      term: 'deal',
      definition: 'A potential sale with a value and a stage',
      avoid: ['Opportunity', 'Lead'],
    });

    expect(redefined).toEqual({ term: 'deal', replaced: true, total_terms: 1 });
    expect(read().glossary).toEqual([
      {
        term: 'deal',
        definition: 'A potential sale with a value and a stage',
        avoid: ['Opportunity', 'Lead'],
      },
    ]);
  });
});

describe('phases', () => {
  async function seedPhases() {
    const context = await seed();
    const { filename, service } = context;

    for (const name of ['Contacts', 'Deals', 'Pipeline']) {
      await service.createCustomPhase({
        filename,
        name,
        description: '',
        color: '#4f46e5',
      });
    }

    return context;
  }

  it('renames a phase and rejects duplicate names', async () => {
    const { filename, service } = await seedPhases();

    const result = await service.updatePhase({
      filename,
      phaseId: 'PHASE001',
      name: 'People',
    });
    expect(result.phases[0]).toMatchObject({ id: 'PHASE001', name: 'People' });

    await expect(
      service.updatePhase({ filename, phaseId: 'PHASE002', name: 'people' }),
    ).rejects.toThrow(/already exists/);
  });

  it('deletes a phase, keeps its stories and renumbers the rest', async () => {
    const { filename, service, read } = await seedPhases();

    await service.addUserStory({
      filename,
      userType: 'founder',
      action: 'add a contact',
      benefit: 'I remember people',
      acceptanceCriteria: ['Contact saved'],
      priority: 'P1',
    });
    await service.assignStoryToPhase({
      filename,
      storyId: 'US001',
      phaseId: 'PHASE001',
    });

    const result = await service.deletePhase({ filename, phaseId: 'PHASE001' });

    expect(result.phases.map((phase) => [phase.id, phase.order])).toEqual([
      ['PHASE002', 0],
      ['PHASE003', 1],
    ]);
    expect(read().userStories.map((story) => story.id)).toEqual(['US001']);
  });

  it('reorders phases, which changes what get_next_story picks', async () => {
    const { filename, service } = await seedPhases();

    for (const action of ['add a contact', 'add a deal']) {
      await service.addUserStory({
        filename,
        userType: 'founder',
        action,
        benefit: 'it helps',
        acceptanceCriteria: ['works'],
        priority: 'P2',
      });
    }
    await service.assignStoryToPhase({
      filename,
      storyId: 'US001',
      phaseId: 'PHASE001',
    });
    await service.assignStoryToPhase({
      filename,
      storyId: 'US002',
      phaseId: 'PHASE002',
    });

    expect((await service.getNextStory(filename)).story?.id).toBe('US001');

    await service.reorderPhases({
      filename,
      phaseIds: ['PHASE002', 'PHASE001', 'PHASE003'],
    });

    expect((await service.getNextStory(filename)).story?.id).toBe('US002');
  });

  it('requires every phase exactly once when reordering', async () => {
    const { filename, service } = await seedPhases();

    await expect(
      service.reorderPhases({ filename, phaseIds: ['PHASE002', 'PHASE001'] }),
    ).rejects.toThrow(/every phase exactly once/);
  });
});

describe('test seams', () => {
  it('stores seams when adding and updating a story', async () => {
    const { filename, service, read } = await seed();

    await service.addUserStory({
      filename,
      userType: 'founder',
      action: 'move a deal between stages',
      benefit: 'the board stays current',
      acceptanceCriteria: ['Stage saved'],
      priority: 'P1',
      testSeams: ['moveDealAction'],
    });
    expect(read().userStories[0]?.testSeams).toEqual(['moveDealAction']);

    await service.updateUserStory({
      filename,
      storyId: 'US001',
      testSeams: ['DealsService.move'],
    });
    expect(read().userStories[0]?.testSeams).toEqual(['DealsService.move']);
  });
});

describe('story design and security notes', () => {
  async function seedStory() {
    const seeded = await seed();

    await seeded.service.addUserStory({
      filename: seeded.filename,
      userType: 'founder',
      action: 'export deals as CSV',
      benefit: 'I can share them',
      acceptanceCriteria: ['CSV downloads'],
      priority: 'P1',
      designNotes: ['Export button sits in the table toolbar'],
      securityNotes: [
        'Formula injection: cells starting with = are prefixed with a quote',
      ],
    });

    return seeded;
  }

  it('stores notes when adding a story and shows them in get_story', async () => {
    const { filename, service, read } = await seedStory();

    expect(read().userStories[0]).toMatchObject({
      designNotes: ['Export button sits in the table toolbar'],
      securityNotes: [
        'Formula injection: cells starting with = are prefixed with a quote',
      ],
    });

    const context = await service.getStory({ filename, storyId: 'US001' });

    expect(context.design.story_notes).toEqual([
      'Export button sits in the table toolbar',
    ]);
    expect(context.security.story_notes).toHaveLength(1);
  });

  it('replaces the notes on update, dropping blank entries', async () => {
    const { filename, service, read } = await seedStory();

    const result = await service.updateUserStory({
      filename,
      storyId: 'US001',
      designNotes: ['  Empty state says "No deals to export"  ', '   '],
      securityNotes: [],
    });

    expect(result.updated_fields).toEqual(['designNotes', 'securityNotes']);
    expect(read().userStories[0]?.designNotes).toEqual([
      'Empty state says "No deals to export"',
    ]);
    expect(read().userStories[0]?.securityNotes).toEqual([]);
  });

  it('defaults to empty notes in get_story for stories without them', async () => {
    const { filename, service } = await seed();

    await service.addUserStory({
      filename,
      userType: 'founder',
      action: 'rename a deal',
      benefit: 'names stay accurate',
      acceptanceCriteria: ['Name saved'],
      priority: 'P2',
    });

    const context = await service.getStory({ filename, storyId: 'US001' });

    expect(context.design.story_notes).toEqual([]);
    expect(context.security.story_notes).toEqual([]);
  });
});

describe('MCP registration', () => {
  it('exposes the planning tools and the shape_prd prompt', async () => {
    const fake = createFakeMcpServer();
    const { files, filename } = await seed();

    registerPRDTools(fake.server, createPrdService(createDeps(files)));

    const result = await fake.call('update_prd_section', {
      filename,
      section: 'outOfScope',
      value: ['Mobile app'],
    });
    expect(result.structuredContent).toEqual({
      section: 'outOfScope',
      updated: ['outOfScope'],
    });

    const invalid = await fake.call('update_prd_section', {
      filename,
      section: 'outOfScope',
      value: 42,
    });
    expect(invalid.isError).toBe(true);

    const prompt = fake.prompts.find((entry) => entry.name === 'shape_prd');
    const text = prompt!.handler({ idea: 'A simple CRM' }).messages[0]!.content
      .text;

    expect(text).toContain('The idea: A simple CRM');
    for (const tool of [
      'create_prd',
      'update_prd_section',
      'add_glossary_term',
      'add_decision',
      'add_user_story',
    ]) {
      expect(text).toContain(tool);
    }
    expect(text).toContain('dataModels');
    expect(text).toContain('integrationNeeds');
  });
});

describe('add_user_story with dependencies and a phase', () => {
  const STORY = {
    userType: 'founder',
    benefit: 'it helps',
    acceptanceCriteria: ['works', 'is tested'],
    priority: 'P2' as const,
  };

  it('sets dependencies and the phase in the same call', async () => {
    const { filename, service, read } = await seed();
    const { phase } = await service.createCustomPhase({
      filename,
      name: 'Deals',
      description: '',
      color: '#4f46e5',
    });

    await service.addUserStory({ ...STORY, filename, action: 'add a contact' });
    await service.addUserStory({
      ...STORY,
      filename,
      action: 'add a deal',
      dependencies: ['US001'],
      phaseId: phase.id,
    });

    const prd = read();

    expect(prd.userStories[1]?.dependencies).toEqual(['US001']);
    expect(prd.customPhases[0]?.userStoryIds).toEqual(['US002']);
  });

  it('rejects an unknown dependency or phase without saving the story', async () => {
    const { filename, service, read } = await seed();

    await expect(
      service.addUserStory({
        ...STORY,
        filename,
        action: 'add a deal',
        dependencies: ['US404'],
      }),
    ).rejects.toThrow(/US404/);

    await expect(
      service.addUserStory({
        ...STORY,
        filename,
        action: 'add a deal',
        phaseId: 'PHASE404',
      }),
    ).rejects.toThrow(/PHASE404/);

    expect(read().userStories).toEqual([]);
    expect(read().metadata.lastStoryNumber).toBeUndefined();
  });

  it('accepts both fields through the MCP tool', async () => {
    const fake = createFakeMcpServer();
    const { files, filename, service, read } = await seed();

    await service.addUserStory({ ...STORY, filename, action: 'add a contact' });
    const { phase } = await service.createCustomPhase({
      filename,
      name: 'Deals',
      description: '',
      color: '#4f46e5',
    });

    registerPRDTools(fake.server, createPrdService(createDeps(files)));

    const result = await fake.call('add_user_story', {
      ...STORY,
      filename,
      action: 'add a deal',
      dependencies: ['US001'],
      phaseId: phase.id,
    });

    expect(result.isError).toBeFalsy();
    expect(read().userStories[1]?.dependencies).toEqual(['US001']);
    expect(read().customPhases[0]?.userStoryIds).toEqual(['US002']);
  });
});

describe('edge cases and design guidance', () => {
  async function seedWithStories() {
    const seeded = await seed();

    for (const action of ['send an invoice', 'get paid']) {
      await seeded.service.addUserStory({
        filename: seeded.filename,
        userType: 'founder',
        action,
        benefit: 'I get paid',
        acceptanceCriteria: ['It works', 'It is fast'],
        priority: 'P1',
      });
    }

    return seeded;
  }

  it('replaces the edge cases, giving new ones an id', async () => {
    const { filename, service, read } = await seedWithStories();

    await service.updatePrdSection({
      filename,
      section: 'edgeCases',
      value: [
        {
          case: 'Client pays part of the invoice',
          status: 'open',
          storyIds: ['US002'],
        },
        {
          case: 'Email bounces',
          expectedBehavior: 'Pause and notify',
          status: 'decided',
        },
      ],
    });

    expect(read().edgeCases).toEqual([
      {
        id: 'EC001',
        case: 'Client pays part of the invoice',
        expectedBehavior: '',
        status: 'open',
        storyIds: ['US002'],
      },
      {
        id: 'EC002',
        case: 'Email bounces',
        expectedBehavior: 'Pause and notify',
        status: 'decided',
      },
    ]);
  });

  it('rejects a decided case without behaviour and links to unknown stories', async () => {
    const { filename, service, read } = await seedWithStories();

    await expect(
      service.updatePrdSection({
        filename,
        section: 'edgeCases',
        value: [{ case: 'Bounce', status: 'decided' }],
      }),
    ).rejects.toThrow(/decided edge case needs its expectedBehavior/);

    await expect(
      service.updatePrdSection({
        filename,
        section: 'edgeCases',
        value: [{ case: 'Bounce', storyIds: ['US999'] }],
      }),
    ).rejects.toThrow(/unknown stories US999/);

    expect(read().edgeCases).toEqual([]);
  });

  it('gives a story its edge cases and the design rules', async () => {
    const { filename, service } = await seedWithStories();

    await service.updatePrdSection({
      filename,
      section: 'edgeCases',
      value: [
        { case: 'Partial payment', storyIds: ['US002'] },
        {
          case: 'Server down',
          expectedBehavior: 'Retry later',
          status: 'decided',
        },
      ],
    });
    await service.updatePrdSection({
      filename,
      section: 'designGuidance',
      value: ['Use the kit components'],
    });
    await service.addDecision({
      filename,
      decision: 'Invoices open in a side panel',
      rationale: 'Keeps the list in view',
      status: 'accepted',
      topic: 'design:invoice-detail',
    });

    const first = await service.getStory({ filename, storyId: 'US001' });
    const second = await service.getStory({ filename, storyId: 'US002' });

    expect(first.edge_cases.map((edgeCase) => edgeCase.case)).toEqual([
      'Server down',
    ]);
    expect(second.edge_cases.map((edgeCase) => edgeCase.case)).toEqual([
      'Partial payment',
      'Server down',
    ]);
    expect(first.design).toEqual({
      guidance: ['Use the kit components'],
      decisions: [
        expect.objectContaining({ decision: 'Invoices open in a side panel' }),
      ],
      story_notes: [],
    });
  });

  it('drops an edge case only about a deleted story and unlinks shared ones', async () => {
    const { filename, service, read } = await seedWithStories();

    await service.updatePrdSection({
      filename,
      section: 'edgeCases',
      value: [
        { case: 'Only about US002', storyIds: ['US002'] },
        { case: 'Shared', storyIds: ['US001', 'US002'] },
      ],
    });
    await service.deleteUserStory({ filename, storyId: 'US002' });

    expect(
      read().edgeCases.map(({ case: text, storyIds }) => [text, storyIds]),
    ).toEqual([['Shared', ['US001']]]);
  });

  it('keeps hand-edited files readable', async () => {
    const { normalizePrd } = await import('../prd.service');

    const prd = normalizePrd(
      {
        edgeCases: [
          { id: 'EC1', case: 'Fine' },
          { case: 'No id' },
          'nonsense',
          null,
        ],
        designGuidance: ['Ok', 3],
      },
      '2026-10-15',
    );

    expect(prd.edgeCases).toEqual([
      { id: 'EC1', case: 'Fine', expectedBehavior: '', status: 'open' },
    ]);
    expect(prd.designGuidance).toEqual(['Ok']);
  });
});

describe('mark_not_applicable', () => {
  it('marks and unmarks a part, keeping the reason', async () => {
    const { filename, service, read } = await seed();

    expect(
      await service.markNotApplicable({
        filename,
        topic: 'rollout',
        notApplicable: true,
        reason: ' Internal tool ',
      }),
    ).toEqual({
      topic: 'rollout',
      not_applicable: true,
      reason: 'Internal tool',
    });
    expect(read().notApplicable).toEqual({ rollout: 'Internal tool' });

    await service.markNotApplicable({
      filename,
      topic: 'rollout',
      notApplicable: false,
    });

    expect(read().notApplicable).toEqual({});
  });

  it('rejects a change based on an older revision', async () => {
    const { filename, service, read } = await seed();
    const seen = read().metadata.revision ?? 0;

    await service.updatePrdSection({
      filename,
      section: 'nonGoals',
      value: ['x'],
    });

    await expect(
      service.markNotApplicable({
        filename,
        topic: 'risks',
        notApplicable: true,
        expectedRevision: seen,
      }),
    ).rejects.toThrow(/changed by someone else/);
  });

  it('drops unknown topics from hand-edited files', async () => {
    const { normalizePrd } = await import('../prd.service');

    expect(
      normalizePrd(
        { notApplicable: { rollout: 'x', nonsense: 'y', risks: 3 } },
        '2026-10-15',
      ).notApplicable,
    ).toEqual({ rollout: 'x' });
  });

  it('tells the agent about security rules and parts that do not apply', async () => {
    const { filename, service } = await seed();

    await service.addUserStory({
      filename,
      userType: 'founder',
      action: 'send an invoice',
      benefit: 'I get paid',
      acceptanceCriteria: ['a', 'b'],
      priority: 'P1',
    });
    await service.updatePrdSection({
      filename,
      section: 'securityConsiderations',
      value: ['Validate all input on the server'],
    });
    await service.updatePrdSection({
      filename,
      section: 'technicalContracts',
      value: { permissions: ['Only the owner sees an invoice'] },
    });
    await service.markNotApplicable({
      filename,
      topic: 'rollout',
      notApplicable: true,
      reason: 'Internal',
    });

    const context = await service.getStory({ filename, storyId: 'US001' });

    expect(context.security).toEqual({
      permissions: ['Only the owner sees an invoice'],
      compliance: [],
      considerations: ['Validate all input on the server'],
      story_notes: [],
    });
    expect(context.not_applicable).toEqual({ rollout: 'Internal' });
  });
});

describe('open questions', () => {
  async function seedWithStory() {
    const seeded = await seed();

    await seeded.service.addUserStory({
      filename: seeded.filename,
      userType: 'founder',
      action: 'track deals',
      benefit: 'I close more',
      acceptanceCriteria: ['a', 'b'],
      priority: 'P1',
    });

    return seeded;
  }

  it('stores questions with why, options, recommendation and blocked stories', async () => {
    const { filename, service, read } = await seedWithStory();
    const [existing] = read().openQuestions;

    await service.updatePrdSection({
      filename,
      section: 'openQuestions',
      value: [
        existing,
        {
          question: 'Can a deal be reopened?',
          why: 'Otherwise the agent decides whether lost deals are final',
          options: ['Yes, by its owner', 'No, create a new deal'],
          recommended: 'No, create a new deal',
          storyIds: ['US001'],
        },
        'A plain question still works',
      ],
    });

    expect(
      read().openQuestions.map(({ id, question }) => `${id} ${question}`),
    ).toEqual([
      'Q001 Can a deal have several contacts?',
      'Q003 Can a deal be reopened?',
      'Q004 A plain question still works',
    ]);
    expect(read().openQuestions[1]).toMatchObject({
      options: ['Yes, by its owner', 'No, create a new deal'],
      recommended: 'No, create a new deal',
      storyIds: ['US001'],
    });
  });

  it('never reuses the id of an answered question', async () => {
    const { filename, service, read } = await seed();

    await service.resolveOpenQuestion({
      filename,
      questionId: 'Q002',
      answer: 'No',
      recordDecision: true,
    });
    await service.updatePrdSection({
      filename,
      section: 'openQuestions',
      value: [...read().openQuestions, 'New question'],
    });

    expect(read().openQuestions.map((q) => q.id)).toEqual(['Q001', 'Q003']);
  });

  it('rejects links to unknown stories', async () => {
    const { filename, service } = await seed();

    await expect(
      service.updatePrdSection({
        filename,
        section: 'openQuestions',
        value: [{ question: 'x', storyIds: ['US404'] }],
      }),
    ).rejects.toThrow(/unknown stories US404/);
  });

  it('answers by id with the revision it was based on', async () => {
    const { filename, service, read } = await seed();
    const seen = read().metadata.revision ?? 0;

    await service.updatePrdSection({
      filename,
      section: 'nonGoals',
      value: ['x'],
    });

    await expect(
      service.resolveOpenQuestion({
        filename,
        questionId: 'Q001',
        answer: 'Yes',
        recordDecision: true,
        expectedRevision: seen,
      }),
    ).rejects.toThrow(/changed by someone else/);
    expect(read().openQuestions).toHaveLength(2);
  });

  it('gives a story the questions that block it', async () => {
    const { filename, service } = await seedWithStory();

    await service.updatePrdSection({
      filename,
      section: 'openQuestions',
      value: [{ question: 'Blocks it', storyIds: ['US001'] }, 'Does not'],
    });

    const context = await service.getStory({ filename, storyId: 'US001' });

    expect(context.open_questions.map((q) => q.question)).toEqual([
      'Blocks it',
    ]);
  });

  it('reads plain-string questions from older files', async () => {
    const { normalizePrd } = await import('../prd.service');

    expect(
      normalizePrd(
        { openQuestions: ['First', { id: 'Q007', question: 'Kept' }, '', 3] },
        '2026-10-15',
      ).openQuestions,
    ).toEqual([
      { id: 'Q008', question: 'First' },
      { id: 'Q007', question: 'Kept' },
    ]);
  });
});

describe('decide_edge_case', () => {
  it('decides an open edge case', async () => {
    const { filename, service, read } = await seed();

    await service.updatePrdSection({
      filename,
      section: 'edgeCases',
      value: [{ case: 'Duplicate contact' }, { case: 'Deal without owner' }],
    });

    expect(
      await service.decideEdgeCase({
        filename,
        edgeCaseId: 'EC001',
        expectedBehavior: ' Merge into the existing contact ',
      }),
    ).toEqual({ edge_case_id: 'EC001', open_edge_cases: 1 });
    expect(read().edgeCases[0]).toMatchObject({
      status: 'decided',
      expectedBehavior: 'Merge into the existing contact',
    });
  });

  it('fails for an unknown edge case', async () => {
    const { filename, service } = await seed();

    await expect(
      service.decideEdgeCase({
        filename,
        edgeCaseId: 'EC404',
        expectedBehavior: 'x',
      }),
    ).rejects.toThrow(/EC404/);
  });
});

describe('update_story_status with expectedRevision', () => {
  it('rejects a status change based on an older revision, before running checks', async () => {
    const { filename, service, read } = await seed();

    await service.addUserStory({
      filename,
      userType: 'founder',
      action: 'track deals',
      benefit: 'I close more',
      acceptanceCriteria: ['a', 'b'],
      priority: 'P1',
    });
    const seen = read().metadata.revision ?? 0;

    await service.updatePrdSection({
      filename,
      section: 'nonGoals',
      value: ['x'],
    });

    await expect(
      service.updateStoryStatus({
        filename,
        storyId: 'US001',
        status: 'blocked',
        expectedRevision: seen,
      }),
    ).rejects.toThrow(/changed by someone else/);
    expect(read().userStories[0]?.status).toBe('not_started');

    await service.updateStoryStatus({
      filename,
      storyId: 'US001',
      status: 'blocked',
      expectedRevision: seen + 1,
    });
    expect(read().userStories[0]?.status).toBe('blocked');
  });
});

describe('update_user_story with phase and revision', () => {
  it('moves the story to a phase in the same write, and refuses stale edits', async () => {
    const { filename, service, read } = await seed();

    await service.addUserStory({
      filename,
      userType: 'founder',
      action: 'track deals',
      benefit: 'I close more',
      acceptanceCriteria: ['a', 'b'],
      priority: 'P1',
    });
    const { phase } = await service.createCustomPhase({
      filename,
      name: 'MVP',
      description: '',
      color: '#4f46e5',
    });
    const seen = read().metadata.revision ?? 0;

    const result = await service.updateUserStory({
      filename,
      storyId: 'US001',
      title: 'Track deals',
      phaseId: phase.id,
      expectedRevision: seen,
    });

    expect(result.updated_fields).toEqual(['title', 'phase']);
    expect(read().customPhases[0]?.userStoryIds).toEqual(['US001']);
    expect(read().metadata.revision).toBe(seen + 1);

    await expect(
      service.updateUserStory({
        filename,
        storyId: 'US001',
        title: 'Stale',
        expectedRevision: seen,
      }),
    ).rejects.toThrow(/changed by someone else/);
    expect(read().userStories[0]?.title).toBe('Track deals');
  });
});
