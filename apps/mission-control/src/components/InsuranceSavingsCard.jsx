// InsuranceSavingsCard — mission-control-local component, NOT a packages
// lift. Surfaces in the insurance CoPilot right pane (mounted by
// CoPilotPane.jsx::InsuranceEmbed for opportunity.type === 'insurance').
//
// Wave 31 v3.0.11 (ADR 21 D3). State-driven card content per the ADR
// table — copy + CTA enablement change as the insurance workflow
// transitions through capture/quote/policy phases. Visual precedent:
// refi-portal/src/results/InsuranceSavingsCard.jsx (NOT imported — refi's
// component is wired into refi's own state model and carries
// MOCK_INSURANCE_SAVINGS fixtures). This is a fresh implementation
// driven by the live insurance workflow snapshot.
//
// State table (matches ADR D3):
//
//   pre-send / started:
//     not rendered (origination form shows first; CoPilotPane gates).
//
//   capture_link.sent → capture_link.viewed:
//     "Customer is reviewing — savings TBD" + Find Coverage CTA disabled.
//
//   capture.completed:
//     "Currently paying $X/mo" hero (carrier from
//      workflow.capture.verification.policyInfo.carrier; current
//      premium is NOT surfaced by EI — see ADR caveat) +
//      "Could save up to $—/mo (quote pending)" + Find Coverage CTA
//      ACTIVE.
//
//   quote.completed (savings > 0):
//     Full card — current paying + savings hero + coverage checklist +
//      Find Coverage CTA active.
//
//   quote.completed (savings === 0):
//     Muted "We will continue to monitor savings" + Find Coverage CTA
//      still active.
//
//   policy.bound:
//     Compact "Bound with {carrier} — saving $Y/mo" summary; CTA active.
//
//   error.verification / error.quote:
//     Error reason inline + CTA active (agent can still spawn protection).
//
// Click on Find Coverage:
//   - emit `insurance.copilot.find_coverage.clicked` telemetry
//   - call `onFindCoverage()` callback supplied by parent
//   - parent (CoPilotPane) handles the opp spawn + active-workflow switch
//
// Wave 36-fu6 (ADR 26 D6) — inline current-insurance editor. The
// agent-side `CurrentInsuranceGate` is a pre-send step gated on
// `flowPath === 'quote_only'`, but the flow path is chosen in the
// LeadOriginationForm which runs AFTER the gate sequence, and FORCE
// STATUS skips all pre-send gates — so a brand-new agent-created
// quote-only opp never gets the self-reported premium that quote-only
// savings math needs. This card therefore becomes the always-reachable
// surface: when the active opp is quote-only, post-send, and carries no
// `workflow.currentPremiumCents`, it renders a compact inline editor
// (carrier searchable select + per-cadence premium slider + cadence
// toggle) in place of the "No carrier comparison" block. Submit writes
// the four self-reported fields to the workflow root (updateWorkflow)
// AND persists a `current_insurance` block to the opp record
// (updateOpportunity); the savings adapter then recomputes live. When a
// premium IS present, the savings view renders as before plus a small
// "Edit current insurance" affordance that re-opens the editor. The
// editor is quote-only only — capture+quote is unaffected.
//
// Telemetry:
//   - `insurance.copilot.savings_card.viewed` — fired once on mount when
//     the card actually renders (post-send). Carries has_capture +
//     has_quote + savings_amount_cents booleans/numerics for cohort math.
//   - `insurance.copilot.find_coverage.clicked` — fired in onFindCoverage.
//   - `mc.copilot.savings_card.current_insurance_saved` — fired when the
//     inline editor is submitted. { opp_id, carrier_id, premium_cents,
//     cadence }.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  TrendingDown,
  Award,
  Search,
  Check,
  DollarSign,
  Pencil,
} from 'lucide-react';
import { track } from 'blinker-platform/telemetry';
import { mapInsuranceWorkflowToSavings } from '../lib/insurance-savings-adapter';
import carriersCanon from '../constants/canon/insurance-carriers.json';

