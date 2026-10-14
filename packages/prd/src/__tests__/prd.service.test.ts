import { describe, expect, it } from 'vitest';

import {
  type PrdDeps,
  type PrdVerificationResult,
  createPrdService,
} from '../prd.service';

const normalize = (path: string) => path.replace(/\\/g, '/');

const PASSING: PrdVerificationResult = {
  passed: true,
  checks: ['typecheck', 'lint'],
  errors: 0,
  warnings: 0,
  diagnostics: [],
  messages: [],
};

const FAILING: PrdVerificationResult = {
  passed: false,
  checks: ['typecheck', 'lint'],
  errors: 2,
  warnings: 1,
  diagnostics: [
    {
      file: 'apps/web/app/page.tsx',
      line: 12,
      message: 'TS2322 boom',
      severity: 'error',
    },
    {
      file: 'packages/ui/x.ts',
      line: null,
      message: 'unused',
      severity: 'warning',
    },
  ],
  messages: [],
};

function createHarness(
  overrides: Partial<PrdDeps> = {},
  initialFiles: Record<string, string> = {},
) {
  const files: Record<string, string> = { ...initialFiles };
  const dirs = new Set<string>();

  const deps: PrdDeps = {
    rootPath: '/repo',
    async readdir() {
      return Object.keys(files);
    },
    async readFile(path) {
      const content = files[basename(path)];
      if (content === undefined) throw new Error('ENOENT');
      return content;
    },
    async writeFile(path, content) {
      files[basename(path)] = content;
    },
    async mkdir(path) {
      dirs.add(normalize(path));
    },
    async unlink(path) {
      if (!(basename(path) in files)) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      delete files[basename(path)];
    },
    async fileExists(path) {
      return basename(path) in files;
    },
    now: () => new Date('2026-09-06T10:00:00Z'),
    verifyCompletion: async () => PASSING,
    ...overrides,
  };

  return { service: createPrdService(deps), files, dirs };
}

function basename(path: string) {
  return normalize(path).split('/').pop() ?? '';
}

const BASE_INPUT = {
  title: 'Notes Feature',
  overview: 'Users keep notes',
  problemStatement: 'No notes',
  marketOpportunity: 'Everyone wants notes',
  targetUsers: ['makers'],
  solutionDescription: 'Add notes',
  keyFeatures: ['create', 'list'],
  successMetrics: ['10 notes/day'],
};

describe('PrdService.create / list / get / delete', () => {
  it('creates a PRD file named after the title and lists it', async () => {
    const { service, files, dirs } = createHarness();

    const created = await service.create(BASE_INPUT);

    expect(created.filename).toBe('notes-feature.json');
    expect(normalize(created.path)).toBe('/repo/.prds/notes-feature.json');
    expect(dirs.has('/repo/.prds')).toBe(true);
    expect(JSON.parse(files['notes-feature.json']!).metadata.created).toBe(
      '2026-09-06',
    );

    const list = await service.list();
    expect(list.total).toBe(1);
    expect(list.warnings).toEqual([]);
    expect(list.prds[0]).toMatchObject({
      filename: 'notes-feature.json',
      title: 'Notes Feature',
      progress: 0,
      total_stories: 0,
    });
  });

  it('refuses to overwrite an existing PRD with the same slug', async () => {
    const { service, files } = createHarness();
    await service.create(BASE_INPUT);
    files['notes-feature.json'] = JSON.stringify({
      introduction: { title: 'Keep me' },
    });

    await expect(
      service.create({ ...BASE_INPUT, title: 'notes   feature!' }),
    ).rejects.toThrow(/already exists/);

    expect(JSON.parse(files['notes-feature.json']!).introduction.title).toBe(
      'Keep me',
    );
  });

  it('reports malformed files as warnings when listing', async () => {
    const { service } = createHarness({}, { 'broken.json': '{not json' });

    const result = await service.list();

    expect(result.total).toBe(0);
    expect(result.warnings).toEqual([
      'Skipped broken.json: PRD file "broken.json" is not valid JSON',
    ]);
  });

  it('returns the normalised document from get', async () => {
    const { service } = createHarness(
      {},
      { 'old.json': '{"introduction":{"title":"Old"}}' },
    );

    const result = await service.get({ filename: 'old.json' });

    expect(result.prd.introduction).toEqual({
      title: 'Old',
      overview: '',
      lastUpdated: '2026-09-06',
    });
    expect(result.prd.customPhases).toEqual([]);
  });

  it.each(['../x.json', 'a/b.json', '.hidden.json'])(
    'rejects unsafe filename %j on every entry point',
    async (filename) => {
      const { service } = createHarness();

      await expect(service.get({ filename })).rejects.toThrow(
        /Invalid PRD file name/,
      );
      await expect(service.delete({ filename })).rejects.toThrow(
        /Invalid PRD file name/,
      );
      // load() is public and used by the dev tool with a URL segment.
      await expect(service.load(filename)).rejects.toThrow(
        /Invalid PRD file name/,
      );
    },
  );

  it('deletes a PRD, distinguishes missing files from other errors', async () => {
    const { service, files } = createHarness({
      async unlink(path) {
        if (basename(path) === 'locked.json') {
          throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
        }
        if (!(basename(path) in files)) {
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        }
        delete files[basename(path)];
      },
    });
    await service.create(BASE_INPUT);

    await service.delete({ filename: 'notes-feature.json' });
    expect(files['notes-feature.json']).toBeUndefined();

    await expect(
      service.delete({ filename: 'notes-feature.json' }),
    ).rejects.toThrow(/not found/);
    await expect(service.delete({ filename: 'locked.json' })).rejects.toThrow(
      /EACCES/,
    );
  });
});

