import { describe, expect, it } from 'vitest';

import { formatPrdMarkdown } from '../markdown';
import { registerPRDTools } from '../mcp';
import { type PrdDeps, createPrdService, normalizePrd } from '../prd.service';
import { implementStoryPrompt, shapePrdPrompt } from '../prompts';
import { createFakeMcpServer } from '../testing/fake-mcp-server';
import type { StructuredPRD } from '../types';

const normalize = (path: string) => path.replace(/\\/g, '/');

/** In-memory files keyed by their full path, so nested folders are real. */
function createDeps(files: Record<string, string>) {
  return {
    rootPath: '/repo',
    async readdir(path) {
      const prefix = `${normalize(path)}/`;

      return Object.keys(files)
        .filter((file) => file.startsWith(prefix))
        .map((file) => file.slice(prefix.length));
    },
    async readFile(path) {
      const content = files[normalize(path)];

      if (content === undefined) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }

      return content;
    },
    async writeFile(path, content) {
      files[normalize(path)] = content;
    },
    async mkdir() {},
    async unlink(path) {
      delete files[normalize(path)];
    },
    async fileExists(path) {
      return normalize(path) in files;
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
  } satisfies PrdDeps;
}

const STORY = {
  userType: 'member',
  benefit: 'it helps',
  acceptanceCriteria: ['works'],
  priority: 'P2' as const,
};

async function seed() {
  const files: Record<string, string> = {
    '/repo/.prds/notes/mockups/editor.png': 'png',
  };
  const service = createPrdService(createDeps(files));

  const { filename } = await service.create({
    title: 'Notes',
    overview: 'Let members keep notes',
    problemStatement: 'No place for context',
    marketOpportunity: 'Retention',
    targetUsers: ['Members'],
    solutionDescription: 'Notes per account',
    keyFeatures: ['Create note'],
    successMetrics: ['Notes created'],
  });

  await service.addUserStory({ ...STORY, filename, action: 'create a note' });
  await service.addUserStory({ ...STORY, filename, action: 'share a note' });

  const read = () =>
    JSON.parse(files[`/repo/.prds/${filename}`]!) as StructuredPRD;

  return { files, filename, service, read };
}

