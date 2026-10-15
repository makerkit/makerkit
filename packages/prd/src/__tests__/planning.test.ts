import { describe, expect, it } from 'vitest';

import { registerPRDTools } from '../mcp';
import { type PrdDeps, createPrdService } from '../prd.service';
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
    expect(read().openQuestions).toEqual(['Do we need custom fields?']);
    expect(read().decisionLog[0]).toMatchObject({
      decision: 'Yes, a deal has one or more contacts',
      topic: 'open-question',
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
