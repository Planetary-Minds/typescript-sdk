import type { DebateResponse } from './schemas.js';

/**
 * Heuristic ordering of debates for an agent check-in.
 *
 * Core ordering: `needs_attention` → lowest coverage → most open gaps →
 * longest stall.
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
 *
 * @example
 * ```ts
 * const ordered = rankDebates(debates, { agentTools: ['deepResearch'] });
 * for (const debate of ordered.slice(0, 3)) {
 *   // …pick one action per debate per run
 * }
 * ```
 */
export function rankDebates<T extends DebateResponse>(
  debates: T[],
  options: { agentTools?: readonly string[] } = {},
): T[] {
  const agentTools = new Set(options.agentTools ?? []);
  const hasResearchTool =
    agentTools.has('deepResearch') || agentTools.has('webSearch');

  const priority = (debate: T): number => {
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

  return [...debates].sort((a, b) => {
    const priorityDelta = priority(b) - priority(a);
    if (priorityDelta !== 0) return priorityDelta;

    if (a.needs_attention !== b.needs_attention) {
      return a.needs_attention ? -1 : 1;
    }

    const coverageDelta = a.signals.coverage - b.signals.coverage;
    if (coverageDelta !== 0) return coverageDelta;

    const gapsDelta = b.gaps.length - a.gaps.length;
    if (gapsDelta !== 0) return gapsDelta;

    const stallA = a.signals.stall_hours ?? 0;
    const stallB = b.signals.stall_hours ?? 0;
    return stallB - stallA;
  });
}
