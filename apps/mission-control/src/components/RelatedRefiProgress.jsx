// RelatedRefiProgress — mission-control-local, NOT a packages lift.
//
// Wave 35 v3.0.15 (ADR 25 D1/D2/D3/D6) — the Refi twin of
// RelatedProtectionProgress.jsx / RelatedInsuranceProgress.jsx. A compact
// wizard-step timeline that surfaces in the CoPilot left ctx pane:
//   - ACTIVE-opp mount — under the active-opp ctx pane when the active
//     opp `type === 'refi'`. Driven by the live `refiStepIdx` from
//     ActiveWorkflowContext.
//   - RELATED-opp mount — inside RelatedOppRow for any related opp with
//     `type === 'refi'`. No live form/index — derives the current step
//     from `opportunity.status` via `stepFromStatus` and reads
//     completed-step timestamps from `step_change` activities.
//
// Visual language is copied verbatim from RelatedProtectionProgress:
//   - emerald check glyph for `past`, blue spinner for `current`, grey
//     dot for `future`
//   - mono slate-400 timestamp on completed rows
//   - long-form `Month Day, Year` date separators above the FIRST event
//     always, and between adjacent events when their local-day differs
//     (ADR 23 D3 rules, shared with RelatedProtectionProgress)
//   - per-row hover popovers using the canonical Tooltip pattern
//     (PlanCard MonthlyTooltip — trigger ref + getBoundingClientRect +
//     position:fixed + opacity-transition; native `title=` forbidden per
//     `feedback_tooltip_pattern.md`)
//
// §1 — Why refi tracks progress by step index.
//   Refi has DISPLAY-NAME statuses only — no machine_id taxonomy (same
//   shape as protection). Refi progress is tracked by a wizard STEP INDEX
//   (`refiStepIdx` in ActiveWorkflowContext), and refi wrote NO activity
//   rows until Wave 35. The Wave 35 write-through in CoPilotPane.jsx
//   (ADR 25 D4) now appends `step_change` activities + persists
//   `refi_progress` on the opp record, so this timeline has a durable
//   source for related opps + reopens.
//
// §2 — Step list source (ADR 25 D2).
//   The canonical wizard step list comes from `getSequence(form, hasCoApp)`
//   in `refi-portal/src/lib/refi.js`. The sequence has two form-dependent
//   variations: (a) poor-credit (`creditBand === '300_579'`) reorders the
//   co-applicant decision/detail screens AHEAD of the primary-applicant
//   block; (b) the two `s1_co_app_*` detail screens append only when
//   `hasCoApp === true`.
//     - ACTIVE opp — call `getSequence(refiForm, hasCoApp)` with the LIVE
//       form so conditional ordering + co-app screens match the running
//       wizard. `hasCoApp` is derived the same way refi.js itself does
//       it: `form.hasCoApplicant === true` (mirrors refi-portal AgentView
//       + CoPilotPane's `refiIndexFromStatus`).
//     - RELATED opp — there is NO live form. Use the standard-order,
//       no-co-app base sequence as CANONICAL_STEP_ORDER, unioned with any
//       co-app / reordered steps observed in the opp's `step_change`
//       activity history, re-sorted into CANONICAL_STEP_ORDER. Same
//       approach as RelatedProtectionProgress D2.
//
// §3 — REFI_STEP_LABEL is mc-local (intentional cross-app duplication).
//   refi-portal does NOT export a step-key → human-label map (the monolith
//   has SCREEN_LABELS but `refi.js` exports none). Defining the label map
//   here is acceptable duplication — the SAME rationale
//   RelatedProtectionProgress uses for its in-file STEP_LABEL map. The
//   step KEYS are the contract (they must match getSequence() return
//   values); the LABELS are display-only. Drift between a new refi step
//   and this map surfaces as a row rendering with its raw key — handled
//   defensively (`REFI_STEP_LABEL[key] || key`).
//
// §4 — Hover popovers are LIGHT (ADR 25 D6).
//   The popover carries only: step friendly-label + a one-line step
//   description (REFI_STEP_DESCRIPTION) + the completion timestamp. Rich
//   per-step detail (e.g. selected offer on `stage2_result`, decision
//   reason on `decision_engine`) is a deliberately deferred future
//   enhancement — NOT Wave 35 scope.
//
// §5 — Actor badge (v3.0.15, ADR 27 D7/D8).
//   Each completed/current step row carries a compact actor badge
//   (Agent / Consumer / System). Refi has no machine_id taxonomy, so the
//   actor comes from the matching `step_change` activity's `source`
//   field — folded through the shared `resolveActorLabel` (a bare
//   `'system'` / missing source on a completed refi step resolves to
//   `agent`, the Phase-1 reality that the agent drives the whole wizard
//   inside the CoPilot). A completed step with no matching activity
//   still renders an Agent badge.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { blinkerApi } from 'blinker-platform/api';
import { track } from 'blinker-platform/telemetry';
import { ActorBadge, resolveActorLabel } from '../lib/timeline-actor.jsx';
import { getSequence } from 'refi-portal/src/lib/refi';
import { stepFromStatus } from 'refi-portal/src/lib/status-step-map.js';
import orgRegistry from '../constants/canon/org-registry.json';

