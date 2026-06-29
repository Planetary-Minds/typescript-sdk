import { describe, expect, it } from 'vitest';
import { rankDebates, type DebateResponse } from '../src';

const baseSignals = {
  coverage: 0,
  evidence_density: 0,
  contestation: 0,
  convergence: 'cold',
  stall_hours: null,
  total_contributions: 0,
  ratified_questions: 0,
};

function debate(overrides: Partial<DebateResponse> = {}): DebateResponse {
  const { signals: signalsOverride, ...rest } = overrides;
  return {
    id: '01ABCD',
    status: 'open',
    question_ratification_threshold: 2,
    challenge: null,
    needs_attention: false,
    contributions: [],
    edges: [],
    gaps: [],
    ...rest,
    signals: { ...baseSignals, ...(signalsOverride ?? {}) },
  };
}

describe('rankDebates', () => {
  it('prefers needs_attention, then least crowded, then coverage, then most gaps', () => {
    const a = debate({
      id: 'a',
      signals: { ...baseSignals, coverage: 0.8 },
      needs_attention: true,
    });
    const b = debate({ id: 'b', signals: { ...baseSignals, coverage: 0.2 } });
    const c = debate({
      id: 'c',
      signals: { ...baseSignals, coverage: 0.2 },
      gaps: [
        {
          contribution_id: null,
          gap_type: 'x',
          description: 'x',
          suggested_action: 'x',
        },
      ],
    });
    const ordered = rankDebates([a, b, c]).map((d) => d.id);
    expect(ordered).toEqual(['a', 'c', 'b']);
  });

  it('load-balances: among equally-attention-worthy debates, the least crowded ranks first', () => {
    const crowded = debate({
      id: 'crowded',
      signals: { ...baseSignals, coverage: 0.2, total_contributions: 400 },
    });
    const quiet = debate({
      id: 'quiet',
      signals: { ...baseSignals, coverage: 0.2, total_contributions: 20 },
    });
    const ordered = rankDebates([crowded, quiet]).map((d) => d.id);
    expect(ordered).toEqual(['quiet', 'crowded']);
  });

  it('load-balancing outranks coverage: a less-crowded debate wins even with HIGHER coverage', () => {
    // Regression for the coverage-ASC runaway (see rank-debates.ts): the least-crowded
    // debate must win even when it is further ahead on coverage. Before the fix, coverage
    // ASC sat above load, so the debate behind on coverage drew the whole fleet regardless
    // of crowding — and breadth-first answering pinned the busiest debate's coverage at 0,
    // making it a permanent magnet while the quiet, higher-coverage debate was starved.
    const quietButAhead = debate({
      id: 'quietAhead',
      signals: { ...baseSignals, coverage: 0.4, total_contributions: 27 },
    });
    const crowdedButBehind = debate({
      id: 'crowdedBehind',
      signals: { ...baseSignals, coverage: 0.2, total_contributions: 61 },
    });
    const ordered = rankDebates([crowdedButBehind, quietButAhead]).map((d) => d.id);
    expect(ordered).toEqual(['quietAhead', 'crowdedBehind']);
  });

  it('does NOT rich-get-richer: a busier debate with more gaps loses to a quieter one', () => {
    // Regression for the herding loop — the busiest debate must not win on gap count alone.
    const busyManyGaps = debate({
      id: 'busy',
      signals: { ...baseSignals, coverage: 0.2, total_contributions: 491 },
      gaps: Array.from({ length: 8 }, () => ({
        contribution_id: null,
        gap_type: 'x',
        description: 'x',
        suggested_action: 'x',
      })),
    });
    const quietFewGaps = debate({
      id: 'quiet',
      signals: { ...baseSignals, coverage: 0.2, total_contributions: 92 },
      gaps: [
        { contribution_id: null, gap_type: 'x', description: 'x', suggested_action: 'x' },
      ],
    });
    const ordered = rankDebates([busyManyGaps, quietFewGaps]).map((d) => d.id);
    expect(ordered).toEqual(['quiet', 'busy']);
  });

  it('falls back to gaps as a tie-break only when crowding is equal', () => {
    const moreGaps = debate({
      id: 'moreGaps',
      signals: { ...baseSignals, coverage: 0.2, total_contributions: 50 },
      gaps: [
        { contribution_id: null, gap_type: 'x', description: 'x', suggested_action: 'x' },
        { contribution_id: null, gap_type: 'y', description: 'y', suggested_action: 'y' },
      ],
    });
    const fewerGaps = debate({
      id: 'fewerGaps',
      signals: { ...baseSignals, coverage: 0.2, total_contributions: 50 },
      gaps: [
        { contribution_id: null, gap_type: 'x', description: 'x', suggested_action: 'x' },
      ],
    });
    const ordered = rankDebates([fewerGaps, moreGaps]).map((d) => d.id);
    expect(ordered).toEqual(['moreGaps', 'fewerGaps']);
  });

  it('breaks ties on coverage by stall_hours when gaps are equal', () => {
    const fresher = debate({
      id: 'fresher',
      signals: { ...baseSignals, coverage: 0.2, stall_hours: 1 },
    });
    const stale = debate({
      id: 'stale',
      signals: { ...baseSignals, coverage: 0.2, stall_hours: 12 },
    });
    const ordered = rankDebates([fresher, stale]).map((d) => d.id);
    expect(ordered).toEqual(['stale', 'fresher']);
  });

  it('deprioritises dormant debates by default', () => {
    const live = debate({ id: 'live', signals: { ...baseSignals, coverage: 0.8 } });
    const parked = debate({
      id: 'parked',
      status: 'dormant',
      is_dormant: true,
      signals: { ...baseSignals, coverage: 0.2 },
    });

    const ordered = rankDebates([parked, live]).map((d) => d.id);
    expect(ordered).toEqual(['live', 'parked']);
  });

  it('boosts evidence-starved dormant debates for agents with a research tool', () => {
    const live = debate({ id: 'live', signals: { ...baseSignals, coverage: 0.8 } });
    const parked = debate({
      id: 'parked',
      status: 'dormant',
      is_dormant: true,
      signals: { ...baseSignals, evidence_density: 0, coverage: 0.2 },
    });

    const ordered = rankDebates([live, parked], { agentTools: ['deepResearch'] }).map(
      (d) => d.id,
    );
    expect(ordered[0]).toBe('parked');
  });

  it('does not boost dormant debates that already have evidence', () => {
    const live = debate({ id: 'live', signals: { ...baseSignals, coverage: 0.8 } });
    const parked = debate({
      id: 'parked',
      status: 'dormant',
      is_dormant: true,
      signals: { ...baseSignals, evidence_density: 1.2, coverage: 0.2 },
    });

    const ordered = rankDebates([live, parked], { agentTools: ['deepResearch'] }).map(
      (d) => d.id,
    );
    expect(ordered[0]).toBe('live');
  });

  it('does not mutate the input array', () => {
    const a = debate({ id: 'a', signals: { ...baseSignals, coverage: 0.8 } });
    const b = debate({ id: 'b', signals: { ...baseSignals, coverage: 0.2 } });
    const input = [a, b];
    const inputSnapshot = input.map((d) => d.id);
    rankDebates(input);
    expect(input.map((d) => d.id)).toEqual(inputSnapshot);
  });

  it('boosts debates matching a persona gap affinity above the default order', () => {
    // `low` would normally outrank `target` (lower coverage), but `target`
    // carries a gap the persona is tuned for, so it floats to the top.
    const low = debate({ id: 'low', signals: { ...baseSignals, coverage: 0.1 } });
    const target = debate({
      id: 'target',
      signals: { ...baseSignals, coverage: 0.9 },
      gaps: [
        {
          contribution_id: null,
          gap_type: 'shallow_deliverable',
          description: 'x',
          suggested_action: 'x',
        },
      ],
    });

    const baseline = rankDebates([low, target]).map((d) => d.id);
    expect(baseline).toEqual(['low', 'target']);

    const targeted = rankDebates([low, target], {
      gapAffinities: ['shallow_deliverable'],
    }).map((d) => d.id);
    expect(targeted[0]).toBe('target');
  });

  it('jitter is deterministic ordering when no jitter is supplied (default off)', () => {
    const a = debate({ id: 'a', signals: { ...baseSignals, coverage: 0.1 } });
    const b = debate({ id: 'b', signals: { ...baseSignals, coverage: 0.5 } });
    const c = debate({ id: 'c', signals: { ...baseSignals, coverage: 0.9 } });
    expect(rankDebates([c, b, a]).map((d) => d.id)).toEqual(['a', 'b', 'c']);
  });

  it('jitter perturbs the ranking using the injected random source', () => {
    const a = debate({ id: 'a', signals: { ...baseSignals, coverage: 0.1 } });
    const b = debate({ id: 'b', signals: { ...baseSignals, coverage: 0.5 } });
    const c = debate({ id: 'c', signals: { ...baseSignals, coverage: 0.9 } });

    // random() = 1 pushes every key to its max positive displacement equally,
    // so order is preserved; the real value is that a varying source reorders.
    // Use a source that strongly demotes the first item to prove displacement.
    const sequence = [1, 0, 0.5];
    let i = 0;
    const random = () => sequence[i++ % sequence.length];

    const ordered = rankDebates([c, b, a], { jitter: 1, random }).map((d) => d.id);
    // 'a' (index 0) gets key 0 + (1-0.5)*2*3 = 3; 'b' (index 1) gets 1 + (0-0.5)*6 = -2;
    // 'c' (index 2) gets 2 + (0.5-0.5)*6 = 2. Sorted by key: b(-2), c(2), a(3).
    expect(ordered).toEqual(['b', 'c', 'a']);
  });
});
