// Vertical lead-status timeline. Canon-driven: reads
// canon/ghl-status.json#insurance.statuses, filters to a flow-path-
// specific subset, renders main path with terminal off-path branches
// for failure paths.
//
// Two main paths per `_insurance_flow_paths` in canon:
//
//   capture_and_quote (preferred):
//     started → lead.created → capture_link.created → capture_link.sent
//     → capture_link.viewed → capture.completed → quote.completed
//     → quote.viewed → policy.bound
//
//   quote_only (escape hatch):
//     started → lead.created → quote_link.created → quote_link.sent
//     → quote_link.viewed → quote.completed → quote.viewed → policy.bound
//
// Off-path branches: error.verification (only reachable from
// capture+quote), error.quote (both paths), duplicate (4xx on POST,
// not a webhook — fired by LeadOriginationForm directly).
//
// Source of truth: changing canon order or adding a new agent-flow
// status to a subset list is the only place the timeline shape can
// change — no per-component constants.
import { AlertTriangle, Check, Copy, Gauge, Loader2 } from 'lucide-react';
import canon from '../../constants/canon/ghl-status.json';
import orgRegistry from '../../constants/canon/org-registry.json';
import { STATUS, getInsuranceStatus } from '../../constants/status-map.js';

const CAPTURE_AND_QUOTE_PATH = [
  STATUS.STARTED,
  STATUS.LEAD_CREATED,
  STATUS.CAPTURE_LINK_CREATED,
  STATUS.CAPTURE_LINK_SENT,
  STATUS.CAPTURE_LINK_VIEWED,
  STATUS.CAPTURE_COMPLETED,
  STATUS.QUOTE_COMPLETED,
  STATUS.QUOTE_VIEWED,
  STATUS.POLICY_BOUND,
];

const QUOTE_ONLY_PATH = [
  STATUS.STARTED,
  STATUS.LEAD_CREATED,
  STATUS.QUOTE_LINK_CREATED,
  STATUS.QUOTE_LINK_SENT,
  STATUS.QUOTE_LINK_VIEWED,
  STATUS.QUOTE_COMPLETED,
  STATUS.QUOTE_VIEWED,
  STATUS.POLICY_BOUND,
];

const TERMINAL_OFF_PATH_MACHINE_IDS = [
  STATUS.ERROR_VERIFICATION,
  STATUS.ERROR_QUOTE,
  STATUS.DUPLICATE,
];

// Module-load validation — throws if canon and the subset lists drift
// apart, which is better than silently rendering empty rows.
const ALL_REFERENCED_IDS = [
  ...new Set([
    ...CAPTURE_AND_QUOTE_PATH,
    ...QUOTE_ONLY_PATH,
    ...TERMINAL_OFF_PATH_MACHINE_IDS,
  ]),
];
for (const id of ALL_REFERENCED_IDS) {
  if (!getInsuranceStatus(id)) {
    throw new Error(
      `LeadStatusTimeline: machine_id "${id}" not present in canon ` +
      `${canon._version || canon._synced_version}. Re-sync or update the subset.`
    );
  }
}

function pickMainPath(flowPath) {
  return flowPath === 'quote_only' ? QUOTE_ONLY_PATH : CAPTURE_AND_QUOTE_PATH;
}

// Org timezone lookup — reads org-registry.json by orgId.
// Falls back to undefined (browser-local TZ) when lookup misses.
function timezoneForOrg(orgId) {
  if (orgId == null) return undefined;
  const org = orgRegistry?.orgs?.find((o) => o.id === orgId);
  return org?.timezone || undefined;
}

// Build Intl.DateTimeFormat instances anchored to the org's timezone.
// `dayKey` uses sv-SE locale which reliably produces YYYY-MM-DD —
// used as a stable string key for day-separator grouping.
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

// Format cents → "$1,234" (no decimals). Returns '$—' for null/undefined.
function formatCents(cents) {
  if (cents == null) return '$—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function nodeState(machineId, currentStatus, passed) {
  if (passed?.has(machineId)) return 'past';
  if (machineId === currentStatus) return 'current';
  return 'future';
}

// ─── Detail blocks ────────────────────────────────────────────────────────────

