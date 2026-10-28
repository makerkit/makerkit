import { normalizeNotApplicable, setNotApplicable } from './applicability';
import { attachmentsFolder, normalizeAttachments } from './attachment-paths';
import {
  addAttachment,
  removeAttachment,
  updateAttachment,
} from './attachments';
import { normalizeEdgeCases } from './edge-cases';
import { formatPrdMarkdown } from './markdown';
import { normalizeOpenQuestions } from './open-questions';
import { checkPlan } from './plan-check';
import {
  addDecision,
  addGlossaryTerm,
  assertLoggedDeviations,
  deletePhase,
  reorderPhases,
  decideEdgeCase,
  recordDeviations,
  resolveOpenQuestion,
  updatePhase,
  updatePrdSection,
} from './planning-operations';
import {
  appendChangeLog,
  appendStoryLog,
  assertCanEnterStatus,
  buildStoryContext,
  pickNextStory,
  assignStoryToPhase,
  createPhase,
  deleteStory,
  findStory,
  incompleteDependencies,
  recomputeProgress,
  nextStoryId,
  renderUserStory,
  updateStory,
  validateAttachmentIds,
  validateDependencies,
  validateProofs,
} from './prd-operations';
import { implementStoryPrompt } from './prompts';
import { assertSafeFileName, assertSafeRelativePath } from './safe-file-name';
import type {
  AddUserStoryInput,
  AddUserStoryOutput,
  CreatePrdInput,
  CreatePrdOutput,
  DeletePrdInput,
  DeletePrdOutput,
  ExportPrdMarkdownInput,
  ExportPrdMarkdownOutput,
  GetImplementationPromptsOutput,
  GetImprovementSuggestionsOutput,
  GetPrdInput,
  GetPrdOutput,
  GetProjectStatusOutput,
  ListPrdsOutput,
  PrdSummary,
  UpdateStoryStatusInput,
  UpdateStoryStatusOutput,
  UpdateUserStoryInput,
  UpdateUserStoryOutput,
  DeleteUserStoryInput,
  DeleteUserStoryOutput,
  CreateCustomPhaseInput,
  CreateCustomPhaseOutput,
  AssignStoryToPhaseInput,
  AssignStoryToPhaseOutput,
  AddStoryLogInput,
  AddStoryLogOutput,
  GetNextStoryOutput,
  GetStoryInput,
  GetStoryOutput,
  AddAttachmentInput,
  AddAttachmentOutput,
  RemoveAttachmentInput,
  RemoveAttachmentOutput,
  UpdateAttachmentInput,
  UpdateAttachmentOutput,
  CheckPlanOutput,
  ListTemplatesOutput,
  UpdatePrdSectionInput,
  UpdatePrdSectionOutput,
  AddDecisionInput,
  MarkNotApplicableInput,
  MarkNotApplicableOutput,
  AddDecisionOutput,
  DecideEdgeCaseInput,
  DecideEdgeCaseOutput,
  ResolveOpenQuestionInput,
  ResolveOpenQuestionOutput,
  AddGlossaryTermInput,
  AddGlossaryTermOutput,
  UpdatePhaseInput,
  DeletePhaseInput,
  ReorderPhasesInput,
  PhasesOutput,
} from './schema';
import { PRD_TEMPLATES, getTemplate } from './templates';
import type { StoryComplexity, StructuredPRD, UserStory } from './types';

import { join } from 'node:path';

export interface PrdVerificationDiagnostic {
  file: string;
  line: number | null;
  message: string;
  severity: string;
}

export interface PrdVerificationResult {
  passed: boolean;
  /** Scripts that ran, e.g. ['typecheck', 'lint']. */
  checks: string[];
  errors: number;
  warnings: number;
  diagnostics: PrdVerificationDiagnostic[];
  /** Human-readable reasons for checks that failed without diagnostics. */
  messages: string[];
}