// ─── Step keys: canonical order + base list ─────────────────────────────────
//
// CANONICAL_STEP_ORDER is the full superset sequence — every step the
// refi wizard can render, including the co-app detail screens. It's the
// sort key used to re-order the related-opp step list (base ∪
// activity-history co-app/reorder steps) into wizard order. Mirrors
// `getSequence()` in refi-portal/src/lib/refi.js — the middle block here
// uses the STANDARD (non-poor-credit) ordering with the co-app screens
// inline in their standard position. See §3 for the duplication rationale.
const CANONICAL_STEP_ORDER = [
  'vehicle_add',
  'vehicle_drive',
  's1_ownership',
  's1_auto_loan',
  's1_credit',
  's1_applicant',
  's1_housing',
  's1_employment',
  's1_co_app_decision', // conditional ordering (poor credit moves earlier)
  's1_co_app_contact', // conditional — appends only when hasCoApp
  's1_co_app_employment', // conditional — appends only when hasCoApp
  's1_identity_consent',
  'decision_engine',
  'stage2_result',
];

// The base related-opp step list — the standard-order, no-co-app
// sequence. `getSequence({}, false)` produces exactly this (poor-credit
// reorder + co-app detail screens both omitted). Used as the related-opp
// starting point before unioning in any co-app steps observed in
// activity history.
const BASE_STEP_KEYS = getSequence({}, false);

// Co-app detail screens — observed in activity history (related-opp) they
// get unioned into the base list. `s1_co_app_decision` is in BASE already
// (it's always present); the two detail screens are the conditional ones.
const CONDITIONAL_STEP_KEYS = new Set([
  's1_co_app_contact',
  's1_co_app_employment',
]);

// Step-key → human label. mc-local; see §3.
const REFI_STEP_LABEL = {
  vehicle_add: 'Add vehicle',
  vehicle_drive: 'Driving habits',
  s1_ownership: 'Ownership',
  s1_auto_loan: 'Auto loan',
  s1_credit: 'Credit',
  s1_applicant: 'Applicant',
  s1_housing: 'Housing',
  s1_employment: 'Employment',
  s1_co_app_decision: 'Co-applicant',
  s1_co_app_contact: 'Co-applicant contact',
  s1_co_app_employment: 'Co-applicant employment',
  s1_identity_consent: 'Identity & consent',
  decision_engine: 'Prequalification',
  stage2_result: 'Offers',
};

// Step-key → one-line description for the light hover popover (ADR 25
// D6). Plain agent-facing copy — no per-step partner detail.
const REFI_STEP_DESCRIPTION = {
  vehicle_add: 'Identify the vehicle by VIN or year/make/model/trim.',
  vehicle_drive: 'Capture annual mileage and driving conditions.',
  s1_ownership: 'Confirm ownership status and remaining lien eligibility.',
  s1_auto_loan: 'Snapshot the current auto loan — lender, payoff, payment.',
  s1_credit: 'Capture the self-reported credit band.',
  s1_applicant: 'Collect primary applicant identity and contact details.',
  s1_housing: 'Capture current housing — rent or own, monthly cost.',
  s1_employment: 'Capture employment type, employer, and income.',
  s1_co_app_decision: 'Decide whether to add a co-applicant to the application.',
  s1_co_app_contact: 'Collect the co-applicant identity and contact details.',
  s1_co_app_employment: 'Capture co-applicant employment and income.',
  s1_identity_consent: 'Confirm identity and capture prequal consent.',
  decision_engine: 'Submit to the lending partner for a prequalification decision.',
  stage2_result: 'Review returned offers, pre-approval, or decline.',
};

