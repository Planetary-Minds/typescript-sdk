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
  it('prefers needs_attention, then lowest coverage, then most gaps', () => {
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
});
