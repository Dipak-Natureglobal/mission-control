// RelatedInsuranceProgress — mission-control-local, NOT a packages lift.
//
// Wave 31 v3.0.11 (ADR 21 D4) — first cut: a compact mini-timeline that
// surfaced under "RELATED OPPORTUNITIES" in the CoPilot left ctx pane for
// any related opportunity with `type === 'insurance'`.
//
// Wave 33 v3.0.13 (ADR 23 D2/D3/D4) — generalized: the same component now
// ALSO mounts under the ACTIVE-opp ctx pane when `currentOpp.type ===
// 'insurance'`. Two visual additions came with the generalization:
//   - Long-form `Month Day, Year` date separators above the FIRST event
//     row always, and between adjacent events when their local-day
//     differs (per the org timezone resolved by `timezoneForOrg(orgId)`).
//   - Per-event hover popovers using the canonical Tooltip pattern
//     (PlanCard MonthlyTooltip — trigger ref + getBoundingClientRect +
//     position:fixed + opacity-transition). For `capture.completed` /
//     `quote.completed` / `quote.viewed` / `policy.bound` rows, the
//     popover surfaces the per-stage detail blocks (carrier / policy /
//     premium / savings / ID-card / verified pill) sourced from the
//     workflow snapshot. For other rows (started / lead.created /
//     capture_link.* / quote_link.*) the popover is a thin timestamp.
//
// The component's NAME is intentionally unchanged — `RelatedInsuranceProgress`
// stays as the sole export to avoid churning every importer for a
// post-generalization rename. The file header (this comment) is the
// updated source of truth on dual-purpose usage.
//
// What's preserved from Wave 31 (renders identically in BOTH contexts):
//   - canon-driven status path (CAPTURE_AND_QUOTE_PATH / QUOTE_ONLY_PATH)
//   - past/current/future node states + check / spinner glyphs
//   - the 9-row main path (Started → Policy Written) labels + timestamps
//   - timestamps from `blinkerApi.activities.list({ contact_id, opportunity_id })`
//
// What's NEW for active-opp mounts:
//   - `workflowSnapshot` prop carries `workflow.capture.verification`,
//     `workflow.quote.payload`, `workflow.policy.payload` — needed for the
//     hover popovers' per-stage detail. Optional; absent for related-opp
//     mounts.
//
// Wave 33-fu3 — TWO-SOURCE detail model. The per-event popover detail
// resolves as `workflowSnapshot || opportunity.summary`:
//   - Active opp: the live `insuranceWorkflow` is in scope and threaded
//     as `workflowSnapshot` — freshest. mc keeps exactly ONE live
//     workflow (the active CoPilot's) and nulls it on opp-switch.
//   - Related opp: there is NO live workflow, so `workflowSnapshot` is
//     null. Detail instead comes from `opportunity.summary` — the
//     persisted snapshot the Wave 31b-fu4 status write-through effect in
//     CoPilotPane.jsx writes onto the opp record each time the workflow
//     advances. Both sources expose `.capture / .quote / .policy` with
//     identical sub-shape, so the 4 detail blocks read identical paths
//     from either. Before this fix, related-opp popovers rendered empty
//     (label + timestamp only) because the detail lived only on the
//     active-opp live workflow and evaporated on switch.
//   - `orgId` prop drives `timezoneForOrg()` → date separator local-day
//     grouping. Falls back to browser-local TZ when absent.
//   - `context` prop ('active_opp' | 'related_opp') threads through
//     telemetry payloads.
//   - `onOpenInCoPilot` is OMITTED for active-opp mounts (the agent is
//     already on this opp; the affordance is meaningless). Still accepted
//     for related-opp mounts.
//
// Replicated (NOT lifted) from insurance-portal/src/views/agent/LeadStatusTimeline.jsx:
//   CaptureDetail / QuoteDetail / QuoteViewedDetail / PolicyDetail
//   timezoneForOrg / makeFormatters / formatCents
// Per ADR 23 D4 + 3-strikes rule: 2 consumers (insurance-portal AgentView
// + this file). When/if a 3rd consumer arrives, lift to
// `packages/components/insurance-progress/`. Consistent with the existing
// duplication of CAPTURE_AND_QUOTE_PATH below — same intentional
// cross-app dup rationale.
//
// Constant arrays (CAPTURE_AND_QUOTE_PATH, QUOTE_ONLY_PATH) are duplicated
// from insurance-portal/src/views/agent/LeadStatusTimeline.jsx rather than
// imported — drift between canon and these lists will surface as the row
// mounting with an "unknown" label (handled defensively below).
//
// v3.0.15 (ADR 27 D6/D8) — each completed/current row now carries a
// compact actor badge (Agent / Consumer / System). The insurance actor
// is a static per-status property: it's read from canon
// `ghl-status.json insurance.statuses[].actor` via the ACTOR_BY_MACHINE_ID
// lookup below, then rendered through the shared <ActorBadge> helper.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { blinkerApi } from 'blinker-platform/api';
import { track } from 'blinker-platform/telemetry';
import canon from '../constants/canon/ghl-status.json';
import orgRegistry from '../constants/canon/org-registry.json';
import { ActorBadge } from '../lib/timeline-actor.jsx';

