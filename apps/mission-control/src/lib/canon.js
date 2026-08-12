// Mission-control canon-derived UI helpers. Extracted from AgentInbox /
// CoPilotPane / ContactProfile when the third consumer arrived (per the
// "extract when third consumer shows up" rule documented in earlier
// STATUS.md entries). Single source of truth for workflow type labels,
// type-badge classes, status pill colors, and the pinned TODAY ageDays.
//
// Stays in mission-control for now — sibling apps each have their own
// equivalents (protection-portal AgentChrome's pillClasses, etc.). When a
// fourth consumer arrives across apps, lift to blinker-platform/canon-ui/
// and `file:` import.
import ghlStatus from '../constants/canon/ghl-status.json';
import orgRegistry from '../constants/canon/org-registry.json';

export const TYPE_LABELS = {
  protection: 'Protection',
  refi: 'Refi',
  insurance: 'Insurance',
  payments: 'Payments',
};

export const TYPE_BADGE = {
  protection: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  refi: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  insurance: 'bg-sky-50 text-sky-700 ring-sky-200',
  payments: 'bg-amber-50 text-amber-700 ring-amber-200',
};

// Canon types use "vsc" for protection; "refi" stores statuses_summary
// (no per-status crm_stage), so refi colorization falls through to regex
// bucketing. See blinker-platform STATUS.md "Pending canon work" — refi
// machine_id pattern + payments block both pending.
function lookupStage(type, status) {
  if (type === 'protection') return ghlStatus.vsc?.statuses?.[status]?.crm_stage ?? null;
  if (type === 'insurance') return ghlStatus.insurance?.statuses?.[status]?.crm_stage ?? null;
  return null;
}

export function statusPillClasses(type, status) {
  const stage = lookupStage(type, status);
  if (/lost|cancel|decline|fail|not interested/i.test(status)) {
    return 'bg-rose-50 text-rose-700 ring-rose-200';
  }
  if (/late|pending/i.test(status)) {
    return 'bg-amber-50 text-amber-700 ring-amber-200';
  }
  if (/won|signed|funded|policy written|paid in full|active|remitted/i.test(status)) {
    return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  }
  if (/^working|offer|quoted|sent|reviewed|booked|capture|quote/i.test(status)) {
    return 'bg-blue-50 text-blue-700 ring-blue-200';
  }
  if (stage === 'Won' || stage === 'Active' || stage === 'Paid in Full') {
    return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  }
  if (stage === 'Lost' || stage === 'Cancelled') {
    return 'bg-rose-50 text-rose-700 ring-rose-200';
  }
  if (stage === 'Working' || stage === 'Quoted') {
    return 'bg-blue-50 text-blue-700 ring-blue-200';
  }
  return 'bg-slate-100 text-slate-700 ring-slate-200';
}

// TODAY is pinned so fixture-driven age labels stay stable across sessions.
// Bump alongside fixture refreshes, not on every system clock tick.
export const TODAY = new Date('2026-05-03T12:00:00Z');

export function ageDays(iso) {
  if (!iso) return 0;
  return Math.max(0, Math.floor((TODAY - new Date(iso)) / (1000 * 60 * 60 * 24)));
}

export function ageLabel(d) {
  if (d === 0) return 'today';
  if (d === 1) return '1 day';
  return `${d} days`;
}

export function relativeTime(iso) {
  if (!iso) return '—';
  const ms = TODAY - new Date(iso);
  if (ms < 0) return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric' });
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Default fallback TZ when an org id can't be resolved (or no org is in
// context). 'America/Chicago' is the mid-US benchmark Apex (the demo
// anchor) already uses.
export const DEFAULT_ORG_TZ = 'America/Chicago';

// Active-org id lookup. Today the app doesn't have a real org switcher;
// we resolve via the first canon org with `status === 'active'` (Apex
// 102 is the default landed in Phase 1 fixtures). When the switcher
// lands in Phase 2 this helper becomes parameterized.
export function getActiveOrgId() {
  const orgs = Array.isArray(orgRegistry.orgs) ? orgRegistry.orgs : [];
  const active = orgs.find((o) => o.status === 'active');
  return active ? active.id : null;
}

export function getOrgTimezone(orgId) {
  if (!orgId) return DEFAULT_ORG_TZ;
  const orgs = Array.isArray(orgRegistry.orgs) ? orgRegistry.orgs : [];
  const org = orgs.find((o) => o.id === orgId);
  return org?.timezone || DEFAULT_ORG_TZ;
}

// Format an ISO timestamp in the active org's timezone — e.g.
// "May 11, 10:42 AM CDT". Uses Intl.DateTimeFormat with timeZoneName:
// 'short' to surface the TZ abbreviation; we tease the abbreviation
// out of formatToParts so the rest of the string can be displayed
// independently.
export function formatOrgTime(iso, tz = DEFAULT_ORG_TZ) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  return fmt.format(d);
}

