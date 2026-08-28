// RelatedHomeProtectionProgress — mission-control-local, NOT a packages lift.
//
// Wave 39 (ADR 30 D4/C4) — the Home Protection twin of
// RelatedProtectionProgress.jsx. Cloned wholesale from that file; only the
// step set, source imports, and telemetry/label strings differ. A compact
// wizard-step timeline that surfaces in the CoPilot left ctx pane:
//   - ACTIVE-opp mount — under the active-opp ctx pane when the active opp
//     `type === 'home_protection'`. Driven by the live `homeStepIdx` owned
//     locally by CoPilotPane's HomeProtectionEmbed (NOT lifted onto
//     ActiveWorkflowContext — see HomeProtectionEmbed's header comment).
//   - RELATED-opp mount — inside RelatedOppRow for any related opp with
//     `type === 'home_protection'`. No live form/index — derives the
//     current step from `opportunity.status` via `stepFromStatus` and
//     reads completed-step timestamps from `step_change` activities.
//
// Visual language, popover mechanics, and date-separator rules are
// unchanged from RelatedProtectionProgress — see that file's header for
// the full rationale (§1–§5). Only the differences are called out here:
//
//   - Step list source: `buildSteps` from
//     `home-protection-portal/src/views/customer/CustomerView.jsx` and
//     `stepFromStatus` from `home-protection-portal/src/lib/status-step-map.js`,
//     not protection-portal's.
//   - Two conditional steps only: `customize` and `optional_coverages`
//     (home has no VIN-validation-equivalent — no `vin_validate` /
//     `rates_changed` twin exists for a home).
//   - The persisted furthest-step fallback field is
//     `opportunity.home_protection_progress` (not `protection_progress`).
//   - Telemetry event namespace is `mc.copilot.home_protection_progress.*`.
//
// STEP_LABEL here MUST stay in sync with HOME_PROTECTION_STEP_LABEL in
// CoPilotPane.jsx (same cross-file-duplication rationale documented on
// both maps — the step KEYS are the contract, the LABELS are display-only;
// the portal exports no step-label map). Update all three places (this
// file, CoPilotPane.jsx's HOME_PROTECTION_STEP_LABEL, and — if a step is
// renamed — home-protection-portal's own step key) together.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { blinkerApi } from 'blinker-platform/api';
import { track } from 'blinker-platform/telemetry';
import { ActorBadge, resolveActorLabel } from '../lib/timeline-actor.jsx';
import { buildSteps as buildHomeProtectionSteps } from 'home-protection-portal/src/views/customer/CustomerView.jsx';
import { stepFromStatus } from 'home-protection-portal/src/lib/status-step-map.js';
import orgRegistry from '../constants/canon/org-registry.json';

// ─── Step keys: canonical order + base list ─────────────────────────────────
//
// CANONICAL_STEP_ORDER is the full superset sequence buildSteps() can
// return, including the two conditionals. Mirrors home-protection-portal
// CustomerView.jsx's BASE_STEPS + buildSteps()'s insertion anchor: a plan
// change in Customize must not silently invalidate an add-on selection, so
// `customize` sits BEFORE `optional_coverages` — the portal's deliberate
// deviation from the plan doc's literal wording (see home-protection-portal
// CustomerView.jsx comment).
const CANONICAL_STEP_ORDER = [
  'home_add',
  'home_features',
  'recommended_coverage',
  'customize', // conditional
  'optional_coverages', // conditional — dropped entirely for monthly plans
  'confirm',
  'billing_payment',
  'docuseal',
  'thank_you',
];

// The non-conditional base list — used as the related-opp starting point
// before unioning in any conditional steps observed in activity history.
const BASE_STEP_KEYS = [
  'home_add',
  'home_features',
  'recommended_coverage',
  'confirm',
  'billing_payment',
  'docuseal',
  'thank_you',
];

const CONDITIONAL_STEP_KEYS = new Set(['customize', 'optional_coverages']);

// Step-key → human label. mc-local; see file header — MUST stay in sync
// with CoPilotPane.jsx's HOME_PROTECTION_STEP_LABEL.
const STEP_LABEL = {
  home_add: 'Add home',
  home_features: 'Home features',
  recommended_coverage: 'Recommended coverage',
  customize: 'Customize',
  optional_coverages: 'Optional coverages',
  confirm: 'Review & confirm',
  billing_payment: 'Billing & payment',
  docuseal: 'Sign agreements',
  thank_you: 'Complete',
};