// Insurance machine_ids — duplicated from insurance-portal's
// LeadStatusTimeline (see file header rationale). String literals so the
// component can validate canon presence at first render without
// reaching cross-app.
const CAPTURE_AND_QUOTE_PATH = [
  'started',
  'lead.created',
  'capture_link.created',
  'capture_link.sent',
  'capture_link.viewed',
  'capture.completed',
  'quote.completed',
  'quote.viewed',
  'policy.bound',
];

const QUOTE_ONLY_PATH = [
  'started',
  'lead.created',
  'quote_link.created',
  'quote_link.sent',
  'quote_link.viewed',
  'quote.completed',
  'quote.viewed',
  'policy.bound',
];

// Build a label lookup from canon so each row can render the
// human-facing label without reaching into insurance-portal. The
// canon block is the same one that synced into mission-control's
// `src/constants/canon/ghl-status.json` (the canonical source of truth
// for status display strings).
function _buildLabelMap() {
  const out = {};
  const statuses = canon?.insurance?.statuses || {};
  for (const [label, entry] of Object.entries(statuses)) {
    if (entry?.machine_id) out[entry.machine_id] = label;
  }
  return out;
}
const LABEL_BY_MACHINE_ID = _buildLabelMap();

// Reverse lookups for activity timestamp derivation.
//   - partner_event rows carry `payload.event` matching the EI
//     external_event name (e.g. 'verification.completed'); look up the
//     corresponding machine_id (e.g. 'capture.completed').
//   - status_change rows carry `payload.to` as a display label
//     (e.g. 'Quoted'); look up the corresponding machine_id.
function _buildExternalEventMap() {
  const out = {};
  const statuses = canon?.insurance?.statuses || {};
  for (const entry of Object.values(statuses)) {
    if (entry?.external_event && entry?.machine_id) {
      // Multiple machine_ids may share the same external_event (e.g.
      // error.* both share 'error'). Skip the ambiguous ones; the
      // unambiguous ones (verification.completed, quote.completed,
      // quote.viewed, policy.bound) are what we need here.
      if (out[entry.external_event]) out[entry.external_event] = null;
      else out[entry.external_event] = entry.machine_id;
    }
  }
  // Drop the ambiguous entries.
  for (const k of Object.keys(out)) {
    if (out[k] === null) delete out[k];
  }
  return out;
}
const MACHINE_ID_BY_EXTERNAL_EVENT = _buildExternalEventMap();

function _buildLabelToMachineIdMap() {
  const out = {};
  const statuses = canon?.insurance?.statuses || {};
  for (const [label, entry] of Object.entries(statuses)) {
    if (entry?.machine_id) out[label] = entry.machine_id;
  }
  return out;
}
const MACHINE_ID_BY_LABEL = _buildLabelToMachineIdMap();

