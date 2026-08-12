// RelatedProtectionProgress — mission-control-local, NOT a packages lift.
//
// Wave 34 v3.0.14 (ADR 24 D1/D2/D3/D6) — the Protection twin of
// RelatedInsuranceProgress.jsx. A compact wizard-step timeline that
// surfaces in the CoPilot left ctx pane:
//   - ACTIVE-opp mount — under the active-opp ctx pane when the active
//     opp `type === 'protection' | 'vsc'`. Driven by the live
//     `protectionStepIdx` from ActiveWorkflowContext.
//   - RELATED-opp mount — inside RelatedOppRow for any related opp with
//     `type === 'protection' | 'vsc'`. No live form/index — derives the
//     current step from `opportunity.status` via `stepFromStatus` and
//     reads completed-step timestamps from `step_change` activities.
//
// Visual language is copied verbatim from RelatedInsuranceProgress:
//   - emerald check glyph for `past`, blue spinner for `current`, grey
//     dot for `future`
//   - mono slate-400 timestamp on completed rows
//   - long-form `Month Day, Year` date separators above the FIRST event
//     always, and between adjacent events when their local-day differs
//     (ADR 23 D3 rules, shared with RelatedInsuranceProgress)
//   - per-row hover popovers using the canonical Tooltip pattern
//     (PlanCard MonthlyTooltip — trigger ref + getBoundingClientRect +
//     position:fixed + opacity-transition; native `title=` forbidden per
//     `feedback_tooltip_pattern.md`)
//
// §1 — Why protection differs from insurance.
//   Insurance has a canonical machine_id status taxonomy; protection
//   does NOT (the long-standing "Canon TODO: VSC status taxonomy has no
//   machine_id"). Protection progress is tracked by WIZARD STEP INDEX
//   (`protectionStepIdx` in ActiveWorkflowContext), and protection wrote
//   NO activity rows until Wave 34. The Wave 34 write-through in
//   CoPilotPane.jsx (ADR 24 D4) now appends `step_change` activities +
//   persists `protection_progress` on the opp record, so this timeline
//   has a durable source for related opps + reopens.
//
// §2 — Step list source (ADR 24 D2).
//   The canonical wizard step list comes from `buildProtectionSteps(form)`
//   (protection-portal's `buildSteps` factory). Four steps are
//   conditional on form state: `garage_location`, `customize`,
//   `vin_validate`, `rates_changed`.
//     - ACTIVE opp — call `buildProtectionSteps(protectionForm)` with the
//       LIVE form so conditional steps appear exactly as the running
//       wizard has them.
//     - RELATED opp — there is NO live form. Use the BASE step list
//       (conditionals omitted), unioned with any conditional steps that
//       appear in the opp's persisted `step_change` activity history,
//       re-sorted into the canonical sequence (CANONICAL_STEP_ORDER).
//
// §3 — STEP_LABEL is mc-local (intentional cross-app duplication).
//   protection-portal does NOT export a step-key → human-label map
//   (verified: no STEP_LABEL / stepLabel export anywhere in
//   protection-portal/src). Defining the label map here is acceptable
//   duplication — the SAME rationale RelatedInsuranceProgress uses for
//   its in-file `CAPTURE_AND_QUOTE_PATH` literal. The step KEYS are the
//   contract (they must match protection-portal's BASE_STEPS +
//   buildSteps() return values); the LABELS are display-only. Drift
//   between a new protection step and this map surfaces as a row
//   rendering with its raw key — handled defensively (`STEP_LABEL[key]
//   || key`).
//
// §4 — Hover popovers are LIGHT (ADR 24 D6).
//   Unlike RelatedInsuranceProgress (which surfaces rich per-stage
//   carrier/premium/policy detail blocks), protection has no per-step
//   partner-detail equivalent. The popover carries only: step
//   friendly-label + a one-line step description (STEP_DESCRIPTION) +
//   the completion timestamp. Rich per-step detail (selected plan on
//   `recommended_coverage`, amount on `billing_payment`) is a
//   deliberately deferred future enhancement — NOT Wave 34 scope.
//
// §5 — Actor badge (v3.0.15, ADR 27 D7/D8).
//   Each completed/current step row carries a compact actor badge
//   (Agent / Consumer / System). Protection has no machine_id taxonomy,
//   so the actor comes from the matching `step_change` activity's
//   `source` field — folded through the shared `resolveActorLabel`
//   (a bare `'system'` / missing source on a completed protection step
//   resolves to `agent`, the Phase-1 reality that the agent drives the
//   whole wizard inside the CoPilot). A completed step with no matching
//   activity still renders an Agent badge.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { blinkerApi } from 'blinker-platform/api';
import { track } from 'blinker-platform/telemetry';
import { ActorBadge, resolveActorLabel } from '../lib/timeline-actor.jsx';
import { buildSteps as buildProtectionSteps } from 'protection-portal/src/views/customer/CustomerView.jsx';
import { stepFromStatus } from 'protection-portal/src/lib/status-step-map.js';
import orgRegistry from '../constants/canon/org-registry.json';

