import { describe, expect, it } from 'vitest';
import {
  abstainWriteSchema,
  allowedChildrenForParent,
  allowedEdgeTypes,
  challengeVoteWriteSchema,
  contributionWriteSchema,
  EDGE_TYPES,
  GAP_TYPES,
  isEdgeAllowed,
  NODE_TYPES,
} from '../src';

describe('contributionWriteSchema', () => {
  it('accepts a well-formed claim that attaches to a parent', () => {
    const parsed = contributionWriteSchema.safeParse({
      node_type: 'claim',
      parent_id: 'option-1',
      edge_type: 'supports',
      title: 'Sediment clauses exist but are unenforced',
      body: 'Existing MRC procedures reference flow but not sediment flux, which creates an audit gap.',
      confidence: 70,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects non-question nodes that lack a parent', () => {
    const parsed = contributionWriteSchema.safeParse({
      node_type: 'claim',
      body: 'Some floating claim without parent context here.',
    });
    expect(parsed.success).toBe(false);
  });

  it('requires evidence nodes to carry url + excerpt + accessed_at', () => {
    const parsed = contributionWriteSchema.safeParse({
      node_type: 'evidence',
      parent_id: 'claim-1',
      edge_type: 'supports',
      body: 'Supporting source for the claim about audit gaps above.',
      evidence_url: 'https://example.test/report',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts a well-formed evidence node', () => {
    const parsed = contributionWriteSchema.safeParse({
      node_type: 'evidence',
      parent_id: 'claim-1',
      edge_type: 'supports',
      body: 'Cited table 4.2 of the linked report shows the audit gap is widening.',
      evidence_url: 'https://example.test/report',
      evidence_excerpt:
        'Table 4.2 of the linked report shows the gap widened from 12% to 19% in the most recent reporting period.',
      evidence_accessed_at: '2026-01-15T10:00:00Z',
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts a root question with no parent/edge', () => {
    const parsed = contributionWriteSchema.safeParse({
      node_type: 'question',
      title: 'What is the question?',
      body: 'Framing the debate around sediment flux accountability in the Mekong basin.',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects ftp urls on evidence', () => {
    const parsed = contributionWriteSchema.safeParse({
      node_type: 'evidence',
      parent_id: 'claim-1',
      edge_type: 'supports',
      body: 'Body text long enough to pass the body floor here please.',
      evidence_url: 'ftp://example.test/report',
      evidence_excerpt: 'A long enough excerpt to satisfy the minimum length rule.',
      evidence_accessed_at: '2026-01-15T10:00:00Z',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects evidence_accessed_at far in the future', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const parsed = contributionWriteSchema.safeParse({
      node_type: 'evidence',
      parent_id: 'claim-1',
      edge_type: 'supports',
      body: 'Body text long enough to pass the body floor here please.',
      evidence_url: 'https://example.test/report',
      evidence_excerpt: 'A long enough excerpt to satisfy the minimum length rule.',
      evidence_accessed_at: future,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects source_attribution with a URL-like substring', () => {
    const parsed = contributionWriteSchema.safeParse({
      node_type: 'evidence',
      parent_id: 'claim-1',
      edge_type: 'supports',
      body: 'Body text long enough to pass the body floor here please.',
      evidence_url: 'https://example.test/report',
      evidence_excerpt: 'A long enough excerpt to satisfy the minimum length rule.',
      evidence_accessed_at: '2026-01-15T10:00:00Z',
      source_attribution: 'Sourced from example.com',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('abstainWriteSchema', () => {
  it('rejects unknown reason codes', () => {
    const parsed = abstainWriteSchema.safeParse({ reason_code: 'nope', note: 'x' });
    expect(parsed.success).toBe(false);
  });

  it('accepts known reasons', () => {
    const parsed = abstainWriteSchema.safeParse({ reason_code: 'out_of_scope' });
    expect(parsed.success).toBe(true);
  });
});

describe('challengeVoteWriteSchema', () => {
  it('accepts yes votes without a rationale', () => {
    const parsed = challengeVoteWriteSchema.safeParse({ vote: 'yes' });
    expect(parsed.success).toBe(true);
  });

  it('rejects no votes without a rationale', () => {
    const parsed = challengeVoteWriteSchema.safeParse({ vote: 'no' });
    expect(parsed.success).toBe(false);
  });

  it('accepts no votes with a rationale', () => {
    const parsed = challengeVoteWriteSchema.safeParse({
      vote: 'no',
      rationale: 'Out of scope for environmental deliberation.',
    });
    expect(parsed.success).toBe(true);
  });
});

describe('edge grammar', () => {
  it('isEdgeAllowed accepts a known legal pair', () => {
    expect(isEdgeAllowed('supports', 'evidence', 'claim')).toBe(true);
  });

  it('isEdgeAllowed rejects an illegal pair', () => {
    expect(isEdgeAllowed('answers', 'evidence', 'question')).toBe(false);
  });

  it('allowedEdgeTypes returns only legal edges between two node types', () => {
    const edges = allowedEdgeTypes('claim', 'option');
    expect(edges).toContain('supports');
    expect(edges).toContain('objects_to');
    expect(edges).not.toContain('answers');
  });

  it('allowedChildrenForParent returns at least one entry for every non-leaf node type', () => {
    // `comment` is a deliberate leaf — no edge points to it.
    for (const node of NODE_TYPES.filter((n) => n !== 'comment')) {
      const children = allowedChildrenForParent(node);
      expect(children.length).toBeGreaterThan(0);
      for (const child of children) {
        expect(EDGE_TYPES).toContain(child.edge_type);
        expect(NODE_TYPES).toContain(child.node_type);
      }
    }
    expect(allowedChildrenForParent('comment')).toEqual([]);
  });

  it('only `comment` parents accept comments_on edges', () => {
    for (const node of NODE_TYPES) {
      if (node === 'comment') continue;
      const children = allowedChildrenForParent(node);
      const commentEntry = children.find((c) => c.edge_type === 'comments_on');
      expect(commentEntry?.node_type).toBe('comment');
    }
  });
});

describe('GAP_TYPES', () => {
  it('exposes the consolidation-phase gap types alongside the structural ones', () => {
    // These two gaps are the agent runtime's signal to switch from "find
    // something to add" to "fix what's already there". If they get dropped
    // from the export the prompt loses its only path out of claim-on-claim
    // meta-debate on a structurally complete graph.
    expect(GAP_TYPES).toContain('retract_or_iterate_objection');
    expect(GAP_TYPES).toContain('consolidate_leading_option');
  });

  it('lists every known gap type so the agent can pattern-match exhaustively', () => {
    expect([...GAP_TYPES].sort()).toEqual(
      [
        'consolidate_leading_option',
        'evidenceless_option',
        'missing_deliverable',
        'missing_framing_question',
        'retract_or_iterate_objection',
        'shallow_deliverable',
        'single_option_question',
        'stale_subtree',
        'unanswered_framing_question',
        'uncontested_option',
        'unratified_question',
      ].sort(),
    );
  });
});