// machine_id → actor ('agent' | 'consumer' | 'system'). v3.0.15 (ADR 27
// D6) — every insurance status in canon carries an explicit `actor`
// field. The timeline's per-row actor badge reads from this lookup; a
// machine_id with no `actor` in canon yields undefined → no badge.
function _buildActorMap() {
  const out = {};
  const statuses = canon?.insurance?.statuses || {};
  for (const entry of Object.values(statuses)) {
    if (entry?.machine_id && entry?.actor) out[entry.machine_id] = entry.actor;
  }
  return out;
}
const ACTOR_BY_MACHINE_ID = _buildActorMap();

function pickMainPath(flowPath) {
  return flowPath === 'quote_only' ? QUOTE_ONLY_PATH : CAPTURE_AND_QUOTE_PATH;
}

function deriveTimestamps(activities) {
  // machine_id → earliest occurred_at among matching activities. Earliest
  // wins so re-fires (e.g. quote.completed → status_change re-fire) don't
  // override the original event time.
  const map = {};
  for (const a of activities || []) {
    let machineId = null;
    if (a.type === 'partner_event' && a.payload?.event) {
      machineId = MACHINE_ID_BY_EXTERNAL_EVENT[a.payload.event] || null;
    } else if (a.type === 'status_change' && a.payload?.to) {
      machineId = MACHINE_ID_BY_LABEL[a.payload.to] || null;
    }
    if (!machineId) continue;
    const at = a.occurred_at;
    if (!at) continue;
    if (!map[machineId] || String(at) < String(map[machineId])) {
      map[machineId] = at;
    }
  }
  return map;
}

// Org timezone lookup — replicated from insurance-portal's
// LeadStatusTimeline. Reads org-registry.json by orgId. Falls back to
// undefined (browser-local TZ) when lookup misses.
function timezoneForOrg(orgId) {
  if (orgId == null) return undefined;
  const org = orgRegistry?.orgs?.find((o) => o.id === orgId);
  return org?.timezone || undefined;
}

// Build Intl.DateTimeFormat instances anchored to the org's timezone.
// `dayKey` uses sv-SE locale which reliably produces YYYY-MM-DD —
// used as a stable string key for day-separator grouping. Replicated
// from insurance-portal's LeadStatusTimeline.
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
  // sv-SE formats as YYYY-MM-DD — stable grouping key
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