// ─── Step keys: canonical order + base list ─────────────────────────────────
//
// CANONICAL_STEP_ORDER is the full superset sequence — every step the
// protection wizard can render, including the four conditionals. It's
// the sort key used to re-order the related-opp step list (base ∪
// activity-history conditionals) into wizard order. Mirrors
// protection-portal CustomerView.jsx's BASE_STEPS + the insertion
// anchors in buildSteps() (garage_location BEFORE recommended_coverage,
// customize BEFORE confirm, vin_validate + rates_changed BEFORE
// docuseal). See §3 for the duplication rationale.
const CANONICAL_STEP_ORDER = [
  'vehicle_add',
  'vehicle_drive',
  'vehicle_use',
  'modifications',
  'garage_location', // conditional
  'recommended_coverage',
  'customize', // conditional
  'confirm',
  'billing_payment',
  'vin_validate', // conditional
  'rates_changed', // conditional
  'docuseal',
  'thank_you',
];

// The non-conditional base list — used as the related-opp starting point
// before unioning in any conditional steps observed in activity history.
const BASE_STEP_KEYS = [
  'vehicle_add',
  'vehicle_drive',
  'vehicle_use',
  'modifications',
  'recommended_coverage',
  'confirm',
  'billing_payment',
  'docuseal',
  'thank_you',
];

const CONDITIONAL_STEP_KEYS = new Set([
  'garage_location',
  'customize',
  'vin_validate',
  'rates_changed',
]);

// Step-key → human label. mc-local; see §3.
const STEP_LABEL = {
  vehicle_add: 'Add vehicle',
  vehicle_drive: 'Driving habits',
  vehicle_use: 'Vehicle use',
  modifications: 'Modifications',
  garage_location: 'Garage location',
  recommended_coverage: 'Recommended coverage',
  customize: 'Customize coverage',
  confirm: 'Review & confirm',
  billing_payment: 'Billing & payment',
  vin_validate: 'VIN validation',
  rates_changed: 'Rates changed',
  docuseal: 'Sign agreements',
  thank_you: 'Complete',
};

// Step-key → one-line description for the light hover popover (ADR 24
// D6). Plain agent-facing copy — no per-step partner detail.
const STEP_DESCRIPTION = {
  vehicle_add: 'Identify the vehicle by VIN or year/make/model/trim.',
  vehicle_drive: 'Capture annual mileage and driving conditions.',
  vehicle_use: 'How the vehicle is used — commute, business, rideshare.',
  modifications: 'Note any aftermarket modifications affecting coverage.',
  garage_location: 'Confirm where the vehicle is garaged for per-state availability.',
  recommended_coverage: 'Review the recommended plan tiers and select one.',
  customize: 'Adjust term, mileage, deductible, and add-ons.',
  confirm: 'Review the selected plan and pricing before sending.',
  billing_payment: 'Collect down payment and set up the payment schedule.',
  vin_validate: 'Post-payment VIN check against the rated vehicle.',
  rates_changed: 'Rates diverged after VIN validation — re-confirm coverage.',
  docuseal: 'Sign the product and payment agreements.',
  thank_you: 'Workflow complete — agreements signed.',
};

