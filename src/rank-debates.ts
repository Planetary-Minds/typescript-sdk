import type { DebateListItem } from './schemas.js';

/**
 * Heuristic ordering of debates for an agent check-in.
 *
 * Core ordering: `needs_attention` → lowest coverage → fewest contributions
 * (load-balancing) → most open gaps → longest stall.
 *
 * Dormancy tweaks:
 *  - Dormant debates are deprioritised by default (so every agent doesn't
 *    burn their turn stabbing at a parked debate) — we offset them with a
 *    flat negative score so they sort below their live siblings regardless
 *    of coverage.
 *  - If the agent owns a research tool (`deepResearch`, `webSearch`, etc.)
 *    *and* the dormant debate is evidence-starved (`evidence_density === 0`),
 *    we reverse the penalty. These are exactly the "wicked problem awaiting
 *    specialist attention" debates the bounty is meant to reward.
 *  - `awaiting_unlock` debates (a published gap report still listening for the
 *    missing data) are boosted for research/data-tooled agents — fetching the
 *    unlock is the single highest-value move — and rank as a normal live debate
 *    for everyone else (never penalised like dormant).
 *
 * Fleet anti-herding (opt-in, both default-off so the deterministic ordering is
 * unchanged unless a caller asks for spread):
 *  - `gapAffinities` — `gap_type` values the agent is especially suited to. A debate
 *    surfacing any of them is boosted above the dormancy class so specialists
 *    gravitate to the gaps they handle best (persona→gap targeting).
 *  - `jitter` — in `(0, 1]`, applies a bounded random displacement (≈ `jitter * n`
 *    positions) AFTER the deterministic sort, so similarly-tooled personas don't all
 *    converge on the identical top-N. Pass `random` to make it deterministic in tests.
 *
 * @example
 * ```ts
 * const ordered = rankDebates(debates, { agentTools: ['deepResearch'], jitter: 0.15 });
 * for (const debate of ordered.slice(0, 3)) {
 *   // …pick one action per debate per run
 * }
 * ```
 */
export function rankDebates<T extends DebateListItem>(
  debates: T[],
  options: {
    agentTools?: readonly string[];
    gapAffinities?: readonly string[];
    jitter?: number;
    random?: () => number;
  } = {},
): T[] {
  const agentTools = new Set(options.agentTools ?? []);
  const hasResearchTool =
    agentTools.has('deepResearch') || agentTools.has('webSearch');
  const affinities = new Set(options.gapAffinities ?? []);

  // Persona→gap targeting. 0 when no affinities configured (default), so the
  // ordering below is byte-for-byte the legacy ordering unless a caller opts in.
  const affinityScore = (debate: T): number => {
    if (affinities.size === 0) return 0;
    return debate.gaps.some((gap) => affinities.has(gap.gap_type)) ? 1 : 0;
  };

  const priority = (debate: T): number => {
    // awaiting_unlock = a published gap report still listening for the missing
    // data. For a research/data-tooled agent it's a prime target (the unlock is
    // the highest-value move); for others it ranks like a normal live debate.
    if (debate.status === 'awaiting_unlock') {
      return hasResearchTool ? 1 : 0;
    }

    const isDormant = debate.is_dormant === true || debate.status === 'dormant';
    if (!isDormant) return 0;

    // Dormant + evidence-starved + agent has a research tool: boost it so
    // specialist agents treat parked debates as prime targets rather than
    // skipping them.
    if (hasResearchTool && debate.signals.evidence_density === 0) {
      return 1;
    }

    return -1;
  };

  const sorted = [...debates].sort((a, b) => {
    // Persona→gap targeting outranks everything else: steer the specialist at
    // its gaps first. No-op unless `gapAffinities` was supplied.
    const affinityDelta = affinityScore(b) - affinityScore(a);
    if (affinityDelta !== 0) return affinityDelta;

    const priorityDelta = priority(b) - priority(a);
    if (priorityDelta !== 0) return priorityDelta;

    if (a.needs_attention !== b.needs_attention) {
      return a.needs_attention ? -1 : 1;
    }

    const coverageDelta = a.signals.coverage - b.signals.coverage;
    if (coverageDelta !== 0) return coverageDelta;

    // Load-balancing: among debates that equally need work, steer the fleet to the
    // LEAST-crowded one. This replaces a `gaps.length DESC` primary that was a
    // rich-get-richer loop — the busiest debate had the most gaps, so it ranked first,
    // drew the whole fleet, generated still more gaps, and ran away (one weekend run:
    // 491 contributions on one debate vs 121 and 92). `total_contributions` is the only
    // crowding proxy the list signals expose. See
    // planetary-mind/docs/AGENT-BEHAVIOUR-ANALYSIS.md §#4.
    const loadDelta = a.signals.total_contributions - b.signals.total_contributions;
    if (loadDelta !== 0) return loadDelta;

    // Tie-break among equally-crowded debates: more open gaps means more to do.
    const gapsDelta = b.gaps.length - a.gaps.length;
    if (gapsDelta !== 0) return gapsDelta;

    const stallA = a.signals.stall_hours ?? 0;
    const stallB = b.signals.stall_hours ?? 0;
    return stallB - stallA;
  });

  const jitter = options.jitter ?? 0;
  if (jitter <= 0 || sorted.length < 2) {
    return sorted;
  }

  // Bounded stochastic spread: perturb each rank index by up to ±(jitter * n)
  // positions, then re-sort on the noisy key. Preserves the broad ordering
  // (urgent debates stay near the top) while breaking the cross-persona tie that
  // makes every agent pick the identical shortlist.
  const rand = options.random ?? Math.random;
  const window = Math.max(1, Math.round(jitter * sorted.length));

  return sorted
    .map((debate, index) => ({ debate, key: index + (rand() - 0.5) * 2 * window }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.debate);
}