describe('PrdService stories', () => {
  async function withStory(overrides: Partial<PrdDeps> = {}) {
    const harness = createHarness(overrides);
    await harness.service.create(BASE_INPUT);

    const story = await harness.service.addUserStory({
      filename: 'notes-feature.json',
      userType: 'member',
      action: 'create a note quickly',
      benefit: 'I remember things',
      acceptanceCriteria: ['form exists', 'note saved', 'list updates'],
      priority: 'P1',
    });

    return { ...harness, story };
  }

  it('adds a story with derived id, title and complexity', async () => {
    const { story, files } = await withStory();

    expect(story).toEqual({
      story_id: 'US001',
      title: 'Create A Note Quickly',
      complexity: 'S',
      total_stories: 1,
    });

    const prd = JSON.parse(files['notes-feature.json']!);
    expect(prd.userStories[0].userStory).toBe(
      'As a member, I want to create a note quickly so that I remember things',
    );
    expect(prd.progress.total).toBe(1);
  });

  it('moves a story to in_progress without running checks', async () => {
    let calls = 0;
    const { service } = await withStory({
      verifyCompletion: async () => {
        calls += 1;
        return PASSING;
      },
    });

    const result = await service.updateStoryStatus({
      filename: 'notes-feature.json',
      storyId: 'US001',
      status: 'in_progress',
      notes: 'started',
    });

    expect(calls).toBe(0);
    expect(result).toEqual({
      story_id: 'US001',
      title: 'Create A Note Quickly',
      status: 'in_progress',
      progress: 0,
      verification: null,
    });
  });

  it('refuses to complete a story when verification fails', async () => {
    const { service, files } = await withStory({
      verifyCompletion: async () => FAILING,
    });

    await expect(
      service.updateStoryStatus({
        filename: 'notes-feature.json',
        storyId: 'US001',
        status: 'completed',
      }),
    ).rejects.toThrow(
      /Cannot mark US001 as completed: verification failed \(2 errors, 1 warnings across typecheck, lint\)\. First diagnostics: apps\/web\/app\/page\.tsx:12 TS2322 boom/,
    );

    const prd = JSON.parse(files['notes-feature.json']!);
    expect(prd.userStories[0].status).toBe('not_started');
    expect(prd.progress.completed).toBe(0);
  });

  it('surfaces infrastructure failures that produced no diagnostics', async () => {
    const { service } = await withStory({
      verifyCompletion: async () => ({
        ...FAILING,
        errors: 0,
        warnings: 0,
        diagnostics: [],
        messages: ['typecheck: fail (spawn pnpm ENOENT)'],
      }),
    });

    await expect(
      service.updateStoryStatus({
        filename: 'notes-feature.json',
        storyId: 'US001',
        status: 'completed',
      }),
    ).rejects.toThrow(/typecheck: fail \(spawn pnpm ENOENT\)/);
  });

  it('completes a story and records verification when checks pass', async () => {
    const { service, files } = await withStory();

    const result = await service.updateStoryStatus({
      filename: 'notes-feature.json',
      storyId: 'US001',
      status: 'completed',
    });

    expect(result.status).toBe('completed');
    expect(result.progress).toBe(100);
    expect(result.verification).toEqual({
      verified_at: '2026-09-06T10:00:00.000Z',
      checks: ['typecheck', 'lint'],
      passed: true,
    });

    const prd = JSON.parse(files['notes-feature.json']!);
    expect(prd.userStories[0].completedAt).toBe('2026-09-06');
    expect(prd.userStories[0].verification.passed).toBe(true);
  });

  it('does not overwrite stories added while verification was running', async () => {
    let harness: ReturnType<typeof createHarness> | undefined;

    const deps: Partial<PrdDeps> = {
      async verifyCompletion() {
        // Simulate a concurrent add_user_story landing mid-verification.
        await harness!.service.addUserStory({
          filename: 'notes-feature.json',
          userType: 'admin',
          action: 'archive notes',
          benefit: 'tidy',
          acceptanceCriteria: ['works'],
          priority: 'P3',
        });

        return PASSING;
      },
    };

    harness = createHarness(deps);
    await harness.service.create(BASE_INPUT);
    await harness.service.addUserStory({
      filename: 'notes-feature.json',
      userType: 'member',
      action: 'create a note',
      benefit: 'memory',
      acceptanceCriteria: ['a', 'b'],
      priority: 'P1',
    });

    const result = await harness.service.updateStoryStatus({
      filename: 'notes-feature.json',
      storyId: 'US001',
      status: 'completed',
    });

    const prd = JSON.parse(harness.files['notes-feature.json']!);
    expect(prd.userStories).toHaveLength(2);
    expect(prd.userStories[0].status).toBe('completed');
    expect(prd.userStories[1].title).toBe('Archive Notes');
    expect(result.progress).toBe(50);
  });

  it('clears verification when a completed story is reopened', async () => {
    const { service, files } = await withStory();

    await service.updateStoryStatus({
      filename: 'notes-feature.json',
      storyId: 'US001',
      status: 'completed',
    });
    await service.updateStoryStatus({
      filename: 'notes-feature.json',
      storyId: 'US001',
      status: 'review',
    });

    const prd = JSON.parse(files['notes-feature.json']!);
    expect(prd.userStories[0].verification).toBeUndefined();
    expect(prd.userStories[0].completedAt).toBeUndefined();
    expect(prd.progress.completed).toBe(0);
  });

  it('throws for unknown stories before running checks', async () => {
    let calls = 0;
    const { service } = await withStory({
      verifyCompletion: async () => {
        calls += 1;
        return PASSING;
      },
    });

    await expect(
      service.updateStoryStatus({
        filename: 'notes-feature.json',
        storyId: 'US999',
        status: 'completed',
      }),
    ).rejects.toThrow(/Story US999 not found/);
    expect(calls).toBe(0);
  });
});