// Insurance-portal canonical machine_ids. Duplicated as literal strings
// (rather than imported from insurance-portal/src/constants/status-map)
// to keep this component mc-local with no cross-app dep — see ADR 21
// component-ownership note.
const STATUS = {
  STARTED: 'started',
  LEAD_CREATED: 'lead.created',
  CAPTURE_LINK_CREATED: 'capture_link.created',
  CAPTURE_LINK_SENT: 'capture_link.sent',
  CAPTURE_LINK_VIEWED: 'capture_link.viewed',
  QUOTE_LINK_CREATED: 'quote_link.created',
  QUOTE_LINK_SENT: 'quote_link.sent',
  QUOTE_LINK_VIEWED: 'quote_link.viewed',
  CAPTURE_COMPLETED: 'capture.completed',
  QUOTE_COMPLETED: 'quote.completed',
  QUOTE_VIEWED: 'quote.viewed',
  POLICY_BOUND: 'policy.bound',
  ERROR_VERIFICATION: 'error.verification',
  ERROR_QUOTE: 'error.quote',
  DUPLICATE: 'duplicate',
};

const PRE_SEND_STATUSES = new Set([
  null,
  undefined,
  '',
  STATUS.STARTED,
  STATUS.LEAD_CREATED,
  STATUS.CAPTURE_LINK_CREATED,
  STATUS.QUOTE_LINK_CREATED,
]);
const SENT_NOT_CAPTURED = new Set([
  STATUS.CAPTURE_LINK_SENT,
  STATUS.CAPTURE_LINK_VIEWED,
  STATUS.QUOTE_LINK_SENT,
  STATUS.QUOTE_LINK_VIEWED,
]);
const ERROR_STATUSES = new Set([
  STATUS.ERROR_VERIFICATION,
  STATUS.ERROR_QUOTE,
  STATUS.DUPLICATE,
]);

function formatMonthlyFromSixMonthCents(sixMonthCents) {
  if (sixMonthCents == null) return null;
  return `$${Math.round(sixMonthCents / 6 / 100).toLocaleString()}`;
}

// ----------------------------------------------------------------------
// Wave 36-fu6 (ADR 26 D6) — inline current-insurance editor support.
//
// The editor is a COMPACT inline mirror of insurance-portal's
// `CurrentInsuranceGate`: same canon source, same per-cadence slider
// bounds, same cadence-change clamp. The pre-send gate is unreachable for
// agent-created opps (flow path is chosen in the LeadOriginationForm,
// which runs AFTER the gate sequence; FORCE STATUS skips all pre-send
// gates) — so this card is the always-reachable surface for the
// self-reported current carrier + premium that drives quote-only savings.