export interface PrdDeps {
  rootPath: string;
  readdir(path: string): Promise<string[]>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  /** Must not throw when the directory already exists. */
  mkdir(path: string): Promise<void>;
  unlink(path: string): Promise<void>;
  fileExists(path: string): Promise<boolean>;
  now(): Date;
  /**
   * Runs the project's checks before a story may be marked completed. When
   * the result is not passing the status change is rejected, so "completed"
   * always means "the code verifies", not "the agent believes it is done".
   */
  verifyCompletion(): Promise<PrdVerificationResult>;
}

/**
 * A write was based on an older revision of the PRD than the one on disk:
 * someone else (an agent, Loop, another editor) changed it in between. Read
 * the PRD again and retry; never overwrite.
 */
export class PrdRevisionConflictError extends Error {
  readonly code = 'PRD_REVISION_CONFLICT';

  constructor(
    readonly filename: string,
    readonly expectedRevision: number,
    readonly currentRevision: number,
  ) {
    super(
      `PRD "${filename}" was changed by someone else since it was read ` +
        `(revision ${expectedRevision}, now ${currentRevision}). ` +
        'Read it again and retry.',
    );
    this.name = 'PrdRevisionConflictError';
  }
}

export function createPrdService(deps: PrdDeps) {
  return new PrdService(deps);
}

export class PrdService {
  constructor(private readonly deps: PrdDeps) {}

  get prdsDir() {
    return join(this.deps.rootPath, '.prds');
  }

  async list(): Promise<ListPrdsOutput> {
    const filenames = await this.listFilenames();
    const prds: PrdSummary[] = [];
    const warnings: string[] = [];

    for (const filename of filenames) {
      try {
        const prd = await this.load(filename);

        prds.push({
          filename,
          title: prd.introduction.title,
          last_updated: prd.metadata.lastUpdated,
          progress: prd.progress.overall,
          total_stories: prd.progress.total,
          completed_stories: prd.progress.completed,
          blocked_stories: prd.progress.blocked,
        });
      } catch (error) {
        warnings.push(
          `Skipped ${filename}: ${error instanceof Error ? error.message : 'unreadable'}`,
        );
      }
    }

    return { prds, total: prds.length, prds_dir: this.prdsDir, warnings };
  }

  async get(input: GetPrdInput): Promise<GetPrdOutput> {
    const filename = this.safeName(input.filename);
    const prd = await this.load(filename);

    return {
      filename,
      path: join(this.prdsDir, filename),
      prd,
    };
  }

  async create(input: CreatePrdInput): Promise<CreatePrdOutput> {
    await this.deps.mkdir(this.prdsDir);

    const filename = `${slugify(input.title)}.json`;
    const path = join(this.prdsDir, filename);

    if (await this.deps.fileExists(path)) {
      throw new Error(
        `A PRD named "${filename}" already exists. Use a different title or delete it first with delete_prd.`,
      );
    }

    const today = this.today();
    const defaults = input.template ? getTemplate(input.template).defaults : {};

    const prd: StructuredPRD = {
      introduction: {
        title: input.title,
        overview: input.overview,
        lastUpdated: today,
      },
      problemStatement: {
        problem: input.problemStatement,
        marketOpportunity: input.marketOpportunity,
        targetUsers: input.targetUsers,
      },
      solutionOverview: {
        description: input.solutionDescription,
        keyFeatures: input.keyFeatures,
        successMetrics: input.successMetrics,
      },
      nonGoals: input.nonGoals ?? defaults.nonGoals ?? [],
      outOfScope: input.outOfScope ?? defaults.outOfScope ?? [],
      assumptions: input.assumptions ?? [],
      openQuestions: normalizeOpenQuestions([
        ...(input.openQuestions ?? []),
        ...(defaults.openQuestions ?? []),
      ]),
      risks: [],
      dependencies: [],
      userStories: [],
      customPhases: [],
      storyTraceability: [],
      technicalRequirements: {
        constraints: defaults.technicalConstraints ?? [],
        integrationNeeds: [],
        complianceRequirements: [],
      },
      technicalContracts: {
        apis: [],
        dataModels: [],
        permissions: [],
        integrationBoundaries: [],
      },
      acceptanceCriteria: {
        global: defaults.globalAcceptanceCriteria ?? [],
        qualityStandards: defaults.qualityStandards ?? [],
      },
      constraints: { timeline: '', resources: [], nonNegotiables: [] },
      rolloutPlan: {
        featureFlags: [],
        migrationPlan: [],
        rolloutPhases: defaults.rolloutPhases ?? [],
        rollbackConditions: defaults.rollbackConditions ?? [],
      },
      measurementPlan: {
        events: [],
        dashboards: [],
        baselineMetrics: [],
        targetMetrics: [],
        guardrailMetrics: [],
      },
      edgeCases: [],
      designGuidance: [],
      securityConsiderations: [],
      notApplicable: {},
      decisionLog: [],
      glossary: [],
      attachments: [],
      agentTaskPackets: [],
      changeLog: [
        input.template
          ? `Initial PRD created from the ${input.template} template`
          : 'Initial PRD created',
      ],
      metadata: {
        version: '2.0',
        created: today,
        lastUpdated: today,
        lastValidatedAt: today,
        approver: '',
      },
      progress: { overall: 0, completed: 0, total: 0, blocked: 0 },
    };

    await this.deps.writeFile(path, JSON.stringify(prd, null, 2));

    return { status: 'success', filename, path };
  }

