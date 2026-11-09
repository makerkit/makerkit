import { describe, expect, it } from 'vitest';

import { parseCliArgs } from '../cli';

describe('parseCliArgs', () => {
  it('reads the journey, flags, the step and confirmed ids', () => {
    expect(
      parseCliArgs([
        'setup',
        '--plan',
        '--json',
        '--step',
        'db-seed',
        '--confirm',
        'db-seed,db-reset',
        '--yes',
      ]),
    ).toEqual({
      journey: 'setup',
      json: true,
      modes: ['plan'],
      yes: true,
      step: 'db-seed',
      confirm: ['db-seed', 'db-reset'],
      other: [],
    });
  });

  it('never reads a flag value as the journey', () => {
    expect(parseCliArgs(['--step', 'db-seed', 'setup']).journey).toBe('setup');
  });
});

describe('parseCliArgs --stop', () => {
  it('reads --stop as a mode, with --step naming the step', () => {
    expect(
      parseCliArgs(['setup', '--stop', '--step', 'dev-server']),
    ).toMatchObject({ modes: ['stop'], step: 'dev-server' });
  });
});

describe('parseCliArgs --check', () => {
  it('reads --check as a mode (what kit:doctor runs per journey)', () => {
    expect(parseCliArgs(['billing-setup', '--check'])).toMatchObject({
      modes: ['check'],
    });
  });
});