// ─── Org timezone + formatters (replicated from RelatedProtectionProgress) ───

function timezoneForOrg(orgId) {
  if (orgId == null) return undefined;
  const org = orgRegistry?.orgs?.find((o) => o.id === orgId);
  return org?.timezone || undefined;
}

function makeFormatters(timezone) {
  const tz = timezone || undefined; // undefined → browser-local
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  // sv-SE formats as YYYY-MM-DD — stable day-grouping key.
  const dayKey = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return { time, day, dayKey };
}

function formatTime(at, formatters) {
  if (!at) return null;
  try {
    return formatters.time.format(new Date(at));
  } catch {
    return null;
  }
}

// ─── step_change activity helpers ───────────────────────────────────────────
//
// Wave 35 write-through (ADR 25 D4) appends one `step_change` activity
// per newly-completed step, with `payload.completed_step` carrying the
// step KEY and `payload.workflow_type === 'refi'`. deriveStepTimestamps
// maps step-key → earliest occurred_at so re-fires don't override the
// original completion time. Refi-only rows are kept (a contact can carry
// protection + refi opps; we filter to `workflow_type === 'refi'`).

function refiStepChanges(activities) {
  return (activities || []).filter(
    (a) => a?.type === 'step_change' && a?.payload?.workflow_type === 'refi',
  );
}

function deriveStepTimestamps(activities) {
  const map = {};
  for (const a of refiStepChanges(activities)) {
    const key = a?.payload?.completed_step || a?.payload?.to_step || null;
    if (!key) continue;
    const at = a.occurred_at;
    if (!at) continue;
    if (!map[key] || String(at) < String(map[key])) {
      map[key] = at;
    }
  }
  return map;
}

// step-key → `source` of the matching refi `step_change` activity
// (v3.0.15, ADR 27 D7). Keyed on the SAME step key the timestamp
// derivation uses (`completed_step || to_step`) so the actor and the
// timestamp resolve from the same activity row. Earliest activity wins
// (mirrors the timestamp tie-break). The raw `source` is folded into a
// canonical actor by `resolveActorLabel` at render time — a missing
// entry there resolves to `agent`.
function deriveStepSources(activities) {
  const tsMap = {};
  const srcMap = {};
  for (const a of refiStepChanges(activities)) {
    const key = a?.payload?.completed_step || a?.payload?.to_step || null;
    if (!key) continue;
    const at = a.occurred_at;
    if (!at) continue;
    if (!tsMap[key] || String(at) < String(tsMap[key])) {
      tsMap[key] = at;
      srcMap[key] = a.source || null;
    }
  }
  return srcMap;
}

// Collect conditional step keys observed in the opp's refi step_change
// activity history — `from_step` AND `to_step` AND `completed_step` are
// all inspected so a co-app step that was merely traversed (not the
// completed one) still surfaces.
function observedConditionalSteps(activities) {
  const found = new Set();
  for (const a of refiStepChanges(activities)) {
    const p = a?.payload || {};
    for (const k of [p.from_step, p.to_step, p.completed_step]) {
      if (k && CONDITIONAL_STEP_KEYS.has(k)) found.add(k);
    }
  }
  return found;
}

// Build the related-opp step list: BASE ∪ (conditionals observed in
// activity history), re-sorted into CANONICAL_STEP_ORDER. See §2.
function buildRelatedStepList(activities) {
  const keys = new Set(BASE_STEP_KEYS);
  for (const k of observedConditionalSteps(activities)) keys.add(k);
  return CANONICAL_STEP_ORDER.filter((k) => keys.has(k));
}

// ─── Hover popover (canonical Tooltip pattern — light, ADR 25 D6) ───────────
//
// Replicates the trigger-ref + getBoundingClientRect + position:fixed +
// opacity-transition pattern from PlanCard.jsx::MonthlyTooltip. Content
// is light: label + one-line description + timestamp. Placement strategy
// mirrors RelatedProtectionProgress — open RIGHT of the row by default,
// fall back to LEFT when it would clip the right viewport edge.