  async delete(input: DeletePrdInput): Promise<DeletePrdOutput> {
    const filename = this.safeName(input.filename);

    try {
      await this.deps.unlink(join(this.prdsDir, filename));
    } catch (error) {
      if (isErrnoCode(error, 'ENOENT')) {
        throw new Error(`PRD file "${filename}" not found`);
      }

      throw error;
    }

    return { status: 'success', filename };
  }

  async addUserStory(input: AddUserStoryInput): Promise<AddUserStoryOutput> {
    const filename = this.safeName(input.filename);
    const prd = await this.load(filename);

    const storyId = nextStoryId(prd);
    const title = input.title?.trim() || titleFromAction(input.action);
    const complexity =
      input.estimatedComplexity ?? assessComplexity(input.acceptanceCriteria);

    const acceptanceCriteria = input.acceptanceCriteria.filter(
      (entry) => entry.trim().length > 0,
    );

    prd.userStories.push({
      id: storyId,
      title,
      userStory: renderUserStory(input),
      businessValue: input.benefit,
      acceptanceCriteria,
      status: 'not_started',
      priority: input.priority,
      estimatedComplexity: complexity,
      dependencies: [],
      ...(input.testSeams?.length ? { testSeams: input.testSeams } : {}),
      ...(input.proofs?.length
        ? { proofs: validateProofs(acceptanceCriteria, input.proofs) }
        : {}),
      ...(input.designNotes?.length ? { designNotes: input.designNotes } : {}),
      ...(input.securityNotes?.length
        ? { securityNotes: input.securityNotes }
        : {}),
    });

    // Validated against the in-memory PRD; a bad id throws before anything is saved.
    if (input.dependencies?.length) {
      findStory(prd, storyId).dependencies = validateDependencies(
        prd,
        storyId,
        input.dependencies,
      );
    }

    if (input.attachmentIds?.length) {
      findStory(prd, storyId).attachmentIds = validateAttachmentIds(
        prd,
        input.attachmentIds,
      );
    }

    if (input.phaseId) {
      assignStoryToPhase(
        prd,
        { filename, storyId, phaseId: input.phaseId },
        this.today(),
      );
    }

    recomputeProgress(prd);
    appendChangeLog(prd, `Added ${storyId} (${title})`, this.today());
    await this.save(filename, prd);

    return {
      story_id: storyId,
      title,
      complexity,
      total_stories: prd.userStories.length,
    };
  }

  async updateUserStory(
    input: UpdateUserStoryInput,
  ): Promise<UpdateUserStoryOutput> {
    return this.mutate(
      input.filename,
      (prd) => updateStory(prd, input, this.today()),
      input.expectedRevision,
    );
  }