// Step-key → one-line description for the light hover popover. Plain
// agent-facing copy — no per-step partner detail (mirrors protection's
// ADR 24 D6 rationale).
const STEP_DESCRIPTION = {
  home_add: 'Capture the covered property — type, address, year built, square footage.',
  home_features: 'Answer whether the home has a pool, well, septic, and other higher-level questions.',
  recommended_coverage: 'Review the recommended plan tiers and select one.',
  customize: 'Adjust plan term and structure (fixed-term vs. monthly).',
  optional_coverages: 'Select priced optional coverages for the chosen plan and term.',
  confirm: 'Review the selected plan, add-ons, and pricing before sending.',
  billing_payment: 'Collect down payment and set up the payment schedule.',
  docuseal: 'Sign the home agreement.',
  thank_you: 'Workflow complete — agreement signed.',
};

// ─── Org timezone + formatters (replicated from RelatedProtectionProgress) ──

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
// HomeProtectionEmbed's write-through (Wave 39, CoPilotPane.jsx) appends one
// `step_change` activity per newly-completed step, with
// `payload.completed_step` carrying the step KEY and
// `payload.workflow_type: 'home_protection'`. deriveStepTimestamps maps
// step-key → earliest occurred_at so re-fires don't override the original
// completion time.

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

// step-key → `source` of the matching `step_change` activity (ADR 27 D7).
// Keyed on the SAME step key the timestamp derivation uses so the actor and
// the timestamp resolve from the same activity row. The raw `source` is
// folded into a canonical actor by `resolveActorLabel` at render time — a
// missing entry there resolves to `agent`.
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

// Collect conditional step keys observed in the opp's step_change activity
// history — `from_step` AND `to_step` AND `completed_step` are all
// inspected so a conditional step that was merely traversed (not the
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
// activity history), re-sorted into CANONICAL_STEP_ORDER.
function buildRelatedStepList(activities) {
  const keys = new Set(BASE_STEP_KEYS);
  for (const k of observedConditionalSteps(activities)) keys.add(k);
  return CANONICAL_STEP_ORDER.filter((k) => keys.has(k));
}

// ─── Hover popover (canonical Tooltip pattern — light) ──────────────────────
//
// Replicates the trigger-ref + getBoundingClientRect + position:fixed +
// opacity-transition pattern from PlanCard.jsx::MonthlyTooltip. Content is
// light: label + one-line description + timestamp. Placement strategy
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
  // popover.
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
 * @param {Object} props.opportunity        Home protection opportunity
 *                                           record. Carries id + contact_id
 *                                           (activity lookup) + status
 *                                           (related-opp current-step
 *                                           derivation) + optionally
 *                                           home_protection_progress.
 * @param {'active_opp'|'related_opp'} [props.context]
 *                                           Drives the step-list source +
 *                                           progress source + threads into
 *                                           telemetry. Defaults to
 *                                           'related_opp'.
 * @param {number} [props.currentStepIdx]   ACTIVE-opp only — the live
 *                                           homeStepIdx owned by
 *                                           HomeProtectionEmbed. Steps with
 *                                           index < it are `past`, == it
 *                                           `current`, > it `future`.
 * @param {Object} [props.homeProtectionForm] ACTIVE-opp only — the live
 *                                           home protection wizard form, fed
 *                                           to `buildHomeProtectionSteps` so
 *                                           conditional steps appear exactly
 *                                           as the running wizard has them.
 * @param {Object} [props.homeProtectionProgress] RELATED-opp fallback — the
 *                                           persisted
 *                                           `opportunity.home_protection_progress`
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
 *                                           "Open home protection CoPilot →".
 *                                           OMITTED for active-opp mounts.
 */