describe('attachments', () => {
  it('records a file in the PRD folder and links it to stories', async () => {
    const { filename, service, read } = await seed();

    expect(filename).toBe('notes.json');

    const result = await service.addAttachment({
      filename,
      title: 'Editor mockup',
      path: 'mockups/editor.png',
      note: 'Layout only',
      storyIds: ['US001'],
    });

    expect(result).toEqual({
      attachment_id: 'ATT001',
      path: '.prds/notes/mockups/editor.png',
      stories_updated: ['US001'],
      total_attachments: 1,
    });
    expect(read().attachments).toEqual([
      {
        id: 'ATT001',
        title: 'Editor mockup',
        path: 'mockups/editor.png',
        note: 'Layout only',
      },
    ]);
    expect(read().userStories[0]!.attachmentIds).toEqual(['ATT001']);
  });

  it('rejects files that are missing or outside the PRD folder', async () => {
    const { filename, service } = await seed();

    await expect(
      service.addAttachment({ filename, title: 'x', path: 'missing.png' }),
    ).rejects.toThrow(/not found\. Save it in \.prds\/notes\//);

    for (const path of [
      '../notes.json',
      'mockups/../../secret',
      '/etc/passwd',
      '.env',
      'mockups//editor.png',
      'mockups\\editor.png',
      'C:/editor.png',
    ]) {
      await expect(
        service.addAttachment({ filename, title: 'x', path }),
      ).rejects.toThrow(/Invalid attachment path/);
    }
  });

  it('takes either a path or a url, and only known stories', async () => {
    const { filename, service } = await seed();

    await expect(
      service.addAttachment({ filename, title: 'x' }),
    ).rejects.toThrow(/either path or url/);
    await expect(
      service.addAttachment({
        filename,
        title: 'x',
        path: 'mockups/editor.png',
        url: 'https://example.com',
      }),
    ).rejects.toThrow(/either path or url/);
    await expect(
      service.addAttachment({
        filename,
        title: 'x',
        url: 'https://example.com',
        storyIds: ['US999'],
      }),
    ).rejects.toThrow(/US999/);

    for (const url of ['javascript:alert(1)', 'file:///etc/passwd']) {
      await expect(
        service.addAttachment({ filename, title: 'x', url }),
      ).rejects.toThrow(/http:\/\/ or https:\/\//);
    }
  });

  it('returns story and PRD attachments from get_story', async () => {
    const { filename, service } = await seed();

    await service.addAttachment({
      filename,
      title: 'Editor mockup',
      path: 'mockups/editor.png',
      storyIds: ['US001'],
    });
    await service.addAttachment({
      filename,
      title: 'Brand guide',
      url: 'https://example.com/brand',
    });

    const context = await service.getStory({ filename, storyId: 'US001' });

    expect(context.attachments).toEqual([
      {
        id: 'ATT001',
        title: 'Editor mockup',
        path: '.prds/notes/mockups/editor.png',
      },
    ]);
    expect(context.prd.attachments.map((item) => item.id)).toEqual([
      'ATT001',
      'ATT002',
    ]);

    const other = await service.getStory({ filename, storyId: 'US002' });

    expect(other.attachments).toEqual([]);
    expect(other.prd.attachments).toHaveLength(2);
  });

  it('links attachments when adding or updating a story', async () => {
    const { filename, service, read } = await seed();

    await service.addAttachment({
      filename,
      title: 'Brand guide',
      url: 'https://example.com/brand',
    });
    await service.addUserStory({
      ...STORY,
      filename,
      action: 'pin a note',
      attachmentIds: ['ATT001'],
    });
    await service.updateUserStory({
      filename,
      storyId: 'US002',
      attachmentIds: ['ATT001', 'ATT001'],
    });

    expect(read().userStories.map((story) => story.attachmentIds)).toEqual([
      undefined,
      ['ATT001'],
      ['ATT001'],
    ]);
    await expect(
      service.updateUserStory({
        filename,
        storyId: 'US001',
        attachmentIds: ['ATT404'],
      }),
    ).rejects.toThrow(/Attachment "ATT404" not found/);
  });

  it('removes an attachment from every story and never reissues its id', async () => {
    const { filename, service, read } = await seed();

    await service.addAttachment({
      filename,
      title: 'Editor mockup',
      path: 'mockups/editor.png',
      storyIds: ['US001', 'US002'],
    });

    const removed = await service.removeAttachment({
      filename,
      attachmentId: 'ATT001',
    });

    expect(removed.stories_updated).toEqual(['US001', 'US002']);

    const added = await service.addAttachment({
      filename,
      title: 'Brand guide',
      url: 'https://example.com/brand',
    });

    expect(added.attachment_id).toBe('ATT002');
    expect(
      read().userStories.flatMap((story) => story.attachmentIds ?? []),
    ).toEqual([]);
  });

  it('does not reuse ids still linked from stories after an older writer dropped the list', async () => {
    const { files, filename, service } = await seed();

    await service.addAttachment({
      filename,
      title: 'Editor mockup',
      path: 'mockups/editor.png',
      storyIds: ['US001'],
    });

    // What a version without attachments leaves behind when it saves.
    const path = `/repo/.prds/${filename}`;
    const stale = JSON.parse(files[path]!);
    delete stale.attachments;
    delete stale.metadata.lastAttachmentNumber;
    files[path] = JSON.stringify(stale);

    const added = await service.addAttachment({
      filename,
      title: 'Brand guide',
      url: 'https://example.com/brand',
    });

    expect(added.attachment_id).toBe('ATT002');
  });

  it('lists attachments in the markdown export', async () => {
    const { filename, service, read } = await seed();

    await service.addAttachment({
      filename,
      title: 'Editor mockup',
      path: 'mockups/editor.png',
      note: 'Layout only',
      storyIds: ['US001'],
    });

    const markdown = formatPrdMarkdown(read(), filename);

    expect(markdown).toContain(
      '- ATT001: [Editor mockup](notes/mockups/editor.png) - Layout only',
    );
    expect(markdown).toContain('**Attachments:** ATT001');
  });

  it('keeps attachment titles and links from breaking the markdown', () => {
    const markdown = formatPrdMarkdown(
      normalizePrd(
        {
          attachments: [
            {
              id: 'ATT001',
              title: 'x](javascript:alert(1)) [y\n## Injected',
              url: 'https://example.com/a (b)',
            },
          ],
        },
        '2026-10-14',
      ),
      'notes.json',
    );

    expect(markdown).not.toContain('\n## Injected');
    expect(markdown).toContain(
      '- ATT001: [x\\](javascript:alert(1)) \\[y ## Injected](https://example.com/a%20%28b%29)',
    );
  });

  it('registers the attachment tools', async () => {
    const { filename, service } = await seed();
    const fake = createFakeMcpServer();

    registerPRDTools(fake.server, service);

    const added = await fake.call('add_attachment', {
      filename,
      title: 'Brand guide',
      url: 'https://example.com/brand',
      storyIds: ['US001'],
    });

    expect(added.isError).toBeFalsy();
    expect(added.structuredContent).toMatchObject({ attachment_id: 'ATT001' });

    const invalid = await fake.call('add_attachment', {
      filename,
      title: 'x',
      url: 'not a url',
    });

    expect(invalid.isError).toBe(true);

    const removed = await fake.call('remove_attachment', {
      filename,
      attachmentId: 'ATT001',
    });

    expect(removed.structuredContent).toMatchObject({
      stories_updated: ['US001'],
    });
  });
});

describe('prompts', () => {
  it('tells the agent to open a story’s attachments and to record them', () => {
    expect(implementStoryPrompt('notes.json', 'US001')).toMatch(
      /Open the files and links in its attachments/,
    );
    expect(shapePrdPrompt('A CRM')).toContain('add_attachment');
    expect(shapePrdPrompt('A CRM')).toContain('PRD text may use Markdown');
  });
});

describe('normalizePrd', () => {
  it('keeps fields it does not know, so newer files survive older writers', () => {
    const prd = normalizePrd(
      { introduction: { title: 'T' }, futureField: { keep: true } },
      '2026-10-14',
    );

    expect(prd.attachments).toEqual([]);
    expect(JSON.parse(JSON.stringify(prd)).futureField).toEqual({
      keep: true,
    });
  });

  it('drops hand-edited attachments that are malformed or escape the folder', () => {
    const prd = normalizePrd(
      {
        attachments: [
          { id: 'ATT001', title: 'Mockup', path: 'mockups/a.png' },
          {
            id: 'ATT002',
            title: 'Docs',
            url: 'https://example.com',
            note: null,
          },
          { id: 'ATT003', title: 'Broken', url: null },
          { id: 'ATT004', title: 'Escape', path: '../../../etc/passwd' },
          { id: 'ATT005', title: 'Script', url: 'javascript:alert(1)' },
          { id: 'ATT006', title: 'Both', path: 'a.png', url: 'https://x.y' },
          null,
          'ATT007',
        ],
      },
      '2026-10-14',
    );

    expect(prd.attachments).toEqual([
      { id: 'ATT001', title: 'Mockup', path: 'mockups/a.png' },
      { id: 'ATT002', title: 'Docs', url: 'https://example.com' },
    ]);
  });

  it('ignores files that are not an object, and a malformed attachment list', () => {
    expect(normalizePrd(['a', 'b'], '2026-10-14')).not.toHaveProperty('0');
    expect(
      normalizePrd({ attachments: 'x' }, '2026-10-14').attachments,
    ).toEqual([]);
  });
});
