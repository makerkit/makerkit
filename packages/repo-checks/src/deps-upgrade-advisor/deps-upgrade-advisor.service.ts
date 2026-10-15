import type {
  DepsUpgradeAdvisorInput,
  DepsUpgradeAdvisorOutput,
  DepsUpgradeRecommendation,
} from './schema';

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface OutdatedDependency {
  package: string;
  workspace: string;
  dependencyType: string;
  current: string;
  wanted: string;
  latest: string;
}

export interface DepsUpgradeAdvisorDeps {
  executeCommand(command: string, args: string[]): Promise<CommandResult>;
  nowIso(): string;
  /** The project's package manager. Only pnpm is supported so far. */
  packageManager?: string;
}

export function createDepsUpgradeAdvisorService(deps: DepsUpgradeAdvisorDeps) {
  return new DepsUpgradeAdvisorService(deps);
}

export class DepsUpgradeAdvisorService {
  constructor(private readonly deps: DepsUpgradeAdvisorDeps) {}

  async advise(
    input: DepsUpgradeAdvisorInput,
  ): Promise<DepsUpgradeAdvisorOutput> {
    const packageManager = this.deps.packageManager ?? 'pnpm';

    if (packageManager !== 'pnpm') {
      throw new Error(
        `The upgrade advisor supports pnpm projects only; this project uses ${packageManager}.`,
      );
    }

    const includeMajor = input.state?.includeMajor ?? false;
    const maxPackages = input.state?.maxPackages ?? 50;
    const includeDevDependencies = input.state?.includeDevDependencies ?? true;
    const warnings: string[] = [];

    const outdated = await this.getOutdatedDependencies(warnings);

    const filtered = mergeDuplicateRows(
      outdated.filter((item) => {
        if (includeDevDependencies) {
          return true;
        }

        return !item.dependencyType.toLowerCase().includes('dev');
      }),
    );

    const recommendations = filtered
      .map((item) => toRecommendation(item, includeMajor))
      .sort(sortRecommendations)
      .slice(0, maxPackages);

    const major = recommendations.filter(
      (item) => item.update_type === 'major',
    );
    const safe = recommendations.filter((item) => item.update_type !== 'major');

    if (!includeMajor && major.length > 0) {
      warnings.push(
        `${major.length} major upgrades were excluded from immediate recommendations. Re-run with includeMajor=true to include them.`,
      );
    }

    return {
      generated_at: this.deps.nowIso(),
      summary: {
        total_outdated: filtered.length,
        recommended_now: recommendations.filter((item) =>
          includeMajor ? true : item.update_type !== 'major',
        ).length,
        major_available: filtered
          .map((item) => toRecommendation(item, true))
          .filter((item) => item.update_type === 'major').length,
        minor_or_patch_available: filtered
          .map((item) => toRecommendation(item, true))
          .filter(
            (item) =>
              item.update_type === 'minor' || item.update_type === 'patch',
          ).length,
      },
      recommendations,
      grouped_commands: {
        safe_batch_command: buildBatchCommand(safe),
        major_batch_command: includeMajor ? buildBatchCommand(major) : null,
      },
      warnings,
    };
  }

  private async getOutdatedDependencies(warnings: string[]) {
    const attempts: string[][] = [
      ['outdated', '--recursive', '--format', 'json'],
      ['outdated', '--recursive', '--json'],
    ];

    let lastError: Error | null = null;

    for (const args of attempts) {
      const result = await this.deps.executeCommand('pnpm', args);

      if (!result.stdout.trim()) {
        if (result.exitCode === 0) {
          return [] as OutdatedDependency[];
        }

        warnings.push(
          `pnpm ${args.join(' ')} returned no JSON output (exit code ${result.exitCode}).`,
        );
        lastError = new Error(result.stderr || 'Missing command output');
        continue;
      }

      try {
        return normalizeOutdatedJson(JSON.parse(result.stdout));
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Invalid JSON');
      }
    }

    throw lastError ?? new Error('Unable to retrieve outdated dependencies');
  }
}

function toRecommendation(
  dependency: OutdatedDependency,
  includeMajor: boolean,
): DepsUpgradeRecommendation {
  const updateType = getUpdateType(dependency.current, dependency.latest);
  const risk =
    updateType === 'major' ? 'high' : updateType === 'minor' ? 'medium' : 'low';
  const target =
    updateType === 'major' && !includeMajor
      ? dependency.wanted
      : dependency.latest;

  return {
    package: dependency.package,
    workspace: dependency.workspace,
    dependency_type: dependency.dependencyType,
    current: dependency.current,
    wanted: dependency.wanted,
    latest: dependency.latest,
    update_type: updateType,
    risk,
    potentially_breaking: updateType === 'major',
    recommended_target: target,
    recommended_command: buildUpgradeCommand(
      dependency.workspace,
      `${dependency.package}@${target}`,
    ),
    reason:
      updateType === 'major' && !includeMajor
        ? 'Major version available and potentially breaking; recommended target is the highest non-major range match.'
        : `Recommended ${updateType} update based on current vs latest version.`,
  };
}

function normalizeOutdatedJson(value: unknown): OutdatedDependency[] {
  if (Array.isArray(value)) {
    return value.map(normalizeOutdatedItem).filter((item) => item !== null);
  }

  if (isRecord(value)) {
    const rows: OutdatedDependency[] = [];

    for (const [key, data] of Object.entries(value)) {
      if (!isRecord(data)) {
        continue;
      }

      // pnpm prints a flat { [package]: info } object, with the workspaces
      // that depend on it in info.dependentPackages.
      if (readString(data, 'current')) {
        const row = toOutdatedRow(
          stripPnpmKeySuffix(key),
          readDependentNames(data),
          data,
        );

        if (row) {
          rows.push(row);
        }

        continue;
      }

      // Older shape: { [workspace]: { [package]: info } }.
      for (const [name, info] of Object.entries(data)) {
        if (!isRecord(info)) {
          continue;
        }

        const row = toOutdatedRow(name, key, info);

        if (row) {
          rows.push(row);
        }
      }
    }

    return rows;
  }

  return [];
}