// Dedupe carriers by `id` — first occurrence wins (mirrors the gate).
const CARRIERS = (() => {
  const seen = new Set();
  const out = [];
  for (const c of carriersCanon.carriers || []) {
    if (!c?.id || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
})();

const SLIDER_STEP_CENTS = carriersCanon.premium_slider?.step_cents ?? 1000;
const SLIDER_BY_CADENCE = carriersCanon.premium_slider?.by_cadence ?? {
  monthly: { min_cents: 5000, max_cents: 150000 },
  '6mo': { min_cents: 30000, max_cents: 500000 },
  '12mo': { min_cents: 60000, max_cents: 500000 },
};
const SIX_MO_AVG_CENTS = carriersCanon.average_premium?.six_month_cents ?? 150000;

const CADENCES = [
  { v: 'monthly', l: 'Monthly' },
  { v: '6mo', l: 'Every 6 months' },
  { v: '12mo', l: 'Yearly' },
];

// {min_cents, max_cents} for the given cadence; falls back to '6mo'.
function sliderRangeForCadence(cadence) {
  return SLIDER_BY_CADENCE[cadence] ?? SLIDER_BY_CADENCE['6mo'];
}

// Cadence-appropriate average, derived from the 6-month canon figure.
function averageForCadence(cadence) {
  if (cadence === 'monthly') return Math.round(SIX_MO_AVG_CENTS / 6);
  if (cadence === '12mo') return SIX_MO_AVG_CENTS * 2;
  return SIX_MO_AVG_CENTS; // 6mo
}

function fmtUSD(cents) {
  return '$' + Math.round((cents || 0) / 100).toLocaleString('en-US');
}

function cadenceSuffix(cadence) {
  return cadence === 'monthly' ? '/mo' : cadence === '12mo' ? '/yr' : '/6mo';
}

/**
 * Compact inline current-insurance editor (ADR 26 D6). Collects current
 * carrier (searchable select over canon carriers) + premium (per-cadence
 * slider) + cadence. On submit calls back with the four self-reported
 * workflow fields. Mirrors `CurrentInsuranceGate`'s canon-consumption /
 * slider / clamp logic in a tight card-friendly footprint.
 *
 * @param {Object} props
 * @param {string|null}  props.initialCarrierId   Pre-fill (re-open path).
 * @param {number|null}  props.initialPremiumCents Pre-fill (re-open path).
 * @param {string}       props.initialCadence     Pre-fill cadence.
 * @param {function}     props.onSubmit           ({ currentCarrier,
 *                         currentCarrierId, currentPremiumCents,
 *                         premiumCadence }) => void.
 * @param {function}     [props.onCancel]         Optional — shown only when
 *                         the editor was re-opened over an existing value.
 */
function CurrentInsuranceEditor({
  initialCarrierId = null,
  initialPremiumCents = null,
  initialCadence = '6mo',
  onSubmit,
  onCancel,
}) {
  const [cadence, setCadence] = useState(initialCadence || '6mo');
  const [premiumCents, setPremiumCents] = useState(
    initialPremiumCents ?? averageForCadence(initialCadence || '6mo'),
  );
  // Until the agent moves the slider, a cadence switch re-snaps to the
  // new cadence's average.
  const premiumTouched = useRef(initialPremiumCents != null);

  const [carrierId, setCarrierId] = useState(initialCarrierId);
  const [query, setQuery] = useState(() => {
    if (!initialCarrierId) return '';
    return CARRIERS.find((c) => c.id === initialCarrierId)?.displayName || '';
  });
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  // Close the autocomplete dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Filtered carrier list — case-insensitive substring over displayName.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CARRIERS;
    return CARRIERS.filter((c) => c.displayName.toLowerCase().includes(q));
  }, [query]);

  const selectedCarrier = carrierId
    ? CARRIERS.find((c) => c.id === carrierId) || null
    : null;

  function pickCarrier(c) {
    setCarrierId(c.id);
    setQuery(c.displayName);
    setOpen(false);
  }

  function onCadenceChange(next) {
    setCadence(next);
    const { min_cents, max_cents } = sliderRangeForCadence(next);
    if (!premiumTouched.current) {
      // Re-snap to the new cadence's average until the slider is touched.
      setPremiumCents(averageForCadence(next));
    } else {
      // Keep the agent's value but clamp it into the new cadence's range.
      setPremiumCents((prev) => Math.min(Math.max(prev, min_cents), max_cents));
    }
  }

  function onSlide(e) {
    premiumTouched.current = true;
    setPremiumCents(Number(e.target.value));
  }

  const canSubmit = Boolean(carrierId);
  const avgCents = averageForCadence(cadence);
  const { min_cents: sliderMin, max_cents: sliderMax } =
    sliderRangeForCadence(cadence);

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmit?.({
      currentCarrier: selectedCarrier?.displayName ?? null,
      currentCarrierId: carrierId,
      currentPremiumCents: premiumCents,
      premiumCadence: cadence,
    });
  }

  return (
    <div className="px-5 py-5 space-y-4">
      <div className="text-center space-y-1">
        <div className="text-sm font-semibold text-slate-700">
          Add the customer's current insurance to estimate savings
        </div>
        <div className="text-[11px] text-slate-500 leading-snug">
          Ask who they're insured with today and roughly what they pay.
        </div>
      </div>

      {/* Current carrier — compact searchable select. */}
      <div ref={boxRef} className="relative">
        <label className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1 block">
          Current carrier
        </label>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            placeholder="Search insurance companies…"
            onChange={(e) => {
              setQuery(e.target.value);
              setCarrierId(null);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
          />
          {selectedCarrier && !open && (
            <Check className="w-4 h-4 text-emerald-500 absolute right-2.5 top-1/2 -translate-y-1/2" />
          )}
        </div>
        {open && (
          <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-md shadow-lg">
            {matches.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-500">
                No carriers match — pick "Other / Not listed".
              </div>
            ) : (
              matches.map((c) => {
                const active = c.id === carrierId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => pickCarrier(c)}
                    className={
                      'w-full text-left px-3 py-1.5 text-sm flex items-center justify-between ' +
                      (active
                        ? 'bg-blue-50 text-blue-700'
                        : 'hover:bg-slate-50 text-slate-700')
                    }
                  >
                    <span>{c.displayName}</span>
                    {active && <Check className="w-3.5 h-3.5 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Cadence toggle. */}
      <div>
        <label className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1 block">
          How do they pay?
        </label>
        <div className="grid grid-cols-3 gap-1.5">
          {CADENCES.map((c) => {
            const active = cadence === c.v;
            return (
              <button
                key={c.v}
                type="button"
                onClick={() => onCadenceChange(c.v)}
                className={
                  'px-2 py-1.5 rounded-md border text-[11px] font-semibold transition ' +
                  (active
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700')
                }
              >
                {c.l}
              </button>
            );
          })}
        </div>
      </div>

      {/* Current premium — per-cadence slider. */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold flex items-center gap-1">
            <DollarSign className="w-3 h-3" /> Current premium
          </label>
          <span className="text-sm font-semibold text-slate-800">
            {fmtUSD(premiumCents)}
            <span className="text-xs font-normal text-slate-500">
              {cadenceSuffix(cadence)}
            </span>
          </span>
        </div>
        <input
          type="range"
          min={sliderMin}
          max={sliderMax}
          step={SLIDER_STEP_CENTS}
          value={premiumCents}
          onChange={onSlide}
          className="w-full accent-blue-600 cursor-pointer"
        />
        <div className="flex items-center justify-between text-[10px] text-slate-400 mt-0.5">
          <span>{fmtUSD(sliderMin)}</span>
          <span>{fmtUSD(sliderMax)}</span>
        </div>
        <p className="text-[10px] text-slate-500 mt-1 leading-snug">
          Typical driver pays about{' '}
          <span className="font-semibold text-slate-600">
            {fmtUSD(avgCents)}
            {cadenceSuffix(cadence)}
          </span>
          .
        </p>
      </div>

      <div className="flex items-center gap-2 pt-1">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-2 rounded-md font-semibold text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 transition"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={
            'flex-1 px-4 py-2 rounded-md font-semibold text-sm transition ' +
            (canSubmit
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-slate-200 text-slate-400 cursor-not-allowed')
          }
        >
          {onCancel ? 'Save' : 'Estimate savings'}
        </button>
      </div>
      {!canSubmit && (
        <p className="text-[10px] text-slate-500 text-center">
          Pick the customer's current carrier to continue.
        </p>
      )}
    </div>
  );
}

/**
 * @param {Object} props
 * @param {Object} props.workflow                 Live insurance workflow snapshot
 *                                                (same shape InsuranceAgentView
 *                                                reads). Required.
 * @param {Object|null} props.opportunity         The insurance opp record. Used
 *                                                for telemetry IDs and the
 *                                                vehicle line.
 * @param {function} props.onFindCoverage         Called when CTA clicked. Parent
 *                                                owns the spawn + active-workflow
 *                                                switch.
 * @param {function} [props.updateWorkflow]       Wave 36-fu6 — patches the live
 *                                                insurance workflow root. Used by
 *                                                the inline current-insurance
 *                                                editor to write the four
 *                                                self-reported fields.
 * @param {function} [props.updateOpportunity]    Wave 36-fu6 — persists the
 *                                                `current_insurance` block onto
 *                                                the opp record so it survives
 *                                                opp-switch/reopen.
 */
export function InsuranceSavingsCard({
  workflow,
  opportunity,
  onFindCoverage,
  updateWorkflow,
  updateOpportunity,
}) {
  const viewedRef = useRef(false);

  const status = workflow?.status;
  // Flow path drives quote-only-aware copy + CTA gating (ADR 26 D1).
  // The workflow snapshot already carries `flowPath` — `buildInitial`
  // (CoPilotPane.jsx) seeds it from `opportunity.flowPath`.
  const flowPath = workflow?.flowPath || 'capture_and_quote';
  const isQuoteOnly = flowPath === 'quote_only';
  const verification = workflow?.capture?.verification;
  const quote = workflow?.quote?.payload;
  const policy = workflow?.policy?.payload;
  const captureCarrier = verification?.policyInfo?.carrier || null;
  const newCarrier = quote?.carrier || null;
  const totalPremiumCents = quote?.totalPremiumCents ?? null;
  const sixMonthSavingsCents = quote?.savingsAmountCents ?? null;

  // ADR 26 D6-fu7 — single savings source for the quote.* phase split and
  // quote.* body rendering. The adapter normalises self-reported premium
  // (quote-only path) AND EI savingsAmountCents (capture+quote path) into
  // the same { status, monthlySavingsCents, captureCarrier, newCarrier }
  // shape. Returns null pre-quote (no quote.payload yet).
  const savings = mapInsuranceWorkflowToSavings(workflow);

  // Phase classification — drives copy + CTA enabled state.
  // Order matters: error > policy.bound > quote.* > capture.completed >
  // sent-not-viewed > pre-send.
  let phase;
  if (ERROR_STATUSES.has(status)) phase = 'error';
  else if (status === STATUS.POLICY_BOUND) phase = 'bound';
  else if (status === STATUS.QUOTE_COMPLETED || status === STATUS.QUOTE_VIEWED) {
    // D6-fu7: key on adapter status instead of raw EI savingsAmountCents so
    // the self-reported premium path (quote-only) is correctly classified.
    // For capture+quote: savings_found ⟺ old savingsAmountCents > 0 —
    // behavior-identical.
    phase = savings?.status === 'savings_found' ? 'quoted_with_savings' : 'quoted_no_savings';
  } else if (status === STATUS.CAPTURE_COMPLETED) phase = 'capture_only';
  else if (SENT_NOT_CAPTURED.has(status)) phase = 'sent';
  else if (PRE_SEND_STATUSES.has(status)) phase = 'pre_send';
  else phase = 'sent'; // unknown → treat as sent so card renders

  // Pre-send: card hidden. Origination form is what the agent works first.
  const isPreSend = phase === 'pre_send';

  // Telemetry — fire once when card actually renders.
  useEffect(() => {
    if (isPreSend) return;
    if (viewedRef.current) return;
    viewedRef.current = true;
    track('insurance.copilot.savings_card.viewed', {
      insurance_opp_id: opportunity?.id,
      has_capture: Boolean(verification),
      has_quote: Boolean(quote),
      savings_amount_cents: sixMonthSavingsCents,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreSend]);

  if (isPreSend) return null;

  // CTA is disabled only during capture-link sent-but-not-viewed/captured
  // (the agent can't usefully spawn protection until at least the carrier
  // is known). Everywhere else the CTA is active.
  //
  // ADR 26 D1 — on the quote-only path there is no carrier-capture event
  // to wait for, so the CTA stays enabled in the `sent` phase: the agent
  // can spawn a protection opp while the quote is still pending.
  const ctaDisabled = phase === 'sent' && !isQuoteOnly;

  // Diagnostic — fires once when D1 enables the CTA early on a quote-only
  // opp (i.e. the `sent` phase that would otherwise have it disabled).
  const earlyEnableFiredRef = useRef(false);
  useEffect(() => {
    if (phase === 'sent' && isQuoteOnly && !earlyEnableFiredRef.current) {
      earlyEnableFiredRef.current = true;
      track('mc.copilot.savings_card.find_coverage.enabled_in_sent', {
        insurance_opp_id: opportunity?.id,
        flow_path: flowPath,
        status,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, isQuoteOnly]);

  function handleFindCoverage() {
    if (ctaDisabled) return;
    track('insurance.copilot.find_coverage.clicked', {
      insurance_opp_id: opportunity?.id,
      contact_id: opportunity?.contact_id,
      vehicle_id: opportunity?.vehicle_id || null,
      current_premium_cents: totalPremiumCents,
      savings_amount_cents: sixMonthSavingsCents,
    });
    onFindCoverage?.();
  }

  // ---- Wave 36-fu6 (ADR 26 D6) — inline current-insurance editor ----
  //
  // The agent-side `CurrentInsuranceGate` is a PRE-SEND step gated on
  // `flowPath === 'quote_only'`, but the flow path is chosen in the
  // LeadOriginationForm which runs AFTER the gate sequence — so for a
  // brand-new agent-created opp the gate is never reached, and FORCE
  // STATUS skips all pre-send gates. This card is the always-reachable
  // surface: when a quote-only post-send opp carries no self-reported
  // premium, render a compact inline editor in place of the
  // "No carrier comparison" / no-savings block.
  const currentPremiumCents = workflow?.currentPremiumCents;
  const hasSelfReportedPremium = currentPremiumCents != null;
  // Post-send = anything the card actually renders (pre_send already
  // returned null above). The editor is relevant in sent / quoted_* /
  // bound / error — i.e. every rendered phase. capture_only is a
  // capture+quote-only phase, so the `isQuoteOnly` gate excludes it.
  const editorEligible = isQuoteOnly && !hasSelfReportedPremium;
  // When a premium IS present, the editor can still be re-opened via the
  // "Edit current insurance" affordance — local toggle.
  const [editorOpen, setEditorOpen] = useState(false);
  // Render the editor when eligible (no premium yet) OR when the agent
  // explicitly re-opened it over an existing value.
  const showEditor = editorEligible || (isQuoteOnly && editorOpen);

  function handleCurrentInsuranceSubmit({
    currentCarrier,
    currentCarrierId,
    currentPremiumCents: premiumCents,
    premiumCadence,
  }) {
    track('mc.copilot.savings_card.current_insurance_saved', {
      opp_id: opportunity?.id,
      carrier_id: currentCarrierId,
      premium_cents: premiumCents,
      cadence: premiumCadence,
    });
    // Workflow root — the savings adapter reads these on the next render.
    updateWorkflow?.({
      currentCarrier,
      currentCarrierId,
      currentPremiumCents: premiumCents,
      premiumCadence,
    });
    // Persist to the opp record so the data survives opp-switch / reopen
    // without depending on a later status change (ADR 26 D4-fu5).
    if (opportunity?.id) {
      updateOpportunity?.(opportunity.id, {
        current_insurance: {
          carrierId: currentCarrierId,
          carrier: currentCarrier,
          premiumCents,
          cadence: premiumCadence,
        },
      });
    }
    setEditorOpen(false);
  }

  // ---- Phase-specific body ----
  const body = (() => {
    if (phase === 'sent') {
      return (
        <div className="px-5 py-5 text-center space-y-2">
          <Loader2 className="w-5 h-5 text-blue-500 mx-auto animate-spin" />
          <div className="text-sm font-semibold text-slate-700">
            Customer is reviewing — savings TBD
          </div>
          <div className="text-xs text-slate-500">
            {isQuoteOnly
              ? "Quote link sent. The hero updates once the customer's quote is returned."
              : 'Capture link sent. The hero updates once the customer shares their current carrier.'}
          </div>
        </div>
      );
    }
    if (phase === 'capture_only') {
      return (
        <div className="px-5 py-5 space-y-3">
          <div className="text-center">
            <div className="text-xs font-medium text-rose-500">
              {captureCarrier
                ? `Currently with ${captureCarrier}`
                : 'Current carrier captured'}
            </div>
            <div className="text-xs text-slate-400 mt-2">
              Could save up to{' '}
              <span className="font-semibold text-slate-500">$—/mo</span>{' '}
              (quote pending)
            </div>
          </div>
          <div className="text-[11px] text-slate-500 text-center bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
            EI returns total premium with the quote — current monthly
            isn't surfaced by the verification step alone. We'll show the
            full comparison once the quote arrives.
          </div>
        </div>
      );
    }
    if (phase === 'quoted_with_savings') {
      // D6-fu7: monthlySavingsCents is already per-month from the adapter
      // (self-reported path: savings6mo/6; EI path: savingsAmountCents/6).
      // Use fmtUSD directly — NOT formatMonthlyFromSixMonthCents (which
      // divides by 6 again). captureCarrier / newCarrier come from the
      // adapter so quote-only self-reported carrier surfaces correctly.
      const monthlySavingsLabel = savings?.monthlySavingsCents != null
        ? '$' + Math.round(savings.monthlySavingsCents / 100).toLocaleString()
        : null;
      const savingsCarrier = savings?.captureCarrier || null;
      const savingsNewCarrier = savings?.newCarrier || null;
      const newMonthlyLabel = formatMonthlyFromSixMonthCents(totalPremiumCents);
      return (
        <div className="px-5 py-5 space-y-4">
          {/* Current carrier line — from adapter (EI or self-reported). */}
          {savingsCarrier && (
            <div className="text-center text-sm text-slate-600">
              Customer is currently with{' '}
              <span className="font-semibold text-slate-800">{savingsCarrier}</span>
            </div>
          )}

          {/* Savings hero */}
          <div className="text-center py-1">
            <div className="text-xs font-medium text-emerald-600">
              Could save up to
            </div>
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-4xl font-bold text-emerald-600">
                {monthlySavingsLabel}
              </span>
              <div className="text-xs text-emerald-500 leading-tight text-left">
                <div>per</div>
                <div>month</div>
              </div>
            </div>
            {newMonthlyLabel && savingsNewCarrier && (
              <div className="text-[11px] text-slate-500 mt-1">
                New premium: {newMonthlyLabel}/mo with{' '}
                <span className="font-medium">{savingsNewCarrier}</span>
              </div>
            )}
          </div>

          {/* Coverage checklist — derived from verification (when present) */}
          <CoverageChecklist verification={verification} />
        </div>
      );
    }
    if (phase === 'quoted_no_savings') {
      // D6-fu7: read carrier from the adapter so a quote-only opp whose
      // self-reported carrier is known shows "Customer is currently with
      // Allstate." even when there's no EI verification carrier.
      const noSavingsCarrier = savings?.captureCarrier || null;
      return (
        <div className="px-5 py-5 space-y-3">
          <div className="text-center text-sm text-slate-600">
            {noSavingsCarrier ? (
              <>
                Customer is currently with{' '}
                <span className="font-semibold text-slate-800">
                  {noSavingsCarrier}
                </span>
                .
              </>
            ) : (
              <>No carrier comparison available.</>
            )}
          </div>
          <div className="text-center bg-slate-50 border border-slate-200 rounded-md px-3 py-3 text-sm text-slate-600">
            <TrendingDown className="w-4 h-4 text-slate-400 mx-auto mb-1" />
            <div className="font-semibold">
              We added a task to monitor for savings.
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              No better rate found today. Protection coverage is still a
              great fit.
            </div>
          </div>
        </div>
      );
    }
    if (phase === 'bound') {
      const monthlySavingsLabel = formatMonthlyFromSixMonthCents(sixMonthSavingsCents);
      return (
        <div className="px-5 py-5 space-y-2">
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
            <Award className="w-4 h-4 text-emerald-600 shrink-0" />
            <div className="text-sm text-emerald-900">
              <span className="font-semibold">Policy bound</span>
              {policy?.carrier ? <> with {policy.carrier}</> : null}
              {monthlySavingsLabel ? (
                <span className="text-emerald-700 font-medium">
                  {' '}
                  — saving {monthlySavingsLabel}/mo
                </span>
              ) : null}
            </div>
          </div>
        </div>
      );
    }
    if (phase === 'error') {
      const reason =
        status === STATUS.ERROR_VERIFICATION
          ? 'Verification failed — partner could not confirm policy.'
          : status === STATUS.ERROR_QUOTE
            ? 'Quote unavailable — eligibility decline or rate-table miss.'
            : 'Duplicate lead — partner already has this customer.';
      return (
        <div className="px-5 py-5 space-y-2">
          <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
            <div className="text-sm text-rose-800">{reason}</div>
          </div>
          <div className="text-[11px] text-slate-500 text-center">
            You can still spawn a protection opportunity for this contact.
          </div>
        </div>
      );
    }
    return null;
  })();

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-slate-100 flex items-start gap-3">
        <div className="w-9 h-9 rounded-full flex items-center justify-center border bg-orange-50 text-orange-700 border-orange-200 shrink-0">
          <ShieldCheck className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">
            Insurance · At a Glance
          </div>
          <div className="text-base font-semibold tracking-tight text-slate-900 truncate">
            {phase === 'bound' ? 'Policy bound' : 'Insurance at a glance'}
          </div>
          {opportunity?.vehicle && (
            <div className="text-xs text-slate-500 truncate">
              for <span className="text-orange-600 font-medium">{opportunity.vehicle}</span>
            </div>
          )}
        </div>
      </div>

      {/* Wave 36-fu6 (ADR 26 D6) — the inline current-insurance editor
          replaces the phase body when a quote-only post-send opp has no
          self-reported premium (or the agent re-opened it). Otherwise the
          phase body renders as before; on the quote-only path with a
          premium present, a small "Edit current insurance" affordance
          re-opens the editor. */}
      {showEditor ? (
        <CurrentInsuranceEditor
          initialCarrierId={workflow?.currentCarrierId ?? null}
          initialPremiumCents={
            currentPremiumCents != null ? currentPremiumCents : null
          }
          initialCadence={workflow?.premiumCadence || '6mo'}
          onSubmit={handleCurrentInsuranceSubmit}
          // Cancel is only meaningful when re-opened over an existing
          // value — when there's no premium yet the editor is the only
          // content, so there's nothing to fall back to.
          onCancel={
            hasSelfReportedPremium ? () => setEditorOpen(false) : undefined
          }
        />
      ) : (
        <>
          {body}
          {isQuoteOnly && hasSelfReportedPremium && (
            <div className="px-5 -mt-2 pb-3 text-center">
              <button
                type="button"
                onClick={() => setEditorOpen(true)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-blue-600 transition"
              >
                <Pencil className="w-3 h-3" />
                Edit current insurance
              </button>
            </div>
          )}
        </>
      )}

      {/* Find Coverage CTA — always present (per ADR D3 the only state
          that hides the entire card is pre-send, handled earlier). */}
      <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50">
        <button
          type="button"
          onClick={handleFindCoverage}
          disabled={ctaDisabled}
          className={
            'w-full px-4 py-2.5 rounded-md font-semibold text-sm transition ' +
            (ctaDisabled
              ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 text-white')
          }
          title={
            ctaDisabled
              ? 'Wait for the customer to share their carrier before spawning protection'
              : undefined
          }
        >
          Find Coverage
        </button>
        {!ctaDisabled && (
          <div className="text-[10px] text-slate-400 mt-2 text-center">
            Spawns a protection opportunity prefilled with vehicle + driving data.
          </div>
        )}
      </div>
    </div>
  );
}

function CoverageChecklist({ verification }) {
  // EI verification surfaces policyInfo (carrier, policy number, vehicles,
  // named insureds) but NOT coverage limits / deductibles / current
  // premium per ADR 06. So this checklist is informational — confirms
  // what the carrier DOES surface so the agent knows what to verify
  // verbally.
  const policyInfo = verification?.policyInfo;
  if (!policyInfo) return null;
  const items = [
    {
      label: 'Carrier verified',
      pass: Boolean(policyInfo.carrier),
    },
    {
      label: 'Policy number on file',
      pass: Boolean(policyInfo.policyNumber),
    },
    {
      label: 'Vehicle matched',
      pass:
        Array.isArray(policyInfo.vehicles) &&
        policyInfo.vehicles.length > 0,
    },
    {
      label: 'Named insureds confirmed',
      pass:
        Array.isArray(policyInfo.namedInsureds) &&
        policyInfo.namedInsureds.length > 0,
    },
  ];
  return (
    <div className="space-y-1.5">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-2 text-xs">
          <CheckCircle2
            className={
              'w-4 h-4 shrink-0 ' + (it.pass ? 'text-emerald-500' : 'text-slate-300')
            }
          />
          <span className={it.pass ? 'text-slate-700' : 'text-slate-400'}>
            {it.label}
          </span>
        </div>
      ))}
    </div>
  );
}