// ─── Org timezone + formatters (replicated from RelatedInsuranceProgress) ────

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
// Wave 34 write-through (ADR 24 D4) appends one `step_change` activity
// per newly-completed step, with `payload.completed_step` carrying the
// step KEY. deriveStepTimestamps maps step-key → earliest occurred_at so
// re-fires don't override the original completion time.

function deriveStepTimestamps(activities) {
  const map = {};
  for (const a of activities || []) {
    if (a?.type !== 'step_change') continue;
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

// step-key → `source` of the matching `step_change` activity (v3.0.15,
// ADR 27 D7). Keyed on the SAME step key the timestamp derivation uses
// (`completed_step || to_step`) so the actor and the timestamp resolve
// from the same activity row. Earliest activity wins (mirrors the
// timestamp tie-break) so a re-fire doesn't override the original. The
// raw `source` is folded into a canonical actor by `resolveActorLabel`
// at render time — a missing entry there resolves to `agent`.
function deriveStepSources(activities) {
  const tsMap = {};
  const srcMap = {};
  for (const a of activities || []) {
    if (a?.type !== 'step_change') continue;
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

// Collect conditional step keys observed in the opp's step_change
// activity history — `from_step` AND `to_step` AND `completed_step` are
// all inspected so a conditional step that was merely traversed (not the
// completed one) still surfaces.
function observedConditionalSteps(activities) {
  const found = new Set();
  for (const a of activities || []) {
    if (a?.type !== 'step_change') continue;
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

// ─── Hover popover (canonical Tooltip pattern — light, ADR 24 D6) ───────────
//
// Replicates the trigger-ref + getBoundingClientRect + position:fixed +
// opacity-transition pattern from PlanCard.jsx::MonthlyTooltip. Content
// is light: label + one-line description + timestamp. Placement strategy
// mirrors RelatedInsuranceProgress — open RIGHT of the row by default,
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
  // popover. (Unlike RelatedInsuranceProgress which suppresses popovers
  // on detail-less rows — here the one-line description is the detail.)
  const description = STEP_DESCRIPTION[stepKey] || null;

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

// ─── Date separator (replicated from RelatedInsuranceProgress) ──────────────

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
 * @param {Object} props.opportunity        Protection opportunity record.
 *                                           Carries id + contact_id
 *                                           (activity lookup) + status
 *                                           (related-opp current-step
 *                                           derivation) + optionally
 *                                           protection_progress.
 * @param {'active_opp'|'related_opp'} [props.context]
 *                                           Drives the step-list source +
 *                                           progress source + threads into
 *                                           telemetry. Defaults to
 *                                           'related_opp'.
 * @param {number} [props.currentStepIdx]   ACTIVE-opp only — the live
 *                                           `protectionStepIdx` from
 *                                           ActiveWorkflowContext. Steps
 *                                           with index < it are `past`,
 *                                           == it `current`, > it `future`.
 * @param {Object} [props.protectionForm]   ACTIVE-opp only — the live
 *                                           protection wizard form, fed to
 *                                           `buildProtectionSteps` so
 *                                           conditional steps appear
 *                                           exactly as the running wizard
 *                                           has them.
 * @param {Object} [props.protectionProgress] RELATED-opp fallback — the
 *                                           persisted
 *                                           `opportunity.protection_progress`
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
 *                                           "Open protection CoPilot →".
 *                                           OMITTED for active-opp mounts.
 */
export function RelatedProtectionProgress({
  opportunity,
  context = 'related_opp',
  currentStepIdx = null,
  protectionForm = null,
  protectionProgress = null,
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
  // step-key → `step_change` activity `source` — drives the per-row
  // actor badge (ADR 27 D7).
  const stepSources = useMemo(() => deriveStepSources(activities), [activities]);

  // Step list — ACTIVE uses the live form via buildProtectionSteps;
  // RELATED uses BASE ∪ activity-history conditionals (see §2).
  const steps = useMemo(() => {
    if (context === 'active_opp') {
      try {
        return buildProtectionSteps(protectionForm || {});
      } catch {
        return [...BASE_STEP_KEYS];
      }
    }
    return buildRelatedStepList(activities);
  }, [context, protectionForm, activities]);

  // Org TZ + formatters for date separators + popover timestamps.
  const formatters = useMemo(() => makeFormatters(timezoneForOrg(orgId)), [orgId]);

  // ── Progress state resolution (ADR 24 D3) ──
  //
  // ACTIVE — the live `currentStepIdx` is the freshest pointer. idx <
  //   it → past; == it → current; > it → future.
  // RELATED — derive the current step KEY from `opportunity.status` via
  //   stepFromStatus, then take its index in THIS step list. The
  //   persisted `protection_progress.furthest_step_idx` is used as a
  //   fallback so a sparse activity history still checks off everything
  //   up to the furthest known step.
  const currentIdx = useMemo(() => {
    if (context === 'active_opp') {
      return typeof currentStepIdx === 'number' ? currentStepIdx : 0;
    }
    // related_opp — status → step key → index in this list.
    const stepKey = stepFromStatus(opportunity?.status, 'vehicle_add');
    let idx = steps.indexOf(stepKey);
    if (idx < 0) idx = 0;
    // protection_progress furthest-step fallback: never show LESS
    // progress than the persisted furthest pointer.
    const furthestKey = protectionProgress?.furthest_step_key || null;
    if (furthestKey) {
      const furthestIdx = steps.indexOf(furthestKey);
      // The furthest COMPLETED step means the current step is the one
      // after it (or the furthest itself if it's the last). Use the max
      // of the status-derived idx and the furthest pointer.
      if (furthestIdx > idx) idx = furthestIdx;
    }
    return idx;
  }, [context, currentStepIdx, opportunity?.status, steps, protectionProgress]);

  // For related opps: any step with a recorded step_change timestamp is
  // `past` even if it sits at/after currentIdx (defensive — activity
  // history is authoritative for completion).
  const observedKeys = useMemo(() => new Set(Object.keys(timestamps)), [timestamps]);

  function stepState(idx, key) {
    if (idx < currentIdx) return 'past';
    if (idx === currentIdx) {
      // A current-index step that ALSO has a completion timestamp is
      // treated as past (the wizard moved on but idx hasn't caught up —
      // rare, but keeps the glyph honest).
      return observedKeys.has(key) ? 'past' : 'current';
    }
    return observedKeys.has(key) ? 'past' : 'future';
  }

  // Telemetry — `viewed` once per mount (ref-gated).
  useEffect(() => {
    if (viewedRef.current) return;
    if (!oppId) return;
    viewedRef.current = true;
    track('mc.copilot.protection_progress.viewed', {
      context,
      opp_id: oppId,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oppId]);

  function handleHoverFirstView(stepKey) {
    if (hoverFiredRef.current.has(stepKey)) return;
    hoverFiredRef.current.add(stepKey);
    track('mc.copilot.protection_progress.hover_detail_viewed', {
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

    const label = STEP_LABEL[key] || key;
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
            {/* Actor badge (ADR 27 D7/D8) — protection actor comes from
                the matching step_change activity `source`, folded into
                a canonical actor by resolveActorLabel (missing/`system`
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
      {/* "Open protection CoPilot →" affordance — gated on
          `onOpenInCoPilot` being passed. ACTIVE-opp mounts intentionally
          omit the prop (the agent is already on this opp). RELATED-opp
          mounts pass it through OpportunityContextPane → RelatedOppRow. */}
      {onOpenInCoPilot && (
        <button
          type="button"
          onClick={() => onOpenInCoPilot(opportunity.id)}
          className="mt-2 text-[11px] font-medium text-blue-600 hover:text-blue-800 hover:underline"
        >
          Open protection CoPilot →
        </button>
      )}
    </div>
  );
}
