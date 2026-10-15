import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findWorkspaceRoot } from '../node';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('findWorkspaceRoot', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'env-inspector-fwr-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns the directory containing pnpm-workspace.yaml', () => {
    writeFileSync(join(tmp, 'pnpm-workspace.yaml'), '');

    expect(findWorkspaceRoot(tmp)).toBe(tmp);
  });

  it('walks up to the workspace root from a nested directory', () => {
    const nested = join(tmp, 'packages', 'foo', 'src');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(tmp, 'pnpm-workspace.yaml'), '');

    expect(findWorkspaceRoot(nested)).toBe(tmp);
  });

  it('returns startPath when no marker is found within the depth', () => {
    const deep = join(tmp, 'a', 'b', 'c', 'd', 'e', 'f', 'g');
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(tmp, 'pnpm-workspace.yaml'), '');

    // 7 levels deep, the limit is 6.
    expect(findWorkspaceRoot(deep)).toBe(deep);
  });

  it('returns startPath when no marker exists at all', () => {
    expect(findWorkspaceRoot(tmp)).toBe(tmp);
  });

  it('finds the root at the depth boundary (5 levels up)', () => {
    const nested = join(tmp, 'a', 'b', 'c', 'd', 'e');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(tmp, 'pnpm-workspace.yaml'), '');

    expect(findWorkspaceRoot(nested)).toBe(tmp);
  });

  it('detects npm, yarn and bun workspaces from package.json', () => {
    const nested = join(tmp, 'apps', 'web');
    mkdirSync(nested, { recursive: true });
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ workspaces: ['apps/*'] }),
    );
    writeFileSync(
      join(nested, 'package.json'),
      JSON.stringify({ name: 'web' }),
    );

    expect(findWorkspaceRoot(nested)).toBe(tmp);
  });

  it('accepts custom markers and depth', () => {
    const nested = join(tmp, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(tmp, 'pnpm-workspace.yaml'), '');
    writeFileSync(join(tmp, 'a', 'root.marker'), '');

    expect(findWorkspaceRoot(nested, { markers: ['root.marker'] })).toBe(
      join(tmp, 'a'),
    );
    expect(findWorkspaceRoot(nested, { maxDepth: 2 })).toBe(nested);
  });
});