  async deleteUserStory(
    input: DeleteUserStoryInput,
  ): Promise<DeleteUserStoryOutput> {
    const filename = this.safeName(input.filename);
    const prd = await this.load(filename);
    const result = deleteStory(prd, input.storyId, this.today());

    await this.save(filename, prd);

    return result;
  }

  async createCustomPhase(
    input: CreateCustomPhaseInput,
  ): Promise<CreateCustomPhaseOutput> {
    const filename = this.safeName(input.filename);
    const prd = await this.load(filename);
    const result = createPhase(prd, input, this.today());

    await this.save(filename, prd);

    return result;
  }

  async assignStoryToPhase(
    input: AssignStoryToPhaseInput,
  ): Promise<AssignStoryToPhaseOutput> {
    const filename = this.safeName(input.filename);
    const prd = await this.load(filename);
    const result = assignStoryToPhase(prd, input, this.today());

    await this.save(filename, prd);

    return result;
  }

  async updateStoryStatus(
    input: UpdateStoryStatusInput,
  ): Promise<UpdateStoryStatusOutput> {
    const filename = this.safeName(input.filename);

    // Validate the target and the workflow before paying for verification.
    const current = await this.load(filename);
    const currentRevision = current.metadata.revision ?? 0;

    // Checked against what the caller saw, before the (slow) checks: edits
    // made while the checks run, e.g. an agent's log entry, are expected.
    if (
      input.expectedRevision !== undefined &&
      input.expectedRevision !== currentRevision
    ) {
      throw new PrdRevisionConflictError(
        filename,
        input.expectedRevision,
        currentRevision,
      );
    }

    assertCanEnterStatus(
      current,
      findStory(current, input.storyId),
      input.status,
    );

    if (input.recordDeviations?.length) {
      if (input.status !== 'completed') {
        throw new Error(
          'Deviations are recorded only when a story is completed.',
        );
      }

      assertLoggedDeviations(
        findStory(current, input.storyId),
        input.recordDeviations,
      );
    }

    let verification: UpdateStoryStatusOutput['verification'] = null;

    if (input.status === 'completed') {
      const result = await this.deps.verifyCompletion();

      if (!result.passed) {
        throw new Error(buildVerificationFailure(input.storyId, result));
      }

      verification = {
        verified_at: this.deps.now().toISOString(),
        checks: result.checks,
        passed: true,
      };
    }

    // Verification can take minutes: reload so concurrent edits made in the
    // meantime are not overwritten by a stale snapshot.
    const prd = await this.load(filename);
    const story = findStory(prd, input.storyId);
    assertCanEnterStatus(prd, story, input.status);

    const previousStatus = story.status;

    if (verification) {
      story.verification = {
        verifiedAt: verification.verified_at,
        checks: verification.checks,
        passed: true,
      };
      story.completedAt = this.today();

      // The one moment the project is known to build and lint clean.
      prd.metadata.lastValidatedAt = this.today();
    } else {
      delete story.verification;
      delete story.completedAt;
    }

    story.status = input.status;

    const recordedDecisions = input.recordDeviations?.length
      ? recordDeviations(prd, story, input.recordDeviations, this.today())
      : [];

    if (input.notes) {
      story.notes = input.notes;
    }

    recomputeProgress(prd);
    appendChangeLog(
      prd,
      `${story.id} ${previousStatus} -> ${story.status}`,
      this.today(),
    );
    await this.save(filename, prd);

    return {
      story_id: story.id,
      title: story.title,
      status: story.status,
      progress: prd.progress.overall,
      verification,
      recorded_decisions: recordedDecisions,
    };
  }

  async exportMarkdown(
    input: ExportPrdMarkdownInput,
  ): Promise<ExportPrdMarkdownOutput> {
    const filename = this.safeName(input.filename);
    const prd = await this.load(filename);

    const markdownFile = filename.replace(/\.json$/, '.md');
    const path = join(this.prdsDir, markdownFile);

    await this.deps.writeFile(path, formatPrdMarkdown(prd, filename));

    return { markdown_file: markdownFile, path };
  }

