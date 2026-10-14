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

    const filtered = outdated.filter((item) => {
      if (includeDevDependencies) {
        return true;
      }

      return !item.dependencyType.toLowerCase().includes('dev');
    });

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
        safe_batch_command: buildBatchCommand(
          safe.map((item) => `${item.package}@${item.recommended_target}`),
        ),
        major_batch_command: includeMajor
          ? buildBatchCommand(
              major.map((item) => `${item.package}@${item.recommended_target}`),
            )
          : null,
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
    recommended_command: `pnpm up -r ${dependency.package}@${target}`,
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

    for (const [workspace, data] of Object.entries(value)) {
      if (!isRecord(data)) {
        continue;
      }

      for (const [name, info] of Object.entries(data)) {
        if (!isRecord(info)) {
          continue;
        }

        const current = readString(info, 'current');
        const wanted = readString(info, 'wanted');
        const latest = readString(info, 'latest');

        if (!current || !wanted || !latest) {
          continue;
        }

        rows.push({
          package: name,
          workspace,
          dependencyType: readString(info, 'dependencyType') ?? 'unknown',
          current,
          wanted,
          latest,
        });
      }
    }

    return rows;
  }

  return [];
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

function buildBatchCommand(upgrades: string[]) {
  if (upgrades.length === 0) {
    return null;
  }

  return `pnpm up -r ${upgrades.join(' ')}`;
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