// Format cents → "$1,234" (no decimals). Returns '$—' for null/undefined.
// Replicated from insurance-portal's LeadStatusTimeline.
function formatCents(cents) {
  if (cents == null) return '$—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

// ─── Replicated detail blocks (per ADR 23 D4 + 3-strikes rule) ──────────────
//
// Source: insurance-portal/src/views/agent/LeadStatusTimeline.jsx
// CaptureDetail / QuoteDetail / QuoteViewedDetail / PolicyDetail.
// Replicated inline rather than cross-app imported per ADR 23 D4. Field
// shapes mirror the workflow snapshot insurance-webhook-handler.js writes:
//   workflow.capture.verification      ← summary.insuranceVerification
//   workflow.quote.payload             ← summary.quote
//   workflow.policy.payload            ← summary.policy

function CaptureDetail({ verification }) {
  if (!verification) return null;
  const { policyInfo, source, media, verifiedAt } = verification;
  const primaryVehicle = policyInfo?.vehicles?.[0];
  const mediaUrl = media?.[0]?.url;
  return (
    <div className="space-y-1 text-[11px] text-slate-600">
      {policyInfo?.carrier && (
        <div>
          <span className="font-medium">{policyInfo.carrier}</span>
          {policyInfo.policyNumber && (
            <span className="text-slate-400"> · policy {policyInfo.policyNumber}</span>
          )}
        </div>
      )}
      {primaryVehicle && (
        <div className="text-slate-500">
          Detected:{' '}
          {[primaryVehicle.year, primaryVehicle.make, primaryVehicle.model]
            .filter(Boolean)
            .join(' ')}
        </div>
      )}
      {source === 'id-card' && mediaUrl && (
        <a
          href={mediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline hover:text-blue-800"
          // Stop the trigger's mouseleave-driven hide from racing with
          // the link click; the popover stays open while the user
          // moves into it.
          onClick={(e) => e.stopPropagation()}
        >
          View ID card
        </a>
      )}
      <div>
        <span
          className={
            'inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ' +
            (source === 'id-card'
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-blue-50 text-blue-700')
          }
        >
          {source === 'id-card' ? 'Verified via ID card' : 'Verified via third-party data'}
        </span>
      </div>
      {verifiedAt && (
        <div className="text-slate-400 text-[10px]">
          Verified at {new Date(verifiedAt).toLocaleString()}
        </div>
      )}
    </div>
  );
}

// Wave 36-fu4 (ADR 26 D4-fu4) — normalize a self-reported premium to a
// 6-month basis: monthly → ×6 · 6mo → ×1 · 12mo → ÷2. Replicated inline
// from `mission-control/src/lib/insurance-savings-adapter.js`
// (`normalizeTo6moCents`, not exported there) — keep the rule identical
// to the adapter so the popover figure matches the SavingsCard figure.
function normalizeTo6moCents(amountCents, cadence) {
  if (cadence === 'monthly') return amountCents * 6;
  if (cadence === '12mo') return Math.round(amountCents / 2);
  return amountCents; // '6mo' (and any unknown cadence) — already 6-month
}

function QuoteDetail({
  quote,
  formatters,
  currentCarrier,
  currentPremiumCents,
  premiumCadence,
}) {
  if (!quote) return null;
  const { carrier, totalPremiumCents, savingsAmountCents, createdAt } = quote;

  // Savings line resolution (Wave 36-fu4):
  //   1. EI savingsAmountCents present + positive → capture+quote path,
  //      render the EI figure (unchanged behavior).
  //   2. Else, self-reported premium + quoted total present → compute the
  //      estimated 6-month savings from the self-reported premium.
  //   3. Else → keep the existing "No savings comparison" line.
  let savingsLine;
  if (savingsAmountCents != null) {
    savingsLine = (
      <div className="text-emerald-700">
        Savings {formatCents(savingsAmountCents)} / 6mo{' '}
        <span className="text-slate-500">
          (≈ {formatCents(savingsAmountCents * 2)} / yr)
        </span>
      </div>
    );
  } else if (currentPremiumCents != null && totalPremiumCents != null) {
    const normalizedCurrent6mo = normalizeTo6moCents(
      currentPremiumCents,
      premiumCadence,
    );
    const savings6mo = normalizedCurrent6mo - totalPremiumCents;
    if (savings6mo > 0) {
      savingsLine = (
        <div className="text-emerald-700">
          Est. savings {formatCents(savings6mo)} / 6mo
          {currentCarrier ? ` vs ${currentCarrier}` : ''}{' '}
          <span className="text-slate-500">
            (≈ {formatCents(savings6mo * 2)} / yr)
          </span>
        </div>
      );
    } else {
      savingsLine = (
        <div className="text-slate-400">
          No better rate than {currentCarrier || 'current carrier'} today
        </div>
      );
    }
  } else {
    savingsLine = (
      <div className="text-slate-400">No savings comparison (quote-only path)</div>
    );
  }

  return (
    <div className="space-y-1 text-[11px] text-slate-600">
      {carrier && (
        <div>
          Quoted carrier: <span className="font-medium">{carrier}</span>
        </div>
      )}
      {totalPremiumCents != null && (
        <div>
          Premium: <span className="font-medium">{formatCents(totalPremiumCents)} / 6mo</span>
        </div>
      )}
      {savingsLine}
      {createdAt && formatters && (
        <div className="text-slate-400 text-[10px]">
          Quoted at {formatters.time.format(new Date(createdAt))}
        </div>
      )}
    </div>
  );
}

function QuoteViewedDetail({ quote, formatters }) {
  const viewedAt = quote?.viewedAt;
  if (!viewedAt || !formatters) return null;
  return (
    <div className="text-[11px] text-slate-500">
      Viewed at {formatters.time.format(new Date(viewedAt))}
    </div>
  );
}

function PolicyDetail({ policy }) {
  if (!policy) return null;
  const { carrier, id } = policy;
  return (
    <div className="space-y-1 text-[11px] text-slate-600">
      {carrier && (
        <div>
          Carrier: <span className="font-medium">{carrier}</span>
        </div>
      )}
      {id && (
        <div className="flex flex-wrap items-baseline gap-1">
          <span>Reference:</span>
          <span className="font-mono">{id}</span>
          <span className="text-[10px] text-amber-700">
            (policy_number pending — EI does not surface today)
          </span>
        </div>
      )}
    </div>
  );
}

// Pick the appropriate detail block for a given machineId. When the
// stage has no canonical detail block, return null — the popover then
// falls back to a thin timestamp-only render.
//
// `detailSource` (Wave 33-fu3) is `workflowSnapshot || opportunity.summary`
// — see file header's two-source model note. Both shapes expose
// `.capture / .quote / .policy` identically.
//
// `currentInsurance` (Wave 36-fu5) is `opportunity.current_insurance` — the
// PERSISTED self-reported carrier/premium block. It is the fallback source
// for QuoteDetail's three self-reported fields when `detailSource` is
// `opportunity.summary` (related-opp / reopened mounts) — `summary` carries
// capture/quote/policy but NOT the self-reported root fields, so without
// this fallback the related-opp QuoteDetail popover degrades to "No savings
// comparison" even when the data exists on the opp record.
function StageDetail({ machineId, detailSource, currentInsurance, formatters }) {
  if (!detailSource) return null;
  switch (machineId) {
    case 'capture.completed':
      return <CaptureDetail verification={detailSource?.capture?.verification} />;
    case 'quote.completed':
      // Wave 36-fu4 — thread the self-reported current-insurance fields so
      // QuoteDetail can compute estimated savings on the quote-only path.
      // These live at the workflow ROOT (seeded by buildInitial / written
      // by CurrentInsuranceGate), so they're present when `detailSource`
      // is the live `workflowSnapshot`.
      //
      // Wave 36-fu5 — when `detailSource` is `opportunity.summary`
      // (related-opp mounts), the workflow-root fields are absent; fall
      // back per-field to `opportunity.current_insurance` (the persisted
      // self-reported block written by CoPilotPane's status write-through).
      // The active-opp render is unaffected — `detailSource` is the live
      // workflowSnapshot and its fields win the `??` chain.
      return (
        <QuoteDetail
          quote={detailSource?.quote?.payload}
          formatters={formatters}
          currentCarrier={
            detailSource?.currentCarrier ?? currentInsurance?.carrier ?? null
          }
          currentPremiumCents={
            detailSource?.currentPremiumCents ??
            currentInsurance?.premiumCents ??
            null
          }
          premiumCadence={
            detailSource?.premiumCadence ?? currentInsurance?.cadence ?? '6mo'
          }
        />
      );
    case 'quote.viewed':
      return <QuoteViewedDetail quote={detailSource?.quote?.payload} formatters={formatters} />;
    case 'policy.bound':
      return <PolicyDetail policy={detailSource?.policy?.payload} />;
    default:
      return null;
  }
}

// ─── Hover popover (canonical Tooltip pattern) ──────────────────────────────
//
// Replicates the trigger-ref + getBoundingClientRect + position:fixed +
// opacity-transition pattern from
// `protection-portal/src/components/PlanCard.jsx::MonthlyTooltip`
// (per `feedback_tooltip_pattern.md` — native `title=` is forbidden).
//
// Placement strategy:
//   - Default: open RIGHT of the row trigger (the rail itself sits on the
//     left edge of the viewport at w-[320px], so the popover at ~280px
//     fits comfortably to the right without hitting the right viewport
//     edge in the typical CoPilot layout).
//   - Anti-clip: if `r.right + POPOVER_WIDTH + MARGIN > innerWidth`, fall
//     back to opening LEFT of the row (right-aligned to the trigger). This
//     keeps the popover visible if the rail is ever re-positioned closer
//     to viewport center (e.g. embedded layouts at narrow viewports).

const POPOVER_WIDTH = 280; // px — matches max-w-[280px] below
const POPOVER_MARGIN = 12; // px — viewport edge breathing room

function StageRowPopover({
  machineId,
  label,
  state,
  timestamp,
  detailSource,
  currentInsurance,
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
        // Open LEFT — popover's right edge aligns to row's left edge.
        setCoords({ top: r.top, left: r.left - 8, transform: 'translateX(-100%)' });
      }
    }
    setOpen(true);
    if (!trackedRef.current) {
      trackedRef.current = true;
      if (typeof onFirstHover === 'function') onFirstHover(machineId);
    }
  }
  function hide() {
    setOpen(false);
  }

  // Suppress popover entirely for rows with no useful detail to surface.
  // For "future" rows there's no timestamp and no payload yet — render
  // the row plain (no hover affordance). This keeps the rail quiet on
  // unrealized stages.
  const hasDetailBlock = ['capture.completed', 'quote.completed', 'quote.viewed', 'policy.bound']
    .includes(machineId);
  const hasTimestamp = Boolean(timestamp);
  const hasAnythingToShow = state !== 'future' && (hasDetailBlock || hasTimestamp);

  if (!hasAnythingToShow) {
    return (
      <span ref={triggerRef} className="inline-flex w-full">
        {children}
      </span>
    );
  }

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
          'z-[60] max-w-[280px] px-3 py-2 rounded-md border border-slate-200 bg-white shadow-lg text-xs text-slate-900 leading-snug transition-opacity ' +
          (open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none')
        }
      >
        <div className="text-[11px] font-semibold text-slate-900 mb-1">{label}</div>
        {timestamp && formatters && (
          <div className="text-[10px] text-slate-400 font-mono mb-1.5">
            {formatTime(timestamp, formatters)}
          </div>
        )}
        <StageDetail
          machineId={machineId}
          detailSource={detailSource}
          currentInsurance={currentInsurance}
          formatters={formatters}
        />
      </span>
    </span>
  );
}