// crmStageOf — defensive helper. Returns one of:
//   'open' | 'won' | 'lost' | 'abandoned' | 'unknown'
// 'unknown' is treated as 'open' at the call site (see AgentHome's
// funnel-header logic), so this stays safely permissive for refi
// (whose canon only ships statuses_summary, no per-status crm_stage)
// and payments (whose canon block is not built yet).
//
// Mapping from canon crm_stage strings to our 4-bucket taxonomy:
//   Won / Active / Paid in Full / Payment Success / Captured / Quoted /
//     Quote Viewed   → won-ish ONLY if explicit 'Won'/'Active'/'Paid in Full'
//   Lost / Cancelled → lost
//   (no canon stage for 'abandoned' yet — we leave it null; UI shows 0)
//   Anything else    → open
function bucketStage(stage, statusText) {
  if (!stage) {
    // Status-string regex fallback for the refi/payments canon gap.
    if (/lost|cancel|decline|fail|not interested/i.test(statusText || '')) return 'lost';
    if (/won|funded|paid in full|active|remitted|signed|policy bound|policy written/i.test(statusText || '')) return 'won';
    if (/abandon/i.test(statusText || '')) return 'abandoned';
    return 'unknown';
  }
  if (stage === 'Lost') return 'lost';
  if (stage === 'Cancelled') return 'lost'; // cancelled rolls into lost for funnel display
  if (stage === 'Won' || stage === 'Active' || stage === 'Paid in Full') return 'won';
  // Everything else (New Lead, Working, Quoted, Captured, Quote Viewed,
  // Contacted, Duplicate Lead, Payment Success, Pending, …) is still
  // 'open' from the agent's funnel-snapshot POV — payment success isn't
  // booked yet, capture/quote stages are in-flight, etc.
  return 'open';
}

export function crmStageOf(opp) {
  if (!opp) return 'unknown';
  const stage = lookupStage(opp.type, opp.status);
  return bucketStage(stage, opp.status);
}

// Date-range helpers for AgentHome's date filter lens. Each builder
// returns { from: Date, to: Date, label: string } relative to TODAY
// (the pinned fixture date), so the lens works deterministically
// against fixture data.
//
// Semantics:
//   recent      — last 30 days (default)
//   last_month  — previous full calendar month (TODAY's prior month)
//   this_month  — TODAY's calendar month, start-of-month → TODAY
//   year_to_date — Jan 1 of TODAY's year → TODAY
//   last_week   — previous full Mon-Sun
//   this_week   — Monday of current week → TODAY
//   yesterday   — calendar yesterday, 00:00 → 23:59
function startOfDay(d) {
  const c = new Date(d);
  c.setUTCHours(0, 0, 0, 0);
  return c;
}
function endOfDay(d) {
  const c = new Date(d);
  c.setUTCHours(23, 59, 59, 999);
  return c;
}

export const DATE_LENS_OPTIONS = [
  { value: 'recent', label: 'Recent (30d)', headerLabel: 'in last 30 days' },
  { value: 'last_month', label: 'Last Month', headerLabel: 'Last Month' },
  { value: 'this_month', label: 'This Month', headerLabel: 'This Month' },
  { value: 'year_to_date', label: 'Year to Date', headerLabel: 'Year to Date' },
  { value: 'last_week', label: 'Last Week', headerLabel: 'Last Week' },
  { value: 'this_week', label: 'This Week', headerLabel: 'This Week' },
  { value: 'yesterday', label: 'Yesterday', headerLabel: 'Yesterday' },
];

export function dateLensRange(value) {
  const today = startOfDay(TODAY);
  const todayEnd = endOfDay(TODAY);
  switch (value) {
    case 'last_month': {
      const y = today.getUTCFullYear();
      const m = today.getUTCMonth();
      const from = new Date(Date.UTC(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1, 1));
      const to = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)); // day 0 of current month = last day prev month
      return { from, to, value };
    }
    case 'this_month': {
      const y = today.getUTCFullYear();
      const m = today.getUTCMonth();
      const from = new Date(Date.UTC(y, m, 1));
      return { from, to: todayEnd, value };
    }
    case 'year_to_date': {
      const y = today.getUTCFullYear();
      const from = new Date(Date.UTC(y, 0, 1));
      return { from, to: todayEnd, value };
    }
    case 'last_week': {
      // ISO week: Monday start. Find this Monday (UTC), back up 7 days.
      const dow = today.getUTCDay(); // 0=Sun, 1=Mon, ... 6=Sat
      const daysSinceMon = (dow + 6) % 7; // 0 if Mon, 1 if Tue, ... 6 if Sun
      const thisMon = new Date(today);
      thisMon.setUTCDate(today.getUTCDate() - daysSinceMon);
      const lastMon = new Date(thisMon);
      lastMon.setUTCDate(thisMon.getUTCDate() - 7);
      const lastSun = new Date(thisMon);
      lastSun.setUTCDate(thisMon.getUTCDate() - 1);
      return { from: lastMon, to: endOfDay(lastSun), value };
    }
    case 'this_week': {
      const dow = today.getUTCDay();
      const daysSinceMon = (dow + 6) % 7;
      const thisMon = new Date(today);
      thisMon.setUTCDate(today.getUTCDate() - daysSinceMon);
      return { from: thisMon, to: todayEnd, value };
    }
    case 'yesterday': {
      const y = new Date(today);
      y.setUTCDate(today.getUTCDate() - 1);
      return { from: y, to: endOfDay(y), value };
    }
    case 'recent':
    default: {
      const from = new Date(today);
      from.setUTCDate(today.getUTCDate() - 30);
      return { from, to: todayEnd, value: 'recent' };
    }
  }
}

// Check whether `iso` falls inside a lens range (inclusive). Falsy iso
// returns false so opps without created_at are not bucketed.
export function withinLens(iso, range) {
  if (!iso || !range) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t >= range.from.getTime() && t <= range.to.getTime();
}
