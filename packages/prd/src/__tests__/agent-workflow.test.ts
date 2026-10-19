import { describe, expect, it } from 'vitest';

import { registerPRDTools } from '../mcp';
import { type PrdDeps, createPrdService } from '../prd.service';
import { implementStoryPrompt, shapePrdPrompt } from '../prompts';
import { createFakeMcpServer } from '../testing/fake-mcp-server';
import type { StructuredPRD } from '../types';

const basename = (path: string) => path.replace(/\\/g, '/').split('/').pop()!;

function createDeps(files: Record<string, string>, hooks: Hooks = {}) {
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
      hooks.beforeExists?.(basename(path));
      return basename(path) in files;
    },
    now: () => new Date('2026-10-14T10:00:00Z'),
    verifyCompletion: async () => ({
      passed: true,
      checks: ['typecheck'],
      errors: 0,
      warnings: 0,
      diagnostics: [],
      messages: [],
    }),
  } satisfies PrdDeps;
}

interface Hooks {
  beforeExists?: (file: string) => void;
}

const STORY = {
  userType: 'member',
  benefit: 'it helps',
  acceptanceCriteria: ['works'],
};

/** A PRD with US001 <- US002 (depends on US001) and an independent US003. */
async function seed(hooks: Hooks = {}) {
  const files: Record<string, string> = {};
  const service = createPrdService(createDeps(files, hooks));

  const { filename } = await service.create({
    title: 'Notes',
    overview: 'Let members keep notes',
    problemStatement: 'No place for context',
    marketOpportunity: 'Retention',
    targetUsers: ['Members'],
    solutionDescription: 'Notes per account',
    keyFeatures: ['Create note'],
    successMetrics: ['Notes created'],
    nonGoals: ['Rich text'],
  });

  await service.addUserStory({
    ...STORY,
    filename,
    action: 'create a note',
    priority: 'P2',
  });
  await service.addUserStory({
    ...STORY,
    filename,
    action: 'share a note',
    priority: 'P2',
  });
  await service.addUserStory({
    ...STORY,
    filename,
    action: 'pin a note',
    priority: 'P1',
  });
  await service.updateUserStory({
    filename,
    storyId: 'US002',
    dependencies: ['US001'],
  });

  const read = () => JSON.parse(files[filename]!) as StructuredPRD;

  return { files, filename, service, read };
}

describe('story workflow', () => {
  it('rejects starting a story before its dependencies are completed', async () => {
    const { filename, service } = await seed();

    await expect(
      service.updateStoryStatus({
        filename,
        storyId: 'US002',
        status: 'in_progress',
      }),
    ).rejects.toThrow(/depends on US001/);

    await expect(
      service.updateStoryStatus({
        filename,
        storyId: 'US002',
        status: 'completed',
      }),
    ).rejects.toThrow(/depends on US001/);
  });

  it('still allows planning or parking a waiting story', async () => {
    const { filename, service } = await seed();

    await expect(
      service.updateStoryStatus({
        filename,
        storyId: 'US002',
        status: 'research',
      }),
    ).resolves.toMatchObject({ status: 'research' });

    await expect(
      service.updateStoryStatus({
        filename,
        storyId: 'US002',
        status: 'blocked',
      }),
    ).resolves.toMatchObject({ status: 'blocked' });
  });

  it('allows the story once its dependencies are completed', async () => {
    const { filename, service } = await seed();

    await service.updateStoryStatus({
      filename,
      storyId: 'US001',
      status: 'completed',
    });

    await expect(
      service.updateStoryStatus({
        filename,
        storyId: 'US002',
        status: 'in_progress',
      }),
    ).resolves.toMatchObject({ status: 'in_progress' });
  });
});

describe('getNextStory', () => {
  it('prefers higher priority among ready stories and lists waiting ones', async () => {
    const { filename, service } = await seed();

    const next = await service.getNextStory(filename);

    expect(next.story?.id).toBe('US003');
    expect(next.ready_count).toBe(2);
    expect(next.waiting).toEqual([
      { id: 'US002', title: expect.any(String), waiting_on: ['US001'] },
    ]);
  });

  it('orders by phase before priority', async () => {
    const { filename, service } = await seed();

    const { phase } = await service.createCustomPhase({
      filename,
      name: 'Milestone 1',
      description: '',
      color: '#4f46e5',
    });
    await service.assignStoryToPhase({
      filename,
      storyId: 'US001',
      phaseId: phase.id,
    });

    const next = await service.getNextStory(filename);

    expect(next.story?.id).toBe('US001');
  });

  it('returns null when nothing is ready', async () => {
    const { filename, service } = await seed();

    for (const storyId of ['US001', 'US003']) {
      await service.updateStoryStatus({
        filename,
        storyId,
        status: 'in_progress',
      });
    }

    const next = await service.getNextStory(filename);

    expect(next.story).toBeNull();
    expect(next.in_progress).toEqual(['US001', 'US003']);
    expect(next.waiting.map((entry) => entry.id)).toEqual(['US002']);
  });
});

