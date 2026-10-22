import { describe, expect, it } from 'vitest';

import { registerPRDTools } from '../mcp';
import { type PrdDeps, createPrdService } from '../prd.service';
import { PRD_TEMPLATES, TEMPLATE_IDS } from '../templates';
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
      if (content === undefined) throw new Error('ENOENT');
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

const BASE = {
  title: 'Team notes',
  overview: 'Notes shared within a team',
  problemStatement: 'Context gets lost',
  marketOpportunity: 'Retention',
  targetUsers: ['Team members'],
  solutionDescription: 'Notes per team account',
  keyFeatures: ['Create note'],
  successMetrics: ['Notes created per team'],
};

describe('templates', () => {
  it('has one entry per id, each with interview focus questions', () => {
    expect(PRD_TEMPLATES.map((template) => template.id)).toEqual([
      ...TEMPLATE_IDS,
    ]);

    for (const template of PRD_TEMPLATES) {
      expect(template.interviewFocus.length).toBeGreaterThan(0);
    }
  });

  it('fills empty sections from the template', async () => {
    const files: Record<string, string> = {};
    const service = createPrdService(createDeps(files));

    const { filename } = await service.create({
      ...BASE,
      template: 'saas-feature',
    });
    const prd = JSON.parse(files[filename]!) as StructuredPRD;

    expect(prd.acceptanceCriteria.global.length).toBeGreaterThan(0);
    expect(prd.rolloutPlan.rolloutPhases.length).toBeGreaterThan(0);
    expect(prd.openQuestions.map((q) => q.question)).toContain(
      'Which roles can view, create, edit and delete it?',
    );
    expect(prd.changeLog[0]).toContain('saas-feature');
  });

  it('keeps values given by the caller and appends template questions', async () => {
    const files: Record<string, string> = {};
    const service = createPrdService(createDeps(files));

    const { filename } = await service.create({
      ...BASE,
      template: 'internal-tool',
      nonGoals: ['Mobile app'],
      openQuestions: ['Who approves notes?'],
    });
    const prd = JSON.parse(files[filename]!) as StructuredPRD;

    expect(prd.nonGoals).toEqual(['Mobile app']);
    expect(prd.openQuestions[0]).toEqual({
      id: 'Q001',
      question: 'Who approves notes?',
    });
    expect(prd.openQuestions.length).toBeGreaterThan(1);
  });

  it('is exposed through list_templates and create_prd, and shape_prd picks one', async () => {
    const fake = createFakeMcpServer();
    const files: Record<string, string> = {};

    registerPRDTools(fake.server, createPrdService(createDeps(files)));

    const listed = await fake.call('list_templates');
    expect(
      (
        listed.structuredContent as { templates: { id: string }[] }
      ).templates.map((t) => t.id),
    ).toEqual([...TEMPLATE_IDS]);

    const created = await fake.call('create_prd', {
      ...BASE,
      template: 'integration',
    });
    expect(created.isError).toBeFalsy();

    const invalid = await fake.call('create_prd', {
      ...BASE,
      title: 'Other',
      template: 'nope',
    });
    expect(invalid.isError).toBe(true);

    expect(
      (
        listed.structuredContent as {
          templates: { id: string; interview_focus: string[] }[];
        }
      ).templates.find((t) => t.id === 'integration')!.interview_focus,
    ).toContain('What does the user see while the service is unavailable?');

    const prompt = fake.prompts.find((entry) => entry.name === 'shape_prd')!;
    const text = prompt.handler({ overview: 'Stripe sync' }).messages[0]!
      .content.text;

    expect(text).toContain('list_templates');
    expect(text).toContain('interview_focus');
  });
});