  async getImplementationPrompts(
    filename: string,
  ): Promise<GetImplementationPromptsOutput> {
    const name = this.safeName(filename);
    const prd = await this.load(name);
    const prompts: string[] = [];

    // Only stories that can start now: the prompt sets them in progress.
    for (const story of prd.userStories
      .filter(
        (s) =>
          s.status === 'not_started' &&
          incompleteDependencies(prd, s).length === 0,
      )
      .slice(0, 3)) {
      prompts.push(implementStoryPrompt(name, story.id));
    }

    return { prompts, total: prompts.length };
  }

  async getImprovementSuggestions(
    filename: string,
  ): Promise<GetImprovementSuggestionsOutput> {
    const suggestions = (await this.checkPlan(filename)).items.map(
      (item) => item.message,
    );

    return { suggestions, total: suggestions.length };
  }

  listTemplates(): ListTemplatesOutput {
    return {
      templates: PRD_TEMPLATES.map((template) => ({
        id: template.id,
        name: template.name,
        description: template.description,
        when_to_use: template.whenToUse,
        interview_focus: template.interviewFocus,
      })),
    };
  }

  async checkPlan(filename: string): Promise<CheckPlanOutput> {
    return checkPlan(await this.load(this.safeName(filename)));
  }

  async getProjectStatus(filename: string): Promise<GetProjectStatusOutput> {
    const prd = await this.load(this.safeName(filename));

    const blockers = prd.userStories.filter((s) => s.status === 'blocked');
    const inProgress = prd.userStories.filter(
      (s) => s.status === 'in_progress',
    );
    const nextPending = prd.userStories
      .filter((s) => s.status === 'not_started')
      .slice(0, 3);
    const highRisks = prd.risks.filter((risk) => risk.severity === 'high');

    return {
      progress: prd.progress.overall,
      summary: `${prd.progress.completed}/${prd.progress.total} stories completed (${prd.progress.overall}%). Open questions: ${prd.openQuestions.length}. High risks: ${highRisks.length}.`,
      next_steps: [
        ...inProgress.map((s) => `Continue: ${s.title}`),
        ...nextPending.map((s) => `Start: ${s.title}`),
      ],
      blockers: blockers.map((s) => ({
        id: s.id,
        title: s.title,
        notes: s.notes ?? null,
      })),
      open_questions: prd.openQuestions.map((question) => question.question),
      high_risks: highRisks.map(({ id, description, mitigation, owner }) => ({
        id,
        description,
        mitigation,
        owner,
      })),
    };
  }

  // Planning ----------------------------------------------------------------

  updatePrdSection(
    input: UpdatePrdSectionInput,
  ): Promise<UpdatePrdSectionOutput> {
    return this.mutate(
      input.filename,
      (prd) => updatePrdSection(prd, input, this.today()),
      input.expectedRevision,
    );
  }

  /** Mark a part of the PRD (not) applicable, e.g. no rollout for an internal tool. */
  markNotApplicable(
    input: MarkNotApplicableInput,
  ): Promise<MarkNotApplicableOutput> {
    return this.mutate(
      input.filename,
      (prd) => setNotApplicable(prd, input, this.today()),
      input.expectedRevision,
    );
  }

  addDecision(input: AddDecisionInput): Promise<AddDecisionOutput> {
    return this.mutate(input.filename, (prd) =>
      addDecision(prd, input, this.today()),
    );
  }

  resolveOpenQuestion(
    input: ResolveOpenQuestionInput,
  ): Promise<ResolveOpenQuestionOutput> {
    return this.mutate(
      input.filename,
      (prd) => resolveOpenQuestion(prd, input, this.today()),
      input.expectedRevision,
    );
  }

  decideEdgeCase(input: DecideEdgeCaseInput): Promise<DecideEdgeCaseOutput> {
    return this.mutate(
      input.filename,
      (prd) => decideEdgeCase(prd, input, this.today()),
      input.expectedRevision,
    );
  }

  addGlossaryTerm(input: AddGlossaryTermInput): Promise<AddGlossaryTermOutput> {
    return this.mutate(input.filename, (prd) =>
      addGlossaryTerm(prd, input, this.today()),
    );
  }

