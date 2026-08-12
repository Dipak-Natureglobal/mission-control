// Wave 28d/28e — workload-aware assignment scoring.
//
// scoreAgents({ agents, opp }) → Array<{ agent, score, suggested, breakdown }>
// scoreAgentsForOpps({ agents, opps }) → averages tag-match across selected opps
//
// Composite score (per ADR 19 §7):
//   score = workload_factor * 0.6 + tag_match_factor * 0.4
//   workload_factor = 1 - (agent.workload.open_count / maxOpenCountInSet)
//                     (0..1, higher = lower load)
//   tag_match_factor = |intersection(agent.tags, opp_needed_tags)|
//                      / max(1, |opp_needed_tags|)
//
// opp_needed_tags derived from opp.type:
//   'protection' | 'vsc' → ['vsc-specialist']
//   'refi'               → ['refi-specialist']
//   'insurance'          → ['insurance-specialist']
//   'payments'           → []
// Plus 'escalations' when opp.status indicates trouble (e.g. 'Payment Failed',
// 'Stuck'), plus 'onboarding' when opp.created_at within last 24h.
//
// Suggested = top 3 by score (ties broken by descending workload_factor).
// Returns the FULL sorted list — the consumer decides which to surface.

export const WEIGHT_WORKLOAD = 0.6;
export const WEIGHT_TAG_MATCH = 0.4;

const TYPE_REQUIRED_TAGS = {
  protection: ['vsc-specialist'],
  vsc: ['vsc-specialist'],
  refi: ['refi-specialist'],
  insurance: ['insurance-specialist'],
  payments: [],
};

// Statuses that flag an opp as "needs escalation handling". Hand-rolled
// to match canon/ghl-status.json crm_stage === 'Lost' near-terminal +
// payment-failure cases. _TODO(canon): promote to a derived view alongside
// the equivalent TODO in packages/api/agents.js LOSING_STATUSES.
const ESCALATION_STATUSES = new Set([
  'Payment Failed',
  'Stuck',
  'Working - Rejected',
  'Disqualified',
  'Declined',
]);

const ONBOARDING_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Derive the tag-match target for an opportunity.
 */
export function neededTagsForOpp(opp) {
  if (!opp || typeof opp !== 'object') return [];
  const base = TYPE_REQUIRED_TAGS[opp.type] || [];
  const tags = new Set(base);
  if (opp.status && ESCALATION_STATUSES.has(opp.status)) tags.add('escalations');
  if (opp.created_at) {
    const t = Date.parse(opp.created_at);
    if (Number.isFinite(t) && Date.now() - t <= ONBOARDING_WINDOW_MS) {
      tags.add('onboarding');
    }
  }
  return Array.from(tags);
}

function _openCountOf(agent) {
  const wl = agent && agent.workload;
  if (wl && typeof wl.open_count === 'number') return wl.open_count;
  // Some callers pass the enriched record straight off blinkerApi.agents.list,
  // where workload metrics sit on the root (open_count / stale_count / ...).
  // Support both shapes so 28e doesn't need to repackage.
  if (agent && typeof agent.open_count === 'number') return agent.open_count;
  return 0;
}

function _agentTagsOf(agent) {
  const t = agent && agent.tags;
  return Array.isArray(t) ? t : [];
}

function _intersectionSize(a, b) {
  if (!a.length || !b.length) return 0;
  const set = new Set(a);
  let n = 0;
  for (const x of b) if (set.has(x)) n += 1;
  return n;
}

function _rankAndTagSuggested(scored) {
  const sorted = scored.slice().sort((x, y) => {
    if (y.score !== x.score) return y.score - x.score;
    // Tie-break on workload_factor (higher = lower load).
    return y.breakdown.workload_factor - x.breakdown.workload_factor;
  });
  return sorted.map((row, i) => ({ ...row, suggested: i < 3 }));
}

/**
 * Score a slate of agents for a single opportunity.
 */
export function scoreAgents({ agents, opp } = {}) {
  if (!Array.isArray(agents) || agents.length === 0) return [];
  const maxOpen = Math.max(0, ...agents.map(_openCountOf));
  const needed = neededTagsForOpp(opp);
  const neededDenom = Math.max(1, needed.length);

  const scored = agents.map((agent) => {
    const open = _openCountOf(agent);
    const workload_factor = maxOpen > 0 ? 1 - open / maxOpen : 1;
    const matchCount = _intersectionSize(_agentTagsOf(agent), needed);
    const tag_match_factor = matchCount / neededDenom;
    const score =
      workload_factor * WEIGHT_WORKLOAD + tag_match_factor * WEIGHT_TAG_MATCH;
    return {
      agent,
      score,
      suggested: false,
      breakdown: {
        workload_factor,
        tag_match_factor,
        open_count: open,
        max_open_count: maxOpen,
        needed_tags: needed,
        matched_tag_count: matchCount,
      },
    };
  });

  return _rankAndTagSuggested(scored);
}

/**
 * Score across a set of opportunities (multi-select bulk reassign).
 * Tag-match factor is averaged across opps; workload factor is computed
 * once per agent against the workload snapshot.
 */
export function scoreAgentsForOpps({ agents, opps } = {}) {
  if (!Array.isArray(agents) || agents.length === 0) return [];
  if (!Array.isArray(opps) || opps.length === 0) {
    return scoreAgents({ agents, opp: null });
  }
  const maxOpen = Math.max(0, ...agents.map(_openCountOf));

  // Per-opp needed-tags computed once so we don't recompute inside the
  // agent loop. opps with no needed tags still divide into the average
  // by counting as a 1.0 (any agent satisfies them equally).
  const oppNeededLists = opps.map(neededTagsForOpp);

  const scored = agents.map((agent) => {
    const open = _openCountOf(agent);
    const workload_factor = maxOpen > 0 ? 1 - open / maxOpen : 1;
    const tags = _agentTagsOf(agent);

    const perOppFactors = oppNeededLists.map((needed) => {
      if (needed.length === 0) return 1;
      return _intersectionSize(tags, needed) / needed.length;
    });
    const tag_match_factor =
      perOppFactors.reduce((a, b) => a + b, 0) / perOppFactors.length;

    const score =
      workload_factor * WEIGHT_WORKLOAD + tag_match_factor * WEIGHT_TAG_MATCH;
    return {
      agent,
      score,
      suggested: false,
      breakdown: {
        workload_factor,
        tag_match_factor,
        open_count: open,
        max_open_count: maxOpen,
        per_opp_tag_match: perOppFactors,
        opp_count: opps.length,
      },
    };
  });

  return _rankAndTagSuggested(scored);
}

export default { scoreAgents, scoreAgentsForOpps, neededTagsForOpp };