describe('story logs and context', () => {
  it('appends hand-off logs and returns them in the dependent story context', async () => {
    const { filename, service } = await seed();

    await service.addStoryLog({
      filename,
      storyId: 'US001',
      whatsNew: ['You can create a note from the sidebar'],
      technicalNotes: ['Notes table has RLS by account_id'],
    });
    await service.updateStoryStatus({
      filename,
      storyId: 'US001',
      status: 'completed',
    });

    const context = await service.getStory({ filename, storyId: 'US002' });

    expect(context.prd.non_goals).toEqual(['Rich text']);
    expect(context.dependencies).toEqual([
      {
        id: 'US001',
        title: expect.any(String),
        status: 'completed',
        log: [
          {
            at: '2026-10-14T10:00:00.000Z',
            whatsNew: ['You can create a note from the sidebar'],
            technicalNotes: ['Notes table has RLS by account_id'],
          },
        ],
      },
    ]);
    expect(context.previous_story?.id).toBe('US001');
  });

  it('stores deviations only when there are some', async () => {
    const { filename, service, read } = await seed();

    await service.addStoryLog({
      filename,
      storyId: 'US001',
      whatsNew: ['a'],
      technicalNotes: [],
      deviations: ['Used a modal instead of a page: the sidebar has no room'],
    });
    await service.addStoryLog({
      filename,
      storyId: 'US001',
      whatsNew: ['b'],
      technicalNotes: [],
      deviations: [],
    });

    const log = read().userStories.find((story) => story.id === 'US001')!.log!;

    expect(log[0]!.deviations).toEqual([
      'Used a modal instead of a page: the sidebar has no room',
    ]);
    expect(log[1]).not.toHaveProperty('deviations');
  });

  it('keeps earlier log entries', async () => {
    const { filename, service } = await seed();

    await service.addStoryLog({
      filename,
      storyId: 'US001',
      whatsNew: ['a'],
      technicalNotes: [],
    });
    const result = await service.addStoryLog({
      filename,
      storyId: 'US001',
      whatsNew: ['b'],
      technicalNotes: [],
    });

    expect(result.entries).toBe(2);
  });
});

describe('revision check', () => {
  it('increments the revision on every write', async () => {
    const { read } = await seed();

    // create + 3 stories + 1 update
    expect(read().metadata.revision).toBe(4);
  });

  it('rejects a write when the file changed after it was read', async () => {
    let interfere = false;
    const hooks: Hooks = {};
    const { filename, service, files, read } = await seed(hooks);

    hooks.beforeExists = (file) => {
      if (!interfere) return;
      interfere = false;

      // Another writer saves between our read and our write.
      const other = JSON.parse(files[file]!) as StructuredPRD;
      other.metadata.revision = (other.metadata.revision ?? 0) + 1;
      other.introduction.overview = 'Changed elsewhere';
      files[file] = JSON.stringify(other);
    };

    interfere = true;

    await expect(
      service.addStoryLog({
        filename,
        storyId: 'US001',
        whatsNew: ['x'],
        technicalNotes: [],
      }),
    ).rejects.toThrow(/changed by someone else/);

    expect(read().introduction.overview).toBe('Changed elsewhere');
    expect(read().userStories[0]?.log).toBeUndefined();
  });
});

describe('MCP registration', () => {
  it('registers the workflow tools and the implement_story prompt', async () => {
    const fake = createFakeMcpServer();
    const { files, filename } = await seed();

    registerPRDTools(fake.server, createPrdService(createDeps(files)));

    const next = await fake.call('get_next_story', { filename });
    expect(next.structuredContent).toMatchObject({ story: { id: 'US003' } });

    await fake.call('get_story', { filename, storyId: 'US002' });
    await fake.call('add_story_log', {
      filename,
      storyId: 'US001',
      whatsNew: ['x'],
    });

    const prompt = fake.prompts.find(
      (entry) => entry.name === 'implement_story',
    );
    const text = prompt!.handler({ filename }).messages[0]!.content.text;

    expect(text).toContain('get_next_story');
    expect(text).toContain('add_story_log');
    expect(text).toContain('deviations');
    expect(text).not.toContain('run_checks');

    const review = fake.prompts.find((entry) => entry.name === 'review_story');
    const reviewText = review!.handler({
      filename,
      storyId: 'US001',
      base: 'main',
    }).messages[0]!.content.text;

    expect(reviewText).toContain('git diff main');
    expect(reviewText).toContain('get_story');
    expect(reviewText).toMatch(/Do not change the story status/);
    expect(reviewText).toContain('deviations');
  });

  it('registers architect_prd, which records the design where story agents read it', async () => {
    const fake = createFakeMcpServer();
    const { files, filename } = await seed();

    registerPRDTools(fake.server, createPrdService(createDeps(files)));

    const prompt = fake.prompts.find((entry) => entry.name === 'architect_prd');
    const text = prompt!.handler({ filename }).messages[0]!.content.text;

    expect(text).toContain('check_plan');
    expect(text).toContain('architect skill');
    expect(text).toContain(
      `.prds/${filename.slice(0, -'.json'.length)}/architecture.md`,
    );
    expect(text).toContain('add_attachment');
    expect(text).toContain('"technicalContracts"');
    expect(text).toContain('add_decision with topic "architecture"');
    expect(text).toContain('testSeams');
    expect(text).toMatch(/Do not change story statuses/);
    expect(text).toContain('key the work and test seams by story id');
    expect(text).toContain('the deviations found in step 2');
    expect(text).toContain('"openQuestions" with the stories they block');

    expect(implementStoryPrompt(filename)).toMatch(
      /"Architecture" attachment is the contract/,
    );
    expect(shapePrdPrompt('A CRM')).toContain('architect_prd');
  });
});