function CaptureDetail({ verification }) {
  if (!verification) return null;
  const { policyInfo, source, media, verifiedAt } = verification;
  const primaryVehicle = policyInfo?.vehicles?.[0];
  const mediaUrl = media?.[0]?.url;
  return (
    <div className="mt-2 space-y-1 text-xs text-slate-600">
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

// Normalize the self-reported premium to a 6-month basis.
// monthly -> x6, 6mo -> x1, 12mo -> /2. Returns null when input is absent.
function normalizeToSixMonth(premiumCents, cadence) {
  if (premiumCents == null || premiumCents <= 0) return null;
  if (cadence === 'monthly') return premiumCents * 6;
  if (cadence === '12mo') return Math.round(premiumCents / 2);
  // '6mo' or unknown -> treat as 6-month basis (pass-through)
  return premiumCents;
}

function QuoteDetail({ quote, formatters, currentCarrier, currentPremiumCents, premiumCadence }) {
  if (!quote) return null;
  const { carrier, totalPremiumCents, savingsAmountCents, createdAt } = quote;

  // Determine which savings line to render.
  let savingsLine;
  if (savingsAmountCents != null && savingsAmountCents > 0) {
    // Case 1: EI returned a positive savings figure (capture+quote path).
    savingsLine = (
      <div className="text-emerald-700">
        Savings {formatCents(savingsAmountCents)} / 6mo{' '}
        <span className="text-slate-500">
          (&#8776; {formatCents(savingsAmountCents * 2)} / yr)
        </span>
      </div>
    );
  } else {
    const normalized6mo = normalizeToSixMonth(currentPremiumCents, premiumCadence);
    if (normalized6mo != null && totalPremiumCents != null) {
      // Case 2: self-reported premium + a quoted total -> compute estimated savings.
      const savings6moCents = normalized6mo - totalPremiumCents;
      if (savings6moCents > 0) {
        savingsLine = (
          <div className="text-emerald-700">
            Est. savings {formatCents(savings6moCents)} / 6mo vs {currentCarrier || 'current carrier'}{' '}
            <span className="text-slate-500">
              (&#8776; {formatCents(savings6moCents * 2)} / yr)
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
      // Case 3: no self-reported premium and no EI savings figure.
      savingsLine = (
        <div className="text-slate-400">No savings comparison (quote-only path)</div>
      );
    }
  }

  return (
    <div className="mt-2 space-y-1 text-xs text-slate-600">
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
    <div className="mt-2 text-xs text-slate-500">
      Viewed at {formatters.time.format(new Date(viewedAt))}
    </div>
  );
}

function PolicyDetail({ policy }) {
  if (!policy) return null;
  const { carrier, id } = policy;
  return (
    <div className="mt-2 space-y-1 text-xs text-slate-600">
      {carrier && (
        <div>
          Carrier: <span className="font-medium">{carrier}</span>
        </div>
      )}
      {id && (
        <div className="flex items-baseline gap-1">
          <span>Reference:</span>
          <span className="font-mono">{id}</span>
          <span className="text-[10px] text-amber-700">(policy_number pending — EI does not surface today)</span>
        </div>
      )}
    </div>
  );
}

// Pick the appropriate detail block for a given machineId.
function EventDetail({ machineId, workflow, formatters }) {
  switch (machineId) {
    case STATUS.CAPTURE_COMPLETED:
      return <CaptureDetail verification={workflow?.capture?.verification} />;
    case STATUS.QUOTE_COMPLETED:
      return (
        <QuoteDetail
          quote={workflow?.quote?.payload}
          formatters={formatters}
          currentCarrier={workflow?.currentCarrier}
          currentPremiumCents={workflow?.currentPremiumCents}
          premiumCadence={workflow?.premiumCadence}
        />
      );
    case STATUS.QUOTE_VIEWED:
      return <QuoteViewedDetail quote={workflow?.quote?.payload} formatters={formatters} />;
    case STATUS.POLICY_BOUND:
      return <PolicyDetail policy={workflow?.policy?.payload} />;
    default:
      return null;
  }
}

// ─── Day separator ────────────────────────────────────────────────────────────

function DaySeparator({ label }) {
  return (
    <div className="flex items-center gap-3 my-3" aria-label={`Date: ${label}`}>
      <div className="flex-1 h-px bg-slate-200" />
      <div className="text-xs uppercase tracking-wide text-slate-400 font-semibold">{label}</div>
      <div className="flex-1 h-px bg-slate-200" />
    </div>
  );
}

// ─── Main node ────────────────────────────────────────────────────────────────

function MainNode({ machineId, state, timestamp, isLast, workflow, formatters }) {
  const entry = getInsuranceStatus(machineId);
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div
          className={
            'w-7 h-7 rounded-full flex items-center justify-center shrink-0 ' +
            (state === 'past'
              ? 'bg-emerald-500 text-white'
              : state === 'current'
                ? 'bg-blue-600 text-white animate-pulse'
                : 'bg-slate-200 text-slate-400')
          }
        >
          {state === 'past' ? (
            <Check className="w-4 h-4" />
          ) : state === 'current' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-slate-400" />
          )}
        </div>
        {!isLast && (
          <div
            className={
              'w-px flex-1 my-1 ' +
              (state === 'past' ? 'bg-emerald-300' : 'bg-slate-200')
            }
          />
        )}
      </div>
      <div className="pb-5 -mt-0.5">
        <div
          className={
            'text-sm font-semibold ' +
            (state === 'future' ? 'text-slate-400' : 'text-slate-900')
          }
        >
          {entry.label}
        </div>
        <div
          className={
            'text-xs mt-0.5 ' +
            (state === 'future' ? 'text-slate-300' : 'text-slate-500')
          }
        >
          <span className="font-mono">{machineId}</span>
          {timestamp && formatters && (
            <span className="ml-2 text-slate-400">
              {formatters.time.format(new Date(timestamp))}
            </span>
          )}
        </div>
        {state === 'past' && (
          <EventDetail machineId={machineId} workflow={workflow} formatters={formatters} />
        )}
      </div>
    </div>
  );
}

// ─── Off-path node ────────────────────────────────────────────────────────────

// Tone palette uses literal class strings so the Tailwind CDN compiler
// picks them up. Don't switch to dynamic `bg-${tone}-50` — JIT only
// sees literals in source.
const OFF_PATH_TONE = {
  [STATUS.ERROR_VERIFICATION]: {
    Icon: AlertTriangle,
    container: 'bg-rose-50 border-rose-200',
    badge: 'bg-rose-500 text-white',
    label: 'text-rose-900',
  },
  [STATUS.ERROR_QUOTE]: {
    Icon: AlertTriangle,
    container: 'bg-rose-50 border-rose-200',
    badge: 'bg-rose-500 text-white',
    label: 'text-rose-900',
  },
  [STATUS.DUPLICATE]: {
    Icon: Copy,
    container: 'bg-amber-50 border-amber-200',
    badge: 'bg-amber-500 text-white',
    label: 'text-amber-900',
  },
};

function OffPathNode({ machineId, isCurrent, workflow }) {
  const entry = getInsuranceStatus(machineId);
  const tone = OFF_PATH_TONE[machineId];
  const Icon = tone.Icon;

  // Minimal partial-data hint: if verification ran before a quote-phase
  // error, surface the captured carrier so the agent has context.
  const capturedCarrier = workflow?.capture?.verification?.policyInfo?.carrier;
  const showCaptureHint =
    isCurrent &&
    machineId === STATUS.ERROR_QUOTE &&
    capturedCarrier;

  return (
    <div
      className={
        'flex items-center gap-3 px-3 py-2 rounded-md border ' +
        (isCurrent ? tone.container : 'bg-slate-50 border-slate-200 opacity-60')
      }
    >
      <div
        className={
          'w-7 h-7 rounded-full flex items-center justify-center shrink-0 ' +
          (isCurrent ? tone.badge : 'bg-slate-200 text-slate-400')
        }
      >
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <div
          className={
            'text-sm font-semibold ' +
            (isCurrent ? tone.label : 'text-slate-500')
          }
        >
          {entry.label}
        </div>
        <div className="text-xs text-slate-500 mt-0.5 font-mono">{machineId}</div>
        {showCaptureHint && (
          <div className="text-xs text-slate-500 mt-0.5">
            Captured: {capturedCarrier}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Vehicle context card ─────────────────────────────────────────────────────
//
// Renders once the consumer completes the vehicle_drive step (mileage set).
// Wave 31 v3.0.11 — ADR 21 D1/B1. Shows the three fields the PDF Task 1
// contact-card specifies:
//   • Mileage: 28,100 mi
//   • Est. annual mileage: 14,100 mi/yr
//   • Condition: Used
//
// Reads from workflow.vehicle (written by insurance CustomerView VehicleDrive).
// Rendered above the main timeline when at least `mileage` is present.

function formatMileage(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US').format(n) + ' mi';
}

function formatAnnualMileage(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US').format(n) + ' mi/yr';
}

function formatCondition(c) {
  if (!c) return '—';
  return c.charAt(0).toUpperCase() + c.slice(1);
}

function VehicleContextCard({ vehicle }) {
  const mileage = vehicle?.mileage;
  if (mileage == null) return null;
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 mb-4">
      <div className="flex items-center gap-1.5 mb-2">
        <Gauge className="w-3.5 h-3.5 text-slate-500" />
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Vehicle — driving info
        </span>
      </div>
      <div className="space-y-1 text-sm text-slate-700">
        <div className="flex justify-between">
          <span className="text-slate-500">Mileage</span>
          <span className="font-medium tabular-nums">{formatMileage(vehicle.mileage)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Est. annual mileage</span>
          <span className="font-medium tabular-nums">{formatAnnualMileage(vehicle.annual_miles_estimate)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Condition</span>
          <span className="font-medium">{formatCondition(vehicle.condition)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function LeadStatusTimeline({ workflow, history, orgId }) {
  const status = workflow?.status;
  const flowPath = workflow?.flowPath || 'capture_and_quote';
  const mainPath = pickMainPath(flowPath);
  const passed = new Set(history?.map((h) => h.machineId) || []);
  const timestampFor = (id) =>
    history?.find((h) => h.machineId === id)?.at || null;

  const timezone = timezoneForOrg(orgId);
  const formatters = makeFormatters(timezone);

  // Quote Only never runs verification, so error.verification is
  // structurally unreachable on that path — drop it from the off-path
  // list. The canonical TERMINAL_OFF_PATH_MACHINE_IDS still drives
  // module-load canon validation; this filter is render-time only.
  const offPathForFlow =
    flowPath === 'quote_only'
      ? TERMINAL_OFF_PATH_MACHINE_IDS.filter((id) => id !== STATUS.ERROR_VERIFICATION)
      : TERMINAL_OFF_PATH_MACHINE_IDS;

  const showOffPath = offPathForFlow.includes(status);

  // Build the main-path rows, interleaving DaySeparator above the first
  // past event of each calendar day (in the org's TZ). Future events
  // have no timestamp so they don't anchor to a day.
  let lastDayKey = null;
  const rows = [];
  for (let i = 0; i < mainPath.length; i++) {
    const id = mainPath[i];
    const ts = timestampFor(id);
    const isPast = passed.has(id);
    if (isPast && ts) {
      const k = formatters.dayKey.format(new Date(ts));
      if (k !== lastDayKey) {
        rows.push(
          <DaySeparator
            key={`day-${k}`}
            label={formatters.day.format(new Date(ts))}
          />
        );
        lastDayKey = k;
      }
    }
    rows.push(
      <MainNode
        key={id}
        machineId={id}
        state={nodeState(id, status, passed)}
        timestamp={ts}
        isLast={i === mainPath.length - 1}
        workflow={workflow}
        formatters={formatters}
      />
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-blue-600 font-semibold">
            Lead status
          </div>
          <h2 className="text-lg font-semibold tracking-tight">
            {flowPath === 'quote_only' ? 'Quote-only progress' : 'Capture + quote progress'}
          </h2>
        </div>
        <div className="text-xs text-slate-400 font-mono">
          {workflow?.lead?.leadId || 'no lead yet'}
        </div>
      </div>

      {/* Vehicle driving info — rendered once consumer completes vehicle_drive step */}
      <VehicleContextCard vehicle={workflow?.vehicle} />

      <div>{rows}</div>

      {showOffPath && (
        <div className="mt-2 pt-4 border-t border-slate-100 space-y-2">
          <div className="text-xs uppercase tracking-wide text-slate-400 font-semibold">
            Terminal — off-path
          </div>
          {offPathForFlow.map((id) => (
            <OffPathNode
              key={id}
              machineId={id}
              isCurrent={status === id}
              workflow={workflow}
            />
          ))}
        </div>
      )}
    </div>
  );
}