const POPOVER_WIDTH = 260; // px — matches width below
const POPOVER_MARGIN = 12; // px — viewport edge breathing room

function StepRowPopover({
  stepKey,
  label,
  state,
  timestamp,
  formatters,
  onFirstHover,
  children,
}) {
  const triggerRef = useRef(null);
  const trackedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, transform: 'none' });

  function show() {
    if (open) return;
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) {
      const wantsRight = r.right + POPOVER_WIDTH + POPOVER_MARGIN <= window.innerWidth;
      if (wantsRight) {
        setCoords({ top: r.top, left: r.right + 8, transform: 'none' });
      } else {
        setCoords({ top: r.top, left: r.left - 8, transform: 'translateX(-100%)' });
      }
    }
    setOpen(true);
    if (!trackedRef.current) {
      trackedRef.current = true;
      if (typeof onFirstHover === 'function') onFirstHover(stepKey);
    }
  }
  function hide() {
    setOpen(false);
  }

  // Every row has at least a label + description, so every row gets a
  // popover — the one-line description is the detail.
  const description = REFI_STEP_DESCRIPTION[stepKey] || null;

  return (
    <span className="relative inline-flex w-full">
      <span
        ref={triggerRef}
        tabIndex={0}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="inline-flex w-full cursor-help"
      >
        {children}
      </span>
      <span
        role="tooltip"
        style={{
          position: 'fixed',
          top: coords.top,
          left: coords.left,
          transform: coords.transform,
          width: POPOVER_WIDTH,
        }}
        className={
          'z-[60] max-w-[260px] px-3 py-2 rounded-md border border-slate-200 bg-white shadow-lg text-xs text-slate-900 leading-snug transition-opacity ' +
          (open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none')
        }
      >
        <div className="text-[11px] font-semibold text-slate-900 mb-1">{label}</div>
        {description && (
          <div className="text-[11px] text-slate-600 mb-1">{description}</div>
        )}
        {timestamp && formatters && (
          <div className="text-[10px] text-slate-400 font-mono">
            Completed {formatTime(timestamp, formatters)}
          </div>
        )}
        {!timestamp && state === 'current' && (
          <div className="text-[10px] text-blue-600">In progress</div>
        )}
        {!timestamp && state === 'future' && (
          <div className="text-[10px] text-slate-400">Not started</div>
        )}
      </span>
    </span>
  );
}

// ─── Date separator (replicated from RelatedProtectionProgress) ─────────────

function DateSeparator({ label }) {
  return (
    <li
      className="pl-5 mt-1.5 mb-0.5 text-[10px] uppercase tracking-wider font-semibold text-slate-500"
      aria-label={`Date: ${label}`}
    >
      {label}
    </li>
  );
}

/**
 * @param {Object} props
 * @param {Object} props.opportunity        Refi opportunity record.
 *                                           Carries id + contact_id
 *                                           (activity lookup) + status
 *                                           (related-opp current-step
 *                                           derivation) + optionally
 *                                           refi_progress.
 * @param {'active_opp'|'related_opp'} [props.context]
 *                                           Drives the step-list source +
 *                                           progress source + threads into
 *                                           telemetry. Defaults to
 *                                           'related_opp'.
 * @param {number} [props.currentStepIdx]   ACTIVE-opp only — the live
 *                                           `refiStepIdx` from
 *                                           ActiveWorkflowContext. Steps
 *                                           with index < it are `past`,
 *                                           == it `current`, > it `future`.
 * @param {Object} [props.refiForm]         ACTIVE-opp only — the live refi
 *                                           wizard form, fed to
 *                                           `getSequence` so conditional
 *                                           ordering + co-app screens
 *                                           appear exactly as the running
 *                                           wizard has them. `hasCoApp` is
 *                                           derived from
 *                                           `refiForm.hasCoApplicant`.
 * @param {Object} [props.refiProgress]     RELATED-opp fallback — the
 *                                           persisted
 *                                           `opportunity.refi_progress`
 *                                           ({ furthest_step_idx,
 *                                           furthest_step_key, updated_at }).
 *                                           Used as the furthest-step
 *                                           pointer when step_change
 *                                           activity history is sparse.
 * @param {number} [props.orgId]            Drives `timezoneForOrg()` for
 *                                           date-separator local-day
 *                                           grouping. Falls back to
 *                                           browser-local TZ when absent.
 * @param {function} [props.onOpenInCoPilot] RELATED-opp only — called with
 *                                           (oppId) when the agent clicks
 *                                           "Open refi CoPilot →". OMITTED
 *                                           for active-opp mounts.
 */