/**
 * pnpm lists a package once per dependency type ("pkg@1.0.0" and
 * "pkg@1.0.0 (dev)"). Count it once: join the workspaces and keep the
 * production type, so the summary does not double-count.
 */
function mergeDuplicateRows(rows: OutdatedDependency[]) {
  const merged = new Map<string, OutdatedDependency>();

  for (const row of rows) {
    const key = `${row.package}@${row.current}->${row.latest}`;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, row);
      continue;
    }

    const workspaces = new Set([
      ...existing.workspace.split(', '),
      ...row.workspace.split(', '),
    ]);

    merged.set(key, {
      ...existing,
      workspace: [...workspaces].join(', '),
      dependencyType: existing.dependencyType.toLowerCase().includes('dev')
        ? row.dependencyType
        : existing.dependencyType,
    });
  }

  return [...merged.values()];
}

function toOutdatedRow(
  name: string,
  workspace: string,
  info: Record<string, unknown>,
): OutdatedDependency | null {
  const current = readString(info, 'current');
  const wanted = readString(info, 'wanted');
  const latest = readString(info, 'latest');

  if (!current || !wanted || !latest) {
    return null;
  }

  return {
    package: name,
    workspace,
    dependencyType: readString(info, 'dependencyType') ?? 'unknown',
    current,
    wanted,
    latest,
  };
}

/**
 * A package listed under more than one dependency type gets a key like
 * "lucide-react@1.56.0" or "lucide-react@1.56.0 (dev)".
 */
function stripPnpmKeySuffix(key: string) {
  const name = key.replace(/ \([^)]*\)$/, '');
  const versionAt = name.indexOf('@', 1);

  return versionAt > 0 ? name.slice(0, versionAt) : name;
}

function readDependentNames(info: Record<string, unknown>) {
  const dependents = info['dependentPackages'];

  if (!Array.isArray(dependents)) {
    return 'root';
  }

  const names = dependents
    .map((dependent) =>
      isRecord(dependent) ? readString(dependent, 'name') : null,
    )
    .filter((name) => name !== null);

  return names.length > 0 ? names.join(', ') : 'root';
}

function normalizeOutdatedItem(value: unknown): OutdatedDependency | null {
  if (!isRecord(value)) {
    return null;
  }

  const name =
    readString(value, 'name') ??
    readString(value, 'package') ??
    readString(value, 'pkgName');
  const current = readString(value, 'current');
  const wanted = readString(value, 'wanted');
  const latest = readString(value, 'latest');

  if (!name || !current || !wanted || !latest) {
    return null;
  }

  return {
    package: name,
    workspace:
      readString(value, 'workspace') ??
      readString(value, 'dependent') ??
      readString(value, 'location') ??
      'root',
    dependencyType:
      readString(value, 'dependencyType') ??
      readString(value, 'packageType') ??
      'unknown',
    current,
    wanted,
    latest,
  };
}

function getUpdateType(current: string, latest: string) {
  const currentVersion = parseSemver(current);
  const latestVersion = parseSemver(latest);

  if (!currentVersion || !latestVersion) {
    return 'unknown' as const;
  }

  if (latestVersion.major > currentVersion.major) {
    return 'major' as const;
  }

  if (latestVersion.minor > currentVersion.minor) {
    return 'minor' as const;
  }

  if (latestVersion.patch > currentVersion.patch) {
    return 'patch' as const;
  }

  return 'unknown' as const;
}

function parseSemver(input: string) {
  const match = input.match(/(\d+)\.(\d+)\.(\d+)/);

  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/**
 * Scope the upgrade to the workspaces that depend on the package. An unscoped
 * `pnpm up -r pkg@x` rewrites every workspace that uses pkg, which downgrades
 * one that already sits on a newer major (pnpm's JSON lists one entry per
 * package, so such a workspace may not appear in the report at all).
 */
function buildUpgradeCommand(workspace: string, specs: string) {
  const filters =
    workspace === 'root'
      ? []
      : workspace.split(', ').map((name) => `--filter ${name}`);

  return filters.length > 0
    ? `pnpm ${filters.join(' ')} up ${specs}`
    : `pnpm up -r ${specs}`;
}

function buildBatchCommand(recommendations: DepsUpgradeRecommendation[]) {
  if (recommendations.length === 0) {
    return null;
  }

  // One command per set of workspaces, so each upgrade keeps its own scope.
  const specsByWorkspace = new Map<string, Set<string>>();

  for (const item of recommendations) {
    const specs = specsByWorkspace.get(item.workspace) ?? new Set<string>();
    specs.add(`${item.package}@${item.recommended_target}`);
    specsByWorkspace.set(item.workspace, specs);
  }

  return [...specsByWorkspace]
    .map(([workspace, specs]) =>
      buildUpgradeCommand(workspace, [...specs].join(' ')),
    )
    .join(' && ');
}

function sortRecommendations(
  a: DepsUpgradeRecommendation,
  b: DepsUpgradeRecommendation,
) {
  const rank: Record<DepsUpgradeRecommendation['risk'], number> = {
    high: 0,
    medium: 1,
    low: 2,
  };

  return rank[a.risk] - rank[b.risk] || a.package.localeCompare(b.package);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