export function RelatedHomeProtectionProgress({
  opportunity,
  context = 'related_opp',
  currentStepIdx = null,
  homeProtectionForm = null,
  homeProtectionProgress = null,
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
  //
  // Wave 39 follow-up — `currentStepIdx` alone is NOT a sufficient
  // invalidation key. The ACTIVE-opp write-through (CoPilotPane's
  // HomeProtectionEmbedInner) and this component are both context
  // consumers under the same ActiveWorkflowContext.Provider, so a step
  // transition re-renders BOTH in the SAME commit — this component's
  // render (and this useMemo) happens BEFORE the write-through's effect
  // has run `activitiesApi.create()` for that transition, since React
  // always finishes the render phase for a commit before any effects
  // fire. The just-completed step's activity therefore doesn't exist yet
  // at the moment this memo captures its snapshot, and — because nothing
  // in the dep list changes again afterward — that stale, one-short
  // snapshot sticks (reproduced live: a completed conditional step shows
  // its green check with no timestamp, and adjacent rows can read a
  // mismatched time from it). The write-through's effect calls
  // `updateOpportunity` with a fresh `home_protection_progress.updated_at`
  // immediately after writing the activity, so keying on it here forces
  // exactly one extra re-read right after that write lands — cheap, and
  // it doesn't require the write-through to know anything about this
  // component.
  const activities = useMemo(() => {
    if (!oppId || !contactId) return [];
    return blinkerApi.activities.list({
      contact_id: contactId,
      opportunity_id: oppId,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oppId, contactId, currentStepIdx, opportunity?.home_protection_progress?.updated_at]);

  const timestamps = useMemo(() => deriveStepTimestamps(activities), [activities]);
  // step-key → `step_change` activity `source` — drives the per-row actor
  // badge (ADR 27 D7).
  const stepSources = useMemo(() => deriveStepSources(activities), [activities]);

  // Step list — ACTIVE uses the live form via buildHomeProtectionSteps;
  // RELATED uses BASE ∪ activity-history conditionals.
  const steps = useMemo(() => {
    if (context === 'active_opp') {
      try {
        return buildHomeProtectionSteps(homeProtectionForm || {});
      } catch {
        return [...BASE_STEP_KEYS];
      }
    }
    return buildRelatedStepList(activities);
  }, [context, homeProtectionForm, activities]);

  // Org TZ + formatters for date separators + popover timestamps.
  const formatters = useMemo(() => makeFormatters(timezoneForOrg(orgId)), [orgId]);

  // ── Progress state resolution ──
  //
  // ACTIVE — the live `currentStepIdx` is the freshest pointer. idx < it →
  //   past; == it → current; > it → future.
  // RELATED — derive the current step KEY from `opportunity.status` via
  //   stepFromStatus, then take its index in THIS step list. The persisted
  //   `home_protection_progress.furthest_step_idx` is used as a fallback so
  //   a sparse activity history still checks off everything up to the
  //   furthest known step.
  const currentIdx = useMemo(() => {
    if (context === 'active_opp') {
      return typeof currentStepIdx === 'number' ? currentStepIdx : 0;
    }
    // related_opp — status → step key → index in this list.
    const stepKey = stepFromStatus(opportunity?.status, 'home_add');
    let idx = steps.indexOf(stepKey);
    if (idx < 0) idx = 0;
    // home_protection_progress furthest-step fallback: never show LESS
    // progress than the persisted furthest pointer.
    const furthestKey = homeProtectionProgress?.furthest_step_key || null;
    if (furthestKey) {
      const furthestIdx = steps.indexOf(furthestKey);
      // The furthest COMPLETED step means the current step is the one
      // after it (or the furthest itself if it's the last). Use the max
      // of the status-derived idx and the furthest pointer.
      if (furthestIdx > idx) idx = furthestIdx;
    }
    return idx;
  }, [context, currentStepIdx, opportunity?.status, steps, homeProtectionProgress]);

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
    track('mc.copilot.home_protection_progress.viewed', {
      context,
      opp_id: oppId,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oppId]);

  function handleHoverFirstView(stepKey) {
    if (hoverFiredRef.current.has(stepKey)) return;
    hoverFiredRef.current.add(stepKey);
    track('mc.copilot.home_protection_progress.hover_detail_viewed', {
      step_key: stepKey,
      opp_id: oppId,
    });
  }

  // ── Build the row list with date separators interleaved ──
  //   - A long-form separator above the FIRST row always.
  //   - Between adjacent past rows when their local-day differs.
  //   - Future / current rows (no timestamp) don't anchor a day — they sit
  //     under the last-known separator implicitly.
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
      // always opens date-anchored.
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
            {/* Actor badge (ADR 27 D7/D8) — home protection actor comes
                from the matching step_change activity `source`, folded
                into a canonical actor by resolveActorLabel (missing/
                `system` source on a completed step → Agent). Completed/
                current rows only. */}
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
  // SectionLabel ("Workflow progress") above this component — suppress the
  // inner header to avoid the duplicate. RELATED-opp mounts have no parent
  // SectionLabel — keep the inner header + top-border divider.
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
      {/* "Open home protection CoPilot →" affordance — gated on
          `onOpenInCoPilot` being passed. ACTIVE-opp mounts intentionally
          omit the prop (the agent is already on this opp). RELATED-opp
          mounts pass it through OpportunityContextPane → RelatedOppRow. */}
      {onOpenInCoPilot && (
        <button
          type="button"
          onClick={() => onOpenInCoPilot(opportunity.id)}
          className="mt-2 text-[11px] font-medium text-blue-600 hover:text-blue-800 hover:underline"
        >
          Open home protection CoPilot →
        </button>
      )}
    </div>
  );
}