export function RelatedRefiProgress({
  opportunity,
  context = 'related_opp',
  currentStepIdx = null,
  refiForm = null,
  refiProgress = null,
  orgId = null,
  onOpenInCoPilot,
}) {
  const viewedRef = useRef(false);
  // First hover-open per step row per mount — gates the hover telemetry.
  const hoverFiredRef = useRef(new Set());
  const oppId = opportunity?.id;
  const contactId = opportunity?.contact_id;

  // Activity history (step_change rows) — localStorage-backed, contact-
  // keyed. Memoized so it isn't re-read on every parent re-render.
  const activities = useMemo(() => {
    if (!oppId || !contactId) return [];
    return blinkerApi.activities.list({
      contact_id: contactId,
      opportunity_id: oppId,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oppId, contactId, currentStepIdx]);

  const timestamps = useMemo(() => deriveStepTimestamps(activities), [activities]);
  // step-key → refi `step_change` activity `source` — drives the
  // per-row actor badge (ADR 27 D7).
  const stepSources = useMemo(() => deriveStepSources(activities), [activities]);

  // Step list — ACTIVE uses the live form via getSequence; RELATED uses
  // BASE ∪ activity-history conditionals (see §2).
  const steps = useMemo(() => {
    if (context === 'active_opp') {
      try {
        const f = refiForm || {};
        return getSequence(f, f.hasCoApplicant === true);
      } catch {
        return [...BASE_STEP_KEYS];
      }
    }
    return buildRelatedStepList(activities);
  }, [context, refiForm, activities]);

  // Org TZ + formatters for date separators + popover timestamps.
  const formatters = useMemo(() => makeFormatters(timezoneForOrg(orgId)), [orgId]);

  // ── Progress state resolution (ADR 25 D3) ──
  //
  // ACTIVE — the live `currentStepIdx` is the freshest pointer. idx <
  //   it → past; == it → current; > it → future.
  // RELATED — derive the current step KEY from `opportunity.status` via
  //   stepFromStatus, then take its index in THIS step list. The
  //   persisted `refi_progress.furthest_step_key` is used as a fallback
  //   so a sparse activity history still checks off everything up to the
  //   furthest known step.
  const currentIdx = useMemo(() => {
    if (context === 'active_opp') {
      return typeof currentStepIdx === 'number' ? currentStepIdx : 0;
    }
    // related_opp — status → step key → index in this list.
    const stepKey = stepFromStatus(opportunity?.status, 'vehicle_add');
    let idx = steps.indexOf(stepKey);
    if (idx < 0) idx = 0;
    // refi_progress furthest-step fallback: never show LESS progress than
    // the persisted furthest pointer.
    const furthestKey = refiProgress?.furthest_step_key || null;
    if (furthestKey) {
      const furthestIdx = steps.indexOf(furthestKey);
      if (furthestIdx > idx) idx = furthestIdx;
    }
    return idx;
  }, [context, currentStepIdx, opportunity?.status, steps, refiProgress]);

  // For related opps: any step with a recorded step_change timestamp is
  // `past` even if it sits at/after currentIdx (defensive — activity
  // history is authoritative for completion).
  const observedKeys = useMemo(() => new Set(Object.keys(timestamps)), [timestamps]);

  function stepState(idx, key) {
    if (idx < currentIdx) return 'past';
    if (idx === currentIdx) {
      return observedKeys.has(key) ? 'past' : 'current';
    }
    return observedKeys.has(key) ? 'past' : 'future';
  }

  // Telemetry — `viewed` once per mount (ref-gated).
  useEffect(() => {
    if (viewedRef.current) return;
    if (!oppId) return;
    viewedRef.current = true;
    track('mc.copilot.refi_progress.viewed', {
      context,
      opp_id: oppId,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oppId]);

  function handleHoverFirstView(stepKey) {
    if (hoverFiredRef.current.has(stepKey)) return;
    hoverFiredRef.current.add(stepKey);
    track('mc.copilot.refi_progress.hover_detail_viewed', {
      step_key: stepKey,
      opp_id: oppId,
    });
  }

  // ── Build the row list with date separators interleaved (ADR 23 D3) ──
  //   - A long-form separator above the FIRST row always.
  //   - Between adjacent past rows when their local-day differs.
  //   - Future / current rows (no timestamp) don't anchor a day — they
  //     sit under the last-known separator implicitly.
  let lastDayKey = null;
  let firstSeparatorEmitted = false;
  const rows = [];
  for (let i = 0; i < steps.length; i++) {
    const key = steps[i];
    const ts = timestamps[key];
    const state = stepState(i, key);

    if (ts && state === 'past') {
      const k = formatters.dayKey.format(new Date(ts));
      if (k !== lastDayKey) {
        rows.push(
          <DateSeparator
            key={`day-${k}-${i}`}
            label={formatters.day.format(new Date(ts))}
          />
        );
        lastDayKey = k;
        firstSeparatorEmitted = true;
      }
    } else if (!firstSeparatorEmitted && i === 0) {
      // No past timestamps yet — emit a "today" separator so the rail
      // always opens date-anchored (ADR 23 D3 "always show first").
      const now = new Date();
      const k = formatters.dayKey.format(now);
      rows.push(
        <DateSeparator key={`day-${k}-init`} label={formatters.day.format(now)} />
      );
      lastDayKey = k;
      firstSeparatorEmitted = true;
    }

    const label = REFI_STEP_LABEL[key] || key;
    rows.push(
      <li key={key} className="text-[11px]">
        <StepRowPopover
          stepKey={key}
          label={label}
          state={state}
          timestamp={ts}
          formatters={formatters}
          onFirstHover={handleHoverFirstView}
        >
          <span className="flex items-center gap-2 w-full">
            <span
              className={
                'w-3.5 h-3.5 rounded-full inline-flex items-center justify-center shrink-0 ' +
                (state === 'past'
                  ? 'bg-emerald-500 text-white'
                  : state === 'current'
                    ? 'bg-blue-500 text-white'
                    : 'bg-slate-200 text-slate-300')
              }
            >
              {state === 'past' ? (
                <Check className="w-2.5 h-2.5" strokeWidth={3} />
              ) : state === 'current' ? (
                <Loader2 className="w-2 h-2 animate-spin" />
              ) : null}
            </span>
            <span
              className={
                'flex-1 truncate ' +
                (state === 'future' ? 'text-slate-400' : 'text-slate-700')
              }
            >
              {label}
            </span>
            {/* Actor badge (ADR 27 D7/D8) — refi actor comes from the
                matching step_change activity `source`, folded into a
                canonical actor by resolveActorLabel (missing/`system`
                source on a completed step → Agent). Completed/current
                rows only. */}
            {state !== 'future' && (
              <ActorBadge actor={resolveActorLabel(stepSources[key], state)} />
            )}
            {ts && (
              <span className="text-[10px] text-slate-400 font-mono shrink-0">
                {formatTime(ts, formatters)}
              </span>
            )}
          </span>
        </StepRowPopover>
      </li>
    );
  }

  // For ACTIVE-opp mounts the parent (OpportunityContextPane) renders a
  // SectionLabel ("Workflow progress") above this component — suppress
  // the inner header to avoid the duplicate. RELATED-opp mounts have no
  // parent SectionLabel — keep the inner header + top-border divider.
  const showInnerHeader = context !== 'active_opp';
  const wrapperClass =
    context === 'active_opp' ? '' : 'mt-2 pt-2 border-t border-slate-200/60';

  return (
    <div className={wrapperClass}>
      {showInnerHeader && (
        <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 mb-1.5">
          Workflow progress
        </div>
      )}
      <ul className="space-y-0.5">{rows}</ul>
      {/* "Open refi CoPilot →" affordance — gated on `onOpenInCoPilot`
          being passed. ACTIVE-opp mounts intentionally omit the prop
          (the agent is already on this opp). RELATED-opp mounts pass it
          through OpportunityContextPane → RelatedOppRow. */}
      {onOpenInCoPilot && (
        <button
          type="button"
          onClick={() => onOpenInCoPilot(opportunity.id)}
          className="mt-2 text-[11px] font-medium text-blue-600 hover:text-blue-800 hover:underline"
        >
          Open refi CoPilot →
        </button>
      )}
    </div>
  );
}