  updatePhase(input: UpdatePhaseInput): Promise<PhasesOutput> {
    return this.mutate(input.filename, (prd) =>
      updatePhase(prd, input, this.today()),
    );
  }

  deletePhase(input: DeletePhaseInput): Promise<PhasesOutput> {
    return this.mutate(input.filename, (prd) =>
      deletePhase(prd, input, this.today()),
    );
  }

  reorderPhases(input: ReorderPhasesInput): Promise<PhasesOutput> {
    return this.mutate(input.filename, (prd) =>
      reorderPhases(prd, input, this.today()),
    );
  }

  // Agent workflow ----------------------------------------------------------

  async getNextStory(filename: string): Promise<GetNextStoryOutput> {
    return pickNextStory(await this.load(this.safeName(filename)));
  }

  async getStory(input: GetStoryInput): Promise<GetStoryOutput> {
    const filename = this.safeName(input.filename);
    const prd = await this.load(filename);

    return buildStoryContext(prd, input.storyId, filename);
  }

  async addStoryLog(input: AddStoryLogInput): Promise<AddStoryLogOutput> {
    const filename = this.safeName(input.filename);
    const prd = await this.load(filename);

    const result = appendStoryLog(prd, input.storyId, {
      at: this.deps.now().toISOString(),
      whatsNew: input.whatsNew,
      technicalNotes: input.technicalNotes,
      ...(input.deviations?.length && { deviations: input.deviations }),
    });

    appendChangeLog(prd, `Logged work on ${result.story_id}`, this.today());
    await this.save(filename, prd);

    return result;
  }

  // Attachments -------------------------------------------------------------

  /** Files must already be in the PRD's folder, `.prds/<prd name>/`. */
  async addAttachment(input: AddAttachmentInput): Promise<AddAttachmentOutput> {
    const filename = this.safeName(input.filename);

    if (input.path) {
      const folder = attachmentsFolder(filename);
      const path = assertSafeRelativePath(input.path, 'attachment path');

      if (!(await this.deps.fileExists(join(this.prdsDir, folder, path)))) {
        throw new Error(
          `File ".prds/${folder}/${path}" not found. Save it in .prds/${folder}/ first.`,
        );
      }
    }

    return this.mutate(
      filename,
      (prd) => addAttachment(prd, { ...input, filename }, this.today()),
      input.expectedRevision,
    );
  }

  /** Changes an attachment's title, note or the stories that use it. */
  updateAttachment(
    input: UpdateAttachmentInput,
  ): Promise<UpdateAttachmentOutput> {
    return this.mutate(
      input.filename,
      (prd) => updateAttachment(prd, input, this.today()),
      input.expectedRevision,
    );
  }

  /** Removes the attachment from the PRD and its stories; the file stays. */
  async removeAttachment(
    input: RemoveAttachmentInput,
  ): Promise<RemoveAttachmentOutput> {
    return this.mutate(
      input.filename,
      (prd) => removeAttachment(prd, input.attachmentId, this.today()),
      input.expectedRevision,
    );
  }

  // Persistence -------------------------------------------------------------

  /** Load → transform → save for operations that only touch the PRD. */
  /**
   * Load, change and save a PRD. With `expectedRevision` (the revision the
   * caller's change is based on, e.g. what a person saw before editing), the
   * change is rejected when the PRD has moved on since.
   */
  private async mutate<T>(
    filename: string,
    transform: (prd: StructuredPRD) => T,
    expectedRevision?: number,
  ): Promise<T> {
    const name = this.safeName(filename);
    const prd = await this.load(name);
    const currentRevision = prd.metadata.revision ?? 0;

    if (
      expectedRevision !== undefined &&
      expectedRevision !== currentRevision
    ) {
      throw new PrdRevisionConflictError(
        name,
        expectedRevision,
        currentRevision,
      );
    }

    const result = transform(prd);

    await this.save(name, prd);

    return result;
  }