describe('PrdService reports', () => {
  it('exports markdown next to the JSON file', async () => {
    const { service, files } = createHarness();
    await service.create(BASE_INPUT);

    const result = await service.exportMarkdown({
      filename: 'notes-feature.json',
    });

    expect(result.markdown_file).toBe('notes-feature.md');
    expect(files['notes-feature.md']).toContain('# Notes Feature');
  });

  it('produces prompts, suggestions and status', async () => {
    const { service } = createHarness();
    await service.create(BASE_INPUT);

    expect(
      (await service.getImplementationPrompts('notes-feature.json')).total,
    ).toBe(0);

    await service.addUserStory({
      filename: 'notes-feature.json',
      userType: 'member',
      action: 'do x',
      benefit: 'y',
      acceptanceCriteria: ['one'],
      priority: 'P2',
    });

    const prompts =
      await service.getImplementationPrompts('notes-feature.json');
    expect(prompts.total).toBe(2);
    expect(prompts.prompts[1]).toMatch(/run_checks passes/);

    const suggestions =
      await service.getImprovementSuggestions('notes-feature.json');
    expect(suggestions.suggestions).toContain(
      '1 stories need more detailed acceptance criteria',
    );

    const status = await service.getProjectStatus('notes-feature.json');
    expect(status.next_steps).toEqual(['Start: Do X']);
    expect(status.blockers).toEqual([]);
  });
});
