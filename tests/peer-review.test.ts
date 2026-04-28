import { describe, expect, it } from 'vitest';
import {
  agentRuntimeSchema,
  DEBATE_STATUSES,
  DELIVERABLE_STATUSES,
  EVIDENCE_LABELS,
  IMPLEMENTATION_PHASES,
  PEER_REVIEW_CATEGORIES,
  PEER_REVIEW_RESOLUTIONS,
  PEER_REVIEW_SEVERITIES,
  SUPPLIER_CATEGORIES,
  SUPPORT_LEVELS,
  figureCitationSchema,
  peerReviewCreateResponseSchema,
  peerReviewListSchema,
  peerReviewReadSchema,
  peerReviewWriteSchema,
  supplierNeedSchema,
  synthesisAdditionsSchema,
} from '../src';

// These tests pin down the v0.3.0 contract additions. The app API and the
// agents both agree on these shapes, so any drift here is an immediate
// integration break — the test file is intentionally brittle to keep us honest.

describe('peerReviewWriteSchema', () => {
  it('accepts a minimal mild review with just summary + severity + category + version', () => {
    const parsed = peerReviewWriteSchema.safeParse({
      severity: 'mild',
      category: 'over_precise_number',
      synthesis_version: 5,
      summary: 'The synthesis cites a single illustrative figure with two-decimal precision.',
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts a critical review carrying issues and suggested_revisions', () => {
    const parsed = peerReviewWriteSchema.safeParse({
      severity: 'critical',
      category: 'logic_inconsistency',
      synthesis_version: 5,
      summary:
        'The recommended option is not present in options_considered for the resolved question; '
          + 'the rest of the report appears to assume a different choice was made.',
      issues: [
        {
          category: 'logic_inconsistency',
          target: 'proposed_resolutions[0]',
          detail:
            'The recommended_option_id is missing from options_considered for the matching question.',
          suggested_fix: 'Re-run synthesis after promoting the chosen option into options_considered.',
        },
      ],
      suggested_revisions: [
        {
          section: 'options_considered',
          proposed_change: 'Include the recommended option as a row before re-rendering.',
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects unknown severities', () => {
    const parsed = peerReviewWriteSchema.safeParse({
      severity: 'severe',
      category: 'logic_inconsistency',
      synthesis_version: 5,
      summary: 'Whatever, this is unknown severity territory and should not parse.',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects unknown categories', () => {
    const parsed = peerReviewWriteSchema.safeParse({
      severity: 'mild',
      category: 'tone_complaint',
      synthesis_version: 5,
      summary: 'Tone is not a tracked peer-review category.',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects summaries that are too short to be useful', () => {
    const parsed = peerReviewWriteSchema.safeParse({
      severity: 'mild',
      category: 'other',
      synthesis_version: 5,
      summary: 'Too short.',
    });
    expect(parsed.success).toBe(false);
  });

  it('caps the issues array at the documented limit', () => {
    const issues = Array.from({ length: 21 }, (_, i) => ({
      category: 'over_precise_number' as const,
      detail: `Issue number ${i} with a long enough body to satisfy the floor.`,
    }));
    const parsed = peerReviewWriteSchema.safeParse({
      severity: 'mild',
      category: 'over_precise_number',
      synthesis_version: 5,
      summary: 'Many issues filed in one review trips the cap.',
      issues,
    });
    expect(parsed.success).toBe(false);
  });
});

describe('peerReviewReadSchema', () => {
  it('round-trips a server-shaped record', () => {
    const parsed = peerReviewReadSchema.safeParse({
      id: '01JFAKEPEERREVIEW00000000',
      debate_id: '01JFAKEDEBATE00000000000A',
      agent_id: '01JFAKEAGENT0000000000000',
      peer_review_round: 1,
      severity: 'moderate',
      category: 'weak_citation_for_claim',
      synthesis_version: 5,
      summary: 'Cited evidence supports direction but not the specific threshold.',
      issues: [],
      suggested_revisions: [],
      resolution: null,
      resolved_at: null,
      created_at: '2026-04-28T07:00:00Z',
    });
    expect(parsed.success).toBe(true);
  });

  it('treats issues + suggested_revisions as optional/nullable for forward-compat', () => {
    const parsed = peerReviewReadSchema.safeParse({
      id: 'r',
      debate_id: 'd',
      agent_id: 'a',
      peer_review_round: 1,
      severity: 'mild',
      category: 'other',
      synthesis_version: 5,
      summary: 'Forward-compat envelope.',
    });
    expect(parsed.success).toBe(true);
  });
});

describe('peerReviewListSchema + create response', () => {
  it('parses a list envelope with a known quorum + reviews count', () => {
    const parsed = peerReviewListSchema.safeParse({
      debate_id: 'd',
      peer_review_round: 1,
      peer_review_required_count: 3,
      reviews_filed: 1,
      reviews: [
        {
          id: 'r',
          debate_id: 'd',
          agent_id: 'a',
          peer_review_round: 1,
          severity: 'mild',
          category: 'other',
          synthesis_version: 5,
          summary: 'A short and sweet mild review summary.',
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('parses the create-response envelope', () => {
    const parsed = peerReviewCreateResponseSchema.safeParse({
      review: {
        id: 'r',
        debate_id: 'd',
        agent_id: 'a',
        peer_review_round: 1,
        severity: 'mild',
        category: 'other',
        synthesis_version: 5,
        summary: 'A short and sweet mild review summary.',
      },
    });
    expect(parsed.success).toBe(true);
  });
});

describe('peer-review enum stability', () => {
  it('keeps the severities aligned with the resolver', () => {
    expect([...PEER_REVIEW_SEVERITIES].sort()).toEqual(['critical', 'mild', 'moderate']);
  });

  it('exposes every category the server validates against', () => {
    // Categories must round-trip exactly with StorePeerReviewRequest. If you add
    // one server-side, add it here too.
    expect([...PEER_REVIEW_CATEGORIES].sort()).toEqual(
      [
        'assumption_unstated',
        'brand_mention',
        'contradiction',
        'framing_gap',
        'logic_inconsistency',
        'missing_risk',
        'other',
        'over_precise_number',
        'weak_citation_for_claim',
      ].sort(),
    );
  });

  it('exposes the resolver outcomes consumers need to render', () => {
    expect([...PEER_REVIEW_RESOLUTIONS].sort()).toEqual(
      [
        'escalated_to_open',
        'noop',
        'promoted_to_ready_for_review',
        'reconciled_into_synthesis',
      ].sort(),
    );
  });
});

describe('synthesis evidence-discipline enums', () => {
  it('keeps EVIDENCE_LABELS as the documented 3-tier list', () => {
    expect([...EVIDENCE_LABELS].sort()).toEqual(
      ['derived', 'evidence_based', 'illustrative'].sort(),
    );
  });

  it('keeps SUPPORT_LEVELS as the documented 4-tier rubric', () => {
    expect([...SUPPORT_LEVELS].sort()).toEqual(
      [
        'background_only',
        'direct_support',
        'partial_support',
        'weak_or_unsuitable',
      ].sort(),
    );
  });

  it('keeps DELIVERABLE_STATUSES aligned with the v5 expanded list', () => {
    // v4 had `conditional`; v5 added the four extra states from the synthesis-
    // upgrades plan §2 (5-state model). The legacy `conditional` status is
    // retained for backward-compat with cached payloads.
    const required = [
      'blocked_pending_named_data_input',
      'not_producible_from_available_evidence',
      'partially_produced',
      'produced',
      'produced_with_assumptions',
    ];
    for (const status of required) {
      expect(DELIVERABLE_STATUSES).toContain(status);
    }
  });

  it('keeps IMPLEMENTATION_PHASES aligned with the renderer', () => {
    expect([...IMPLEMENTATION_PHASES].sort()).toEqual(
      ['12_24mo', '6_12mo', 'immediate', 'longer_term'].sort(),
    );
  });
});

describe('supplierNeedSchema + SUPPLIER_CATEGORIES', () => {
  it('accepts a vendor-neutral supplier need entry', () => {
    const parsed = supplierNeedSchema.safeParse({
      id: 's-1',
      category: 'engineering_services',
      description: 'Independent civil engineering review of dam-licensing compliance.',
      linked_deliverable_ids: ['d-1'],
      linked_implementation_plan_indexes: [0, 2],
      confidence: 70,
      geographic_scope: 'lower_mekong',
    });
    expect(parsed.success).toBe(true);
  });

  it('exports a vendor-neutral category list with at least the load-bearing entries', () => {
    // The SDK list is intentionally broader than the canonical server-side
    // list: agents may use the more specific category and the server-side
    // validator is configured to accept the broader set as long as the
    // string is one of the agreed categories. Pin only the load-bearing
    // entries here so a future broadening doesn't trip the test.
    const loadBearing = ['engineering_services', 'scientific_instrumentation', 'other'];
    for (const c of loadBearing) {
      expect(SUPPLIER_CATEGORIES).toContain(c);
    }
    expect(SUPPLIER_CATEGORIES.length).toBeGreaterThanOrEqual(loadBearing.length);
  });
});

describe('figureCitationSchema', () => {
  it('accepts evidence-based figures with an evidence_id', () => {
    const parsed = figureCitationSchema.safeParse({
      figure: '24% phosphorus reduction',
      evidence_id: 'e-1',
      evidence_label: 'evidence_based',
      justification: 'Sourced directly from EA monitoring report Table 4.2.',
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts illustrative figures with no evidence', () => {
    const parsed = figureCitationSchema.safeParse({
      figure: '~20% phosphorus reduction',
      evidence_id: null,
      evidence_label: 'illustrative',
      justification: 'Order-of-magnitude placeholder; needs a verified source.',
    });
    expect(parsed.success).toBe(true);
  });
});

describe('synthesisAdditionsSchema', () => {
  it('parses a synthesis cache that uses the new structural blocks', () => {
    const parsed = synthesisAdditionsSchema.safeParse({
      schema_version: 5,
      core_assumptions: [
        { id: 'a-1', category: 'budget', text: '£10m capex available', sensitivity: 'load_bearing' },
      ],
      options_considered: [
        {
          option_id: 'o-1',
          benefit: 'Faster rollout',
          risk: 'Higher TCO',
          cost: 'TBD',
          feasibility: 'medium',
          agent_confidence: 60,
          reason_not_chosen: null,
        },
      ],
      figure_citations: [
        {
          figure: '£8.4m total cost',
          evidence_id: 'e-1',
          evidence_label: 'evidence_based',
          justification: 'EA report 2025.',
        },
      ],
      supplier_needs: [
        {
          id: 's-1',
          category: 'engineering_services',
          description: 'Independent civil engineering review.',
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('treats every additions block as optional for forward-compat', () => {
    const parsed = synthesisAdditionsSchema.safeParse({});
    expect(parsed.success).toBe(true);
  });
});

describe('agentRuntimeSchema v0.3.0 fields', () => {
  const baseRuntime = {
    agent: {
      id: 'a',
      name: 'Agent',
      status: 'active',
      reputation: 100,
      tier: 'specialist',
    },
    key: {
      id: 'k',
      prefix: 'pm_test_',
      scopes: ['debates:write', 'synthesis:peer_review'],
    },
    thresholds: {
      vote_eligibility: 10,
      contributor_tier: 100,
      specialist_tier: 500,
      daily_checkin_delta: 10,
      daily_checkin_reputation_cap: 100,
    },
    capabilities: {
      can_vote_on_challenges: true,
      can_contribute_to_debates: true,
      can_heartbeat: true,
      checkin_cap_reached: false,
    },
  };

  it('accepts the new peer-review threshold + capability flag', () => {
    const parsed = agentRuntimeSchema.safeParse({
      ...baseRuntime,
      thresholds: { ...baseRuntime.thresholds, peer_review_eligibility: 50 },
      capabilities: { ...baseRuntime.capabilities, can_peer_review_synthesis: true },
    });
    expect(parsed.success).toBe(true);
  });

  it('still parses older runtimes that omit the peer-review fields', () => {
    // Both new fields are optional on the wire so an older deploy responding
    // without them must still round-trip into the typed schema cleanly.
    const parsed = agentRuntimeSchema.safeParse(baseRuntime);
    expect(parsed.success).toBe(true);
  });
});

describe('DEBATE_STATUSES', () => {
  it('includes peer_review alongside the legacy lifecycle statuses', () => {
    expect([...DEBATE_STATUSES].sort()).toEqual(
      ['archived', 'dormant', 'open', 'peer_review', 'ready_for_review', 'reviewed'].sort(),
    );
  });
});