  /**
   * Load and normalise a PRD. The file name is validated here, at the
   * filesystem boundary, so every caller (including the dev tool) is covered.
   */
  async load(filename: string): Promise<StructuredPRD> {
    const name = this.safeName(filename);
    let raw: string;

    try {
      raw = await this.deps.readFile(join(this.prdsDir, name));
    } catch {
      throw new Error(`PRD file "${name}" not found`);
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`PRD file "${name}" is not valid JSON`);
    }

    return normalizePrd(parsed, this.today());
  }

  private async save(filename: string, prd: StructuredPRD) {
    const today = this.today();
    const path = join(this.prdsDir, filename);
    const loadedRevision = prd.metadata.revision ?? 0;

    if (await this.deps.fileExists(path)) {
      const onDisk = await this.load(filename);

      if ((onDisk.metadata.revision ?? 0) !== loadedRevision) {
        throw new PrdRevisionConflictError(
          filename,
          loadedRevision,
          onDisk.metadata.revision ?? 0,
        );
      }
    }

    prd.metadata.revision = loadedRevision + 1;

    prd.metadata.lastUpdated = today;
    prd.introduction.lastUpdated = today;

    // Callers append their own change-log entry describing what they did. The
    // previous `if (changeLog.length === 0)` guard meant the log never grew
    // past the line `create` seeded, so a PRD's history was always one entry.

    await this.deps.writeFile(path, JSON.stringify(prd, null, 2));
  }

  private async listFilenames() {
    await this.deps.mkdir(this.prdsDir);

    try {
      return (await this.deps.readdir(this.prdsDir))
        .filter((file) => file.endsWith('.json'))
        .sort();
    } catch {
      return [];
    }
  }

  private safeName(filename: string) {
    return assertSafeFileName(filename, 'PRD file name');
  }

  private today() {
    return this.deps.now().toISOString().slice(0, 10);
  }
}

function buildVerificationFailure(
  storyId: string,
  result: PrdVerificationResult,
) {
  const sample = result.diagnostics
    .slice(0, 5)
    .map((d) => `${d.file}${d.line ? `:${d.line}` : ''} ${d.message}`)
    .join('; ');

  const reasons = [
    sample ? `First diagnostics: ${sample}.` : '',
    ...result.messages,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    `Cannot mark ${storyId} as completed: verification failed ` +
    `(${result.errors} errors, ${result.warnings} warnings across ${result.checks.join(', ') || 'no checks'}). ` +
    (reasons ? `${reasons} ` : '') +
    'Fix the issues, run the project checks, then retry.'
  );
}

function isErrnoCode(error: unknown, code: string) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

