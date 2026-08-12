// timeline-actor — shared actor-attribution helper for the three CoPilot
// left-rail workflow-progress timelines (RelatedInsuranceProgress /
// RelatedProtectionProgress / RelatedRefiProgress).
//
// Added v3.0.15 (ADR 27 D7/D8). The badge logic + styling is identical
// across all three timelines, so it lives here once rather than being
// triplicated. mc-local ONLY — NOT a packages lift (the timeline
// components themselves stay mc-local per ADR 24/25, and so does this).
//
// `actor` answers "who, in Agent / Consumer / System terms, performed
// this step":
//   - Insurance — comes from canon `ghl-status.json insurance.statuses[].actor`
//     (a static per-status property; the EI flow is deterministic). Each
//     insurance timeline row maps to a machine_id; the consumer builds a
//     machine_id → actor lookup from canon and passes the resolved actor
//     string straight into `<ActorBadge actor=... />`.
//   - Protection / refi — no machine_id taxonomy; the actor comes from the
//     matching `step_change` activity's `source` field. Pass that raw
//     `source` value through `resolveActorLabel(source, state)` first —
//     it folds `'system'` / missing / unknown into `'agent'` for a
//     completed/current protection-or-refi step (the Phase-1 reality is
//     the agent drives the whole wizard inside the CoPilot; a bare
//     `'system'` on these activities is just the old write-through
//     provenance label, not a real actor signal). Only a real
//     `'consumer'` source — arriving with the Phase-2 back-channel —
//     renders differently.
//
// Future (grey) rows render NO badge — callers gate on row state before
// rendering <ActorBadge>.

// Resolve a protection/refi `step_change` activity `source` (or a bare
// canon `actor`) into one of the three canonical actor labels.
//
//   source === 'consumer' → 'consumer'
//   source === 'agent'    → 'agent'
//   source === 'system' | missing | unknown, for a completed/current
//     step → 'agent'  (Phase-1 agent-driven default; see file header)
//
// `state` is the row state ('past' | 'current' | 'future'). Future rows
// should not call this — callers gate first — but it returns null
// defensively if asked.
export function resolveActorLabel(source, state) {
  if (state === 'future') return null;
  if (source === 'consumer') return 'consumer';
  if (source === 'agent') return 'agent';
  // 'system', missing, or any unrecognized value → agent (Phase-1
  // default for a completed/current protection-or-refi step).
  return 'agent';
}

// Per-actor pill styling. Muted backgrounds so the chip reads as a
// glanceable annotation, not a loud status.
const ACTOR_STYLE = {
  system: 'bg-slate-100 text-slate-600',
  agent: 'bg-blue-100 text-blue-700',
  consumer: 'bg-emerald-100 text-emerald-700',
};

// Compact uppercase tracking-wide actor pill. Rendered inline on a
// completed/current timeline row, AFTER the step label and BEFORE the
// timestamp. Renders nothing for an unknown / missing actor (so an
// insurance machine_id with no canon `actor` shows no badge per ADR 27).
export function ActorBadge({ actor }) {
  if (!actor || !ACTOR_STYLE[actor]) return null;
  return (
    <span
      className={
        'shrink-0 px-1 py-px rounded text-[8px] font-semibold uppercase tracking-wide ' +
        ACTOR_STYLE[actor]
      }
    >
      {actor}
    </span>
  );
}
