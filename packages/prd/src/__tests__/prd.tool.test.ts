import { describe, expect, it } from 'vitest';

import { registerPRDTools } from '../mcp';
import { type PrdDeps, createPrdService } from '../prd.service';
import { createFakeMcpServer } from '../testing/fake-mcp-server';

const normalize = (path: string) => path.replace(/\\/g, '/');
const basename = (path: string) => normalize(path).split('/').pop() ?? '';

function createDeps(files: Record<string, string> = {}): PrdDeps {
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
    now: () => new Date('2026-09-06T10:00:00Z'),
    verifyCompletion: async () => ({
      passed: true,
      checks: ['typecheck', 'lint'],
      errors: 0,
      warnings: 0,
      diagnostics: [],
      messages: [],
    }),
  };
}

const NEW_PRD = {
  title: 'Notes Feature',
  overview: 'Let members keep notes',
  problemStatement: 'Members have nowhere to record context',
  marketOpportunity: 'Table stakes for retention',
  targetUsers: ['Workspace members'],
  solutionDescription: 'A notes surface per account',
  keyFeatures: ['Create note', 'Share note'],
  successMetrics: ['50% of accounts create a note in week one'],
};

async function seed() {
  const fake = createFakeMcpServer();
  const files: Record<string, string> = {};

  registerPRDTools(fake.server, createPrdService(createDeps(files)));

  await fake.call('create_prd', NEW_PRD);
  await fake.call('add_user_story', {
    filename: 'notes-feature.json',
    userType: 'member',
    action: 'create a note',
    benefit: 'I can record context',
    acceptanceCriteria: ['Note saves', 'Note appears in the list'],
  });

  return { fake, files };
}

const read = (files: Record<string, string>) =>
  JSON.parse(files['notes-feature.json']!);

describe('registerPRDTools', () => {
  it('registers every tool with a description, annotations and an output schema', () => {
    const fake = createFakeMcpServer();

    registerPRDTools(fake.server, createPrdService(createDeps()));

    expect(fake.tools.map((tool) => tool.name).sort()).toEqual([
      'add_decision',
      'add_glossary_term',
      'add_story_log',
      'add_user_story',
      'assign_story_to_phase',
      'create_custom_phase',
      'create_prd',
      'delete_phase',
      'delete_prd',
      'delete_user_story',
      'export_prd_markdown',
      'get_implementation_prompts',
      'get_improvement_suggestions',
      'get_next_story',
      'get_prd',
      'get_project_status',
      'get_story',
      'list_prds',
      'reorder_phases',
      'resolve_open_question',
      'update_phase',
      'update_prd_section',
      'update_story_status',
      'update_user_story',
    ]);

    for (const tool of fake.tools) {
      expect(tool.config.description, tool.name).toBeTruthy();
      expect(tool.config.outputSchema, tool.name).toBeDefined();
      expect(tool.config.annotations, tool.name).toBeDefined();
    }
  });

  it('marks the two irreversible tools destructive', () => {
    const fake = createFakeMcpServer();

    registerPRDTools(fake.server, createPrdService(createDeps()));

    expect(fake.tool('delete_prd').config.annotations?.destructiveHint).toBe(
      true,
    );
    expect(
      fake.tool('delete_user_story').config.annotations?.destructiveHint,
    ).toBe(true);
  });

  it('round-trips a story edit through the tool boundary', async () => {
    const { fake, files } = await seed();

    const result = await fake.call('update_user_story', {
      filename: 'notes-feature.json',
      storyId: 'US001',
      title: 'Create a note',
      estimatedComplexity: 'L',
    });

    expect(result.structuredContent).toMatchObject({
      story_id: 'US001',
      title: 'Create a note',
      updated_fields: ['title', 'estimatedComplexity'],
    });
    expect(read(files).userStories[0].estimatedComplexity).toBe('L');
  });

  it('reissues no story id after a delete', async () => {
    const { fake, files } = await seed();

    await fake.call('add_user_story', {
      filename: 'notes-feature.json',
      userType: 'member',
      action: 'share a note',
      benefit: 'my team can read it',
      acceptanceCriteria: ['Share link works'],
    });

    await fake.call('delete_user_story', {
      filename: 'notes-feature.json',
      storyId: 'US002',
    });

    await fake.call('add_user_story', {
      filename: 'notes-feature.json',
      userType: 'member',
      action: 'archive a note',
      benefit: 'my list stays short',
      acceptanceCriteria: ['Archived notes hide'],
    });

    expect(
      read(files).userStories.map((story: { id: string }) => story.id),
    ).toEqual(['US001', 'US003']);
  });

  it('creates a phase and assigns a story to it', async () => {
    const { fake, files } = await seed();

    const phase = await fake.call('create_custom_phase', {
      filename: 'notes-feature.json',
      name: 'MVP',
    });

    expect(phase.structuredContent).toMatchObject({
      phase: { id: 'PHASE001', name: 'MVP', order: 0 },
      total_phases: 1,
    });

    await fake.call('assign_story_to_phase', {
      filename: 'notes-feature.json',
      storyId: 'US001',
      phaseId: 'PHASE001',
    });

    expect(read(files).customPhases[0].userStoryIds).toEqual(['US001']);
  });

  it('rejects a bad hex colour before touching the file', async () => {
    const { fake, files } = await seed();

    const result = await fake.call('create_custom_phase', {
      filename: 'notes-feature.json',
      name: 'MVP',
      color: 'blurple',
    });

    expect(result.isError).toBe(true);
    expect(read(files).customPhases).toEqual([]);
  });

  it('grows the change log instead of overwriting it', async () => {
    const { fake, files } = await seed();

    await fake.call('update_user_story', {
      filename: 'notes-feature.json',
      storyId: 'US001',
      priority: 'P0',
    });
    await fake.call('update_story_status', {
      filename: 'notes-feature.json',
      storyId: 'US001',
      status: 'in_progress',
    });

    expect(read(files).changeLog).toEqual([
      'Initial PRD created',
      '2026-09-06: Added US001 (Create A Note)',
      '2026-09-06: Updated US001 (priority)',
      '2026-09-06: US001 not_started -> in_progress',
    ]);
  });

  it('stamps lastValidatedAt only when verification actually ran', async () => {
    const { fake, files } = await seed();

    await fake.call('update_story_status', {
      filename: 'notes-feature.json',
      storyId: 'US001',
      status: 'in_progress',
    });

    expect(read(files).metadata.lastValidatedAt).toBe('2026-09-06');

    await fake.call('update_story_status', {
      filename: 'notes-feature.json',
      storyId: 'US001',
      status: 'completed',
    });

    expect(read(files).userStories[0].verification.passed).toBe(true);
  });

  it('honours an explicit title and complexity instead of guessing', async () => {
    const { fake, files } = await seed();

    await fake.call('add_user_story', {
      filename: 'notes-feature.json',
      userType: 'member',
      action: 'export every note as a zip archive for offline backup',
      benefit: 'I keep my own copy',
      acceptanceCriteria: ['Zip downloads'],
      title: 'Bulk note export',
      estimatedComplexity: 'XL',
    });

    const story = read(files).userStories[1];

    // Without the override this would be "Export Every Note As".
    expect(story.title).toBe('Bulk note export');
    expect(story.estimatedComplexity).toBe('XL');
  });
});