export function normalizePrd(input: unknown, today: string): StructuredPRD {
  const prd = (isPlainObject(input) ? input : {}) as Partial<StructuredPRD>;
  const openQuestions = normalizeOpenQuestions(prd.openQuestions);
  // Ids given to questions from older files must never be handed out again
  const highestQuestion = openQuestions.reduce(
    (max, question) =>
      Math.max(max, Number(/^Q(\d+)$/.exec(question.id)?.[1] ?? 0)),
    0,
  );

  return {
    // Keep top-level fields this version does not know, so a file written by
    // a newer version keeps them when this one saves it. Known sections below
    // are rebuilt, so unknown keys inside them are not kept.
    ...prd,
    introduction: {
      title: prd.introduction?.title ?? 'Untitled PRD',
      overview: prd.introduction?.overview ?? '',
      lastUpdated: prd.introduction?.lastUpdated ?? today,
    },
    problemStatement: {
      problem: prd.problemStatement?.problem ?? '',
      marketOpportunity: prd.problemStatement?.marketOpportunity ?? '',
      targetUsers: prd.problemStatement?.targetUsers ?? [],
    },
    solutionOverview: {
      description: prd.solutionOverview?.description ?? '',
      keyFeatures: prd.solutionOverview?.keyFeatures ?? [],
      successMetrics: prd.solutionOverview?.successMetrics ?? [],
    },
    nonGoals: prd.nonGoals ?? [],
    outOfScope: prd.outOfScope ?? [],
    assumptions: prd.assumptions ?? [],
    openQuestions,
    risks: prd.risks ?? [],
    dependencies: prd.dependencies ?? [],
    userStories: prd.userStories ?? [],
    customPhases: prd.customPhases ?? [],
    storyTraceability: prd.storyTraceability ?? [],
    technicalRequirements: {
      constraints: prd.technicalRequirements?.constraints ?? [],
      integrationNeeds: prd.technicalRequirements?.integrationNeeds ?? [],
      complianceRequirements:
        prd.technicalRequirements?.complianceRequirements ?? [],
    },
    technicalContracts: {
      apis: prd.technicalContracts?.apis ?? [],
      dataModels: prd.technicalContracts?.dataModels ?? [],
      permissions: prd.technicalContracts?.permissions ?? [],
      integrationBoundaries:
        prd.technicalContracts?.integrationBoundaries ?? [],
    },
    acceptanceCriteria: {
      global: prd.acceptanceCriteria?.global ?? [],
      qualityStandards: prd.acceptanceCriteria?.qualityStandards ?? [],
    },
    constraints: {
      timeline: prd.constraints?.timeline ?? '',
      budget: prd.constraints?.budget,
      resources: prd.constraints?.resources ?? [],
      nonNegotiables: prd.constraints?.nonNegotiables ?? [],
    },
    rolloutPlan: {
      featureFlags: prd.rolloutPlan?.featureFlags ?? [],
      migrationPlan: prd.rolloutPlan?.migrationPlan ?? [],
      rolloutPhases: prd.rolloutPlan?.rolloutPhases ?? [],
      rollbackConditions: prd.rolloutPlan?.rollbackConditions ?? [],
    },
    measurementPlan: {
      events: prd.measurementPlan?.events ?? [],
      dashboards: prd.measurementPlan?.dashboards ?? [],
      baselineMetrics: prd.measurementPlan?.baselineMetrics ?? [],
      targetMetrics: prd.measurementPlan?.targetMetrics ?? [],
      guardrailMetrics: prd.measurementPlan?.guardrailMetrics ?? [],
    },
    edgeCases: normalizeEdgeCases(prd.edgeCases),
    securityConsiderations: Array.isArray(prd.securityConsiderations)
      ? prd.securityConsiderations.filter(
          (item): item is string => typeof item === 'string',
        )
      : [],
    notApplicable: normalizeNotApplicable(prd.notApplicable),
    designGuidance: Array.isArray(prd.designGuidance)
      ? prd.designGuidance.filter(
          (item): item is string => typeof item === 'string',
        )
      : [],
    decisionLog: prd.decisionLog ?? [],
    glossary: prd.glossary ?? [],
    attachments: normalizeAttachments(prd.attachments),
    agentTaskPackets: prd.agentTaskPackets ?? [],
    changeLog: prd.changeLog ?? [],
    metadata: {
      version: prd.metadata?.version ?? '2.0',
      created: prd.metadata?.created ?? today,
      lastUpdated: prd.metadata?.lastUpdated ?? today,
      lastValidatedAt: prd.metadata?.lastValidatedAt ?? today,
      approver: prd.metadata?.approver ?? '',
      lastStoryNumber: prd.metadata?.lastStoryNumber,
      lastAttachmentNumber: prd.metadata?.lastAttachmentNumber,
      lastQuestionNumber:
        Math.max(prd.metadata?.lastQuestionNumber ?? 0, highestQuestion) ||
        undefined,
      revision: prd.metadata?.revision,
    },
    progress: {
      overall: prd.progress?.overall ?? 0,
      completed: prd.progress?.completed ?? 0,
      total: prd.progress?.total ?? 0,
      blocked: prd.progress?.blocked ?? 0,
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'untitled-prd';
}

function titleFromAction(action: string) {
  return action
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .slice(0, 4)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function assessComplexity(criteria: string[]): StoryComplexity {
  const count = criteria.length;

  if (count <= 2) return 'XS';
  if (count <= 3) return 'S';
  if (count <= 5) return 'M';
  if (count <= 8) return 'L';

  return 'XL';
}

export type { StructuredPRD, UserStory };