// ─── Date separator ─────────────────────────────────────────────────────────

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
 * @param {Object} props.opportunity        Insurance opportunity record.
 *                                           Required. Carries id +
 *                                           contact_id (needed for
 *                                           activity lookup) + flowPath
 *                                           (drives main-path selection).
 * @param {Object} [props.workflowSnapshot] Live insurance workflow
 *                                           snapshot. Optional — passed
 *                                           by ACTIVE-opp mounts only.
 *                                           Shape mirrors what
 *                                           insurance-portal AgentView
 *                                           threads to LeadStatusTimeline:
 *                                           `{ capture: { verification },
 *                                              quote: { payload }, policy:
 *                                              { payload }, … }`. When
 *                                           absent the popovers degrade to
 *                                           timestamp-only.
 * @param {number} [props.orgId]            Drives `timezoneForOrg()` for
 *                                           date-separator local-day
 *                                           grouping. Falls back to
 *                                           browser-local TZ when absent.
 * @param {'active_opp'|'related_opp'} [props.context]
 *                                           Threads through telemetry
 *                                           payloads. Defaults to
 *                                           'related_opp' for back-compat
 *                                           with the Wave 31 callsite.
 * @param {function} [props.onOpenInCoPilot] Optional. Called with
 *                                           (oppId) when the agent
 *                                           clicks the "Open insurance
 *                                           CoPilot →" affordance. OMITTED
 *                                           for active-opp mounts (the
 *                                           agent is already on the opp).
 */
export function RelatedInsuranceProgress({
  opportunity,
  workflowSnapshot = null,
  orgId = null,
  context = 'related_opp',
  onOpenInCoPilot,
}) {
  // Fire `mc.copilot.related_insurance_progress.viewed` once per mount.
  // Component remounts when the opp changes (parent uses opp.id as the
  // React key indirectly via the list-render or the ctx-pane re-key on
  // active opp switch), so the ref-based single-fire is per-row.
  const viewedRef = useRef(false);
  // Track which stage rows have already fired the hover-detail telemetry
  // event — first hover-open per stage row per mount.
  const hoverFiredRef = useRef(new Set());
  const flowPath = opportunity?.flowPath || 'capture_and_quote';
  const mainPath = pickMainPath(flowPath);

  // Wave 33-fu3 — two-source popover detail (see file header). Active-opp
  // mounts get the live `workflowSnapshot`; related-opp mounts (no live
  // workflow) fall back to the persisted `opportunity.summary` snapshot.
  // Both expose identical `.capture / .quote / .policy` sub-shapes.
  const detailSource = workflowSnapshot || opportunity?.summary || null;

  // Activities are localStorage-backed and contact-keyed. Memoize so the
  // list isn't re-read on every parent re-render — relatedOpps is itself
  // memoized in CoPilotPane so this only re-fires when the underlying
  // opp identity changes.
  //
  // Wave 33: workflowSnapshot is included in the dep chain so a webhook
  // fire that mutates `workflow.status` (and synthesizes a status_change
  // activity via CoPilotPane's write-through) re-derives the timestamps
  // for the active-opp mount path. Identity-compare on workflowSnapshot
  // is acceptable because the parent (`useActiveWorkflow()`) replaces the
  // object on every patch.
  const oppId = opportunity?.id;
  const contactId = opportunity?.contact_id;
  const timestamps = useMemo(() => {
    if (!oppId || !contactId) return {};
    const activities = blinkerApi.activities.list({
      contact_id: contactId,
      opportunity_id: oppId,
    });
    return deriveTimestamps(activities);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oppId, contactId, workflowSnapshot]);

  // Org TZ + formatters for date separators + popover timestamps.
  const formatters = useMemo(() => makeFormatters(timezoneForOrg(orgId)), [orgId]);

  useEffect(() => {
    if (viewedRef.current) return;
    if (!oppId) return;
    viewedRef.current = true;
    track('mc.copilot.related_insurance_progress.viewed', {
      related_insurance_opp_id: oppId,
      latest_status: opportunity?.status || null,
      // Wave 33 v3.0.13 — `context` distinguishes the active-opp mount
      // (left rail of an insurance CoPilot) from the related-opp mount
      // (left rail of any non-insurance CoPilot with a related insurance
      // opp). Lets dashboards split adoption by mount surface.
      context,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oppId]);

  function handleHoverDetailFirstView(machineId) {
    if (hoverFiredRef.current.has(machineId)) return;
    hoverFiredRef.current.add(machineId);
    track('mc.copilot.insurance_progress.hover_detail_viewed', {
      stage: machineId,
      opp_id: oppId,
      context,
    });
  }

  // Status placement on the path. If the current status is unknown
  // (e.g. an off-path error.* status), treat all observed machine_ids
  // as past and don't highlight a "current" node.
  const currentMachineId = opportunity?.status || null;
  const observedIds = new Set(Object.keys(timestamps));
  // Anything earlier in the path than the current status is also
  // implicitly "past" even without a recorded timestamp — common in
  // fixtures where not every transition seeds an activity row.
  const currentIdx = mainPath.indexOf(currentMachineId);
  const passed = new Set(observedIds);
  if (currentIdx >= 0) {
    for (let i = 0; i < currentIdx; i++) passed.add(mainPath[i]);
  }

  function nodeState(id) {
    if (passed.has(id)) return 'past';
    if (id === currentMachineId) return 'current';
    return 'future';
  }

  // Build the row list with date separators interleaved. Per ADR 23 D3:
  //   - Above the FIRST event row always (even when only one event
  //     exists — falls back to "today" in the org TZ when no past
  //     timestamp is available).
  //   - Between adjacent events when their local-day differs.
  //   - Future rows (no timestamp) don't anchor to a day — they sit
  //     under the last-known separator implicitly.
  let lastDayKey = null;
  let firstSeparatorEmitted = false;
  const rows = [];
  for (let i = 0; i < mainPath.length; i++) {
    const id = mainPath[i];
    const ts = timestamps[id];
    const state = nodeState(id);

    // Date separator emit logic. We only anchor separators on rows that
    // have a real timestamp (past rows). For the very first row of the
    // list — even when no past row has fired — we still emit ONE
    // separator using `now()` so the rail always opens with a date
    // header (per ADR 23 D3 "always show first separator").
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
      // No past timestamps yet — emit a "today" separator so the first
      // visual is still date-anchored.
      const now = new Date();
      const k = formatters.dayKey.format(now);
      rows.push(
        <DateSeparator
          key={`day-${k}-init`}
          label={formatters.day.format(now)}
        />
      );
      lastDayKey = k;
      firstSeparatorEmitted = true;
    }

    const label = LABEL_BY_MACHINE_ID[id] || id;
    rows.push(
      <li key={id} className="text-[11px]">
        <StageRowPopover
          machineId={id}
          label={label}
          state={state}
          timestamp={ts}
          detailSource={detailSource}
          currentInsurance={opportunity?.current_insurance || null}
          formatters={formatters}
          onFirstHover={handleHoverDetailFirstView}
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
            {/* Actor badge (ADR 27 D6/D8) — insurance actor is the static
                per-status canon `actor`. Completed/current rows only;
                future (grey) rows render no badge. */}
            {state !== 'future' && (
              <ActorBadge actor={ACTOR_BY_MACHINE_ID[id]} />
            )}
            {ts && (
              <span className="text-[10px] text-slate-400 font-mono shrink-0">
                {formatTime(ts, formatters)}
              </span>
            )}
          </span>
        </StageRowPopover>
      </li>
    );
  }

  // For ACTIVE-opp mounts, the parent (`OpportunityContextPane`) renders
  // a `SectionLabel` ("CAPTURE+QUOTE PROGRESS") above this component to
  // match the rail's other sections (Contact / Vehicle / Related opps).
  // Suppress the inner header in that case to avoid the duplicate label.
  // For RELATED-opp mounts there's no parent SectionLabel — keep the
  // inner header so the row body has its own visible heading.
  const showInnerHeader = context !== 'active_opp';
  // Likewise, the active-opp mount doesn't need the top-border treatment
  // (it sits inside its own padded section); the related-opp mount
  // visually divides itself from the sibling row content above.
  const wrapperClass =
    context === 'active_opp'
      ? ''
      : 'mt-2 pt-2 border-t border-slate-200/60';

  return (
    <div className={wrapperClass}>
      {showInnerHeader && (
        <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 mb-1.5">
          {flowPath === 'quote_only' ? 'Quote progress' : 'Capture + quote progress'}
        </div>
      )}
      <ul className="space-y-0.5">{rows}</ul>
      {/* "Open insurance CoPilot →" affordance — gated on
          `onOpenInCoPilot` being passed. ACTIVE-opp mounts intentionally
          omit the prop (the agent is already on this opp; the link is
          meaningless). RELATED-opp mounts continue to pass it through
          OpportunityContextPane → RelatedOppRow. */}
      {onOpenInCoPilot && (
        <button
          type="button"
          onClick={() => onOpenInCoPilot(opportunity.id)}
          className="mt-2 text-[11px] font-medium text-blue-600 hover:text-blue-800 hover:underline"
        >
          Open insurance CoPilot →
        </button>
      )}
    </div>
  );
}
