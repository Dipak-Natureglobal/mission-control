import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Users,
  Filter,
  Search,
  HelpCircle,
  SlidersHorizontal,
  X,
  ArrowUpDown,
  ArrowDown,
  ArrowUp,
} from 'lucide-react';
import { ContactProfile } from './ContactProfile.jsx';
import { useSessionData } from '../../lib/session-data.js';
import { ageLabel, ageDays, statusPillClasses } from '../../lib/canon.js';
import { AdvancedFilter, applyFilters, describeFilterValue } from '../../shared/AdvancedFilter.jsx';
import { BackToTop } from '../../shared/BackToTop.jsx';
import { Tooltip } from '../../shared/Tooltip.jsx';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll.js';
import { vehicleShortLabel, latestOppOfType } from '../../shared/opp-cell-helpers.js';
import { track } from 'blinker-platform/telemetry';
import ghlStatus from '../../constants/canon/ghl-status.json';
import {
  getAccessibleOrgs,
  deriveOwnerOrgMap,
  ownersForOrgs,
} from '../../lib/agent-access.js';

// AgentContacts — contact-centric table surface. Counterpart to AgentInbox
// (which is opportunity-centric). This surface is the only place in the
// agent shell where contacts without any opportunities can be found and
// clicked into. Contacts WITH opportunities still appear here too — the
// surface covers ALL contacts in the session, regardless of opp status.
//
// Right-pane routing mirrors AgentInbox exactly: a `right` state machine
// drives `null` | `{ kind: 'profile', contactId }`. Clicking a row opens
// ContactProfile — the same component AgentInbox uses. This is intentional
// reuse, not duplication: no second contact-profile component.
//
// Columns (Wave 26a Phase 3 / Task 2a-E):
//   Name | Vehicles | Refi | Ins | VSC | Last activity | Tags
//   - Refi / Ins / VSC each render the latest opp of that type for the
//     contact: "'YY Model" + status pill, hover shows next_action. Click
//     opens CoPilot for that opp via onOpenOppInCoPilot. Empty/dim em-dash
//     when the contact has no opp of that type.
//   - When `testMode === true` AND the contact has at least one opp with
//     a `_test_case`, a HelpCircle icon appears next to the contact name
//     with a native `title` tooltip listing each opp's scenario (Task 2a-F
//     — same pattern AgentInbox uses; the standalone "Test case" column
//     was removed in favor of the icon-tooltip).
//
// Quick filter dropdown: All | With opportunities | Without opportunities | Without vehicle.
// "Filters" button (Wave 26a Phase 3 / Task 2a-C) opens the same
// AdvancedFilter modal used by AgentInbox. Schema parity: contact-level
// (name, emails, phones, org, household, address), vehicle-level (year /
// make / model / trim / vin), opportunity-level (type, status, owner,
// value, created_at, updated_at, deadline).
// Default sort: updated_at descending.
//
// Pagination: client-side infinite scroll via useInfiniteScroll
// (PAGE_SIZE = 25) + BackToTop floating button (Task 2a-D).
//
// Props:
//   activeKey  — nav key (passed down for the breadcrumb label)
//   persona    — forwarded to ContactProfile → CoPilot plumbing
//   session    — shared session bag from App.jsx useSessionData(); falls back
//                to a local useSessionData() if not supplied (legacy call sites)
//   testMode   — boolean, defaults false; gates the _test_case tooltip column

const PAGE_SIZE = 25;

// Strip non-digits — used on both sides of the phone search compare so
// "555-1234" matches "5551234" and vice versa.
function digitsOnly(s) {
  return String(s ?? '').replace(/\D+/g, '');
}

// Sortable column-key → row-value extractor. `age` returns the numeric
// _ageDays so the sort is numeric ascending = "most recent" first
// (since smaller age = more recent). Name resolves through preferred /
// first+last / id fallback so the visible label drives the order.
function sortValueFor(row, key) {
  if (key === 'age') return row._ageDays ?? Number.POSITIVE_INFINITY;
  if (key === 'vehicles') return row._vehicleCount ?? 0;
  if (key === 'name') {
    const n = row.name || {};
    return (n.preferred || `${n.first ?? ''} ${n.last ?? ''}`.trim() || row.id || '').toLowerCase();
  }
  return row[key];
}

// Canon-derived per-type status lists for the AdvancedFilter Status
// enum. Wave 26a fu1 Item 3: status enum is grouped by opp type
// (Protection (VSC) / Refi / Insurance / Payments) — mirrors AgentInbox.
//   - vsc + insurance canon blocks have `statuses` as an object whose
//     KEYS are the status names.
//   - refi falls back to `statuses_summary` (no per-status mapping).
//   - payments isn't in canon; derived from live opps in filterSchema.
const PROTECTION_STATUSES = Object.keys(ghlStatus.vsc?.statuses || {});
const INSURANCE_STATUSES = Object.keys(ghlStatus.insurance?.statuses || {});
const REFI_STATUSES = Array.from(ghlStatus.refi?.statuses_summary || []);

// Wave 26a fu3: Organization enum is restricted to orgs the logged-in
// agent has an association with (stub returns all canon-active orgs
// today; per-agent overrides land via agents.json in Wave 26b).
const ACCESSIBLE_ORGS = getAccessibleOrgs().map((o) => ({
  value: o.id,
  label: `${o.name} (${o.id})`,
}));

const TYPE_ENUM = [
  { value: 'refi', label: 'Refi' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'protection', label: 'Protection (VSC)' },
  { value: 'payments', label: 'Payments' },
];

export function AgentContacts({
  activeKey,
  persona,
  session,
  testMode = false,
  onOpenOppInCoPilot,
  deepLinkContactId,
  onConsumeDeepLink,
}) {
  // Wave 31b-fu3 — opt out of writer registration; App.jsx is the host.
  const localSession = useSessionData({ registerAsHost: false });
  const {
    contacts,
    opportunities,
    appendOpportunity,
    appendVehicleToContact,
    patchContact,
    appendContact,
    appendHouseholdRelationship,
  } = session || localSession;

  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  // Advanced filter — modal open/closed + committed values. Same pattern
  // AgentInbox uses.
  const [advOpen, setAdvOpen] = useState(false);
  const [advValues, setAdvValues] = useState({});
  // Wave 26a fu1 Item 4b: explicit sort state. Default = last activity
  // (i.e. `_ageDays`) ASCENDING since smaller age = more recent = "Last
  // activity DESC" in user-facing terms. Click a sortable column header
  // to toggle direction; click a different column to switch sort key.
  const [sortCol, setSortCol] = useState('age');
  const [sortDir, setSortDir] = useState('asc');
  // Initialize `right` from the deep-link prop so a GlobalSearch result
  // click opens ContactProfile on first render (same pattern AgentInbox
  // uses for deepLinkOppId). The consume callback fires immediately so
  // re-navigating doesn't auto-reopen.
  const [right, setRight] = useState(() =>
    deepLinkContactId ? { kind: 'profile', contactId: deepLinkContactId } : null,
  );
  useEffect(() => {
    if (deepLinkContactId && onConsumeDeepLink) onConsumeDeepLink();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build enriched rows from the contacts keyed object. We pre-compute
  // an opps[] array and a free-form search haystack per contact so the
  // filter pipeline downstream stays cheap.
  const allRows = useMemo(() => {
    const oppsByContact = {};
    for (const opp of opportunities) {
      if (!opp.contact_id) continue;
      if (!oppsByContact[opp.contact_id]) oppsByContact[opp.contact_id] = [];
      oppsByContact[opp.contact_id].push(opp);
    }

    return Object.values(contacts).map((c) => {
      const contactOpps = oppsByContact[c.id] || [];
      const openOpps = contactOpps.filter(
        (o) => !/(won|funded|policy written|paid in full|cancelled|lost)/i.test(o.status || ''),
      );
      const vehicles = Array.isArray(c.vehicles) ? c.vehicles : [];
      // Latest opp per type (Refi / Ins / VSC) for the row cells.
      const refiOpp = latestOppOfType(contactOpps, 'refi');
      const insOpp = latestOppOfType(contactOpps, 'insurance');
      const vscOpp = latestOppOfType(contactOpps, 'protection');

      // Pre-build a search haystack across the same fields AgentInbox
      // uses (name, emails, phones, vehicle YMMT + VIN, opp status /
      // next_action / household / vehicle string).
      const haystackParts = [];
      const n = c.name || {};
      haystackParts.push(n.first, n.last, n.preferred);
      (Array.isArray(c.emails) ? c.emails : []).forEach((e) =>
        haystackParts.push(e.address || e),
      );
      (Array.isArray(c.phones) ? c.phones : []).forEach((p) =>
        haystackParts.push(p.number || p),
      );
      vehicles.forEach((v) => {
        haystackParts.push(v.vin, v.year, v.make, v.model, v.trim);
      });
      contactOpps.forEach((o) => {
        haystackParts.push(o.status, o.next_action, o.household, o.vehicle);
      });
      const searchHaystack = haystackParts
        .filter(Boolean)
        .map((s) => String(s).toLowerCase())
        .join(' ');
      const phonesDigits = (c.phones || [])
        .map((p) => digitsOnly(p.number || p))
        .filter(Boolean)
        .join(' ');

      return {
        ...c,
        _opps: contactOpps,
        _refiOpp: refiOpp,
        _insOpp: insOpp,
        _vscOpp: vscOpp,
        _vehicleCount: vehicles.length,
        _openOppCount: openOpps.length,
        _totalOppCount: contactOpps.length,
        _ageDays: ageDays(c.updated_at),
        _searchHaystack: searchHaystack,
        _phonesDigits: phonesDigits,
      };
    });
  }, [contacts, opportunities]);

  // Schema — contact / vehicle / opportunity levels. Status enum is
  // grouped by opp type (Wave 26a fu1 Item 3); Payments group derived
  // from live opps.
  // Wave 26a fu3 — Owner enum is DYNAMIC: when one or more orgs are
  // staged in the same modal's Organization filter, the Owner option
  // set narrows to owners whose opps touch those orgs. With zero orgs
  // staged the full per-opp owner set is shown.
  const ownerOrgMap = useMemo(
    () => deriveOwnerOrgMap(opportunities, contacts),
    [opportunities, contacts],
  );
  const filterSchema = useMemo(() => {
    const paymentsStatusSet = new Set();
    opportunities.forEach((o) => {
      if (o.type === 'payments' && o.status) paymentsStatusSet.add(o.status);
    });
    const paymentsStatuses = Array.from(paymentsStatusSet).sort();
    const statusGroups = [
      { groupLabel: 'Protection (VSC)', values: PROTECTION_STATUSES },
      { groupLabel: 'Refi', values: REFI_STATUSES },
      { groupLabel: 'Insurance', values: INSURANCE_STATUSES },
    ];
    if (paymentsStatuses.length > 0) {
      statusGroups.push({ groupLabel: 'Payments', values: paymentsStatuses });
    }
    const ownerDynamic = (staged) => {
      const selectedOrgIds = Array.isArray(staged?.org) ? staged.org : [];
      const owners = ownersForOrgs(ownerOrgMap, selectedOrgIds).sort();
      return owners.map((o) => ({ value: o, label: o }));
    };
    return [
      // Contact level
      { key: 'text', label: 'Any text', field: 'text.any', type: 'text', level: 'contact' },
      { key: 'name', label: 'Name', field: 'contact.name', type: 'text', level: 'contact' },
      { key: 'email', label: 'Email', field: 'contact.emails', type: 'text', level: 'contact' },
      { key: 'phone', label: 'Phone', field: 'contact.phones', type: 'text', level: 'contact' },
      { key: 'org', label: 'Organization', field: 'contact.org_id', type: 'enum', enumValues: ACCESSIBLE_ORGS, level: 'contact' },
      { key: 'household', label: 'Household', field: 'contact.household_id', type: 'text', level: 'contact' },
      { key: 'address', label: 'Address', field: 'contact.address', type: 'text', level: 'contact' },
      // Vehicle level
      { key: 'vehicle_year', label: 'Vehicle year', field: 'vehicle.year', type: 'number_range', level: 'vehicle' },
      { key: 'vehicle_make', label: 'Vehicle make', field: 'vehicle.make', type: 'text', level: 'vehicle' },
      { key: 'vehicle_model', label: 'Vehicle model', field: 'vehicle.model', type: 'text', level: 'vehicle' },
      { key: 'vehicle_trim', label: 'Vehicle trim', field: 'vehicle.trim', type: 'text', level: 'vehicle' },
      { key: 'vehicle_vin', label: 'Vehicle VIN', field: 'vehicle.vin', type: 'text', level: 'vehicle' },
      // Opportunity level
      { key: 'opp_type', label: 'Opportunity type', field: 'opportunity.type', type: 'enum', enumValues: TYPE_ENUM, level: 'opportunity' },
      {
        key: 'status',
        label: 'Opportunity status',
        field: 'opportunity.status',
        type: 'enum',
        dynamicEnumGroups: (staged) => {
          const selectedTypes = Array.isArray(staged?.opp_type) ? staged.opp_type : [];
          if (selectedTypes.length === 0) return statusGroups;
          const TYPE_TO_GROUP_LABEL = {
            protection: 'Protection (VSC)',
            refi: 'Refi',
            insurance: 'Insurance',
            payments: 'Payments',
          };
          const wanted = new Set(
            selectedTypes.map((t) => TYPE_TO_GROUP_LABEL[t]).filter(Boolean),
          );
          return statusGroups.filter((g) => wanted.has(g.groupLabel));
        },
        level: 'opportunity',
      },
      { key: 'owner', label: 'Owner', field: 'opportunity.owner', type: 'enum', dynamicEnumValues: ownerDynamic, level: 'opportunity' },
      { key: 'value', label: 'Opp value', field: 'opportunity.value', type: 'number_range', level: 'opportunity' },
      { key: 'created_at', label: 'Opp created', field: 'opportunity.created_at', type: 'date_range', level: 'opportunity' },
      { key: 'updated_at', label: 'Opp updated', field: 'opportunity.updated_at', type: 'date_range', level: 'opportunity' },
      { key: 'deadline', label: 'Opp deadline', field: 'opportunity.deadline', type: 'date_range', level: 'opportunity' },
    ];
  }, [opportunities, ownerOrgMap]);

  // Path resolver — same pattern AgentInbox uses. Descends through
  // contact → vehicles[*] → opps[*] so any-vehicle / any-opp matching
  // semantics work. Returns an ARRAY for vehicle.* and opportunity.*
  // so AdvancedFilter's matcher passes when ANY element matches.
  function getter(row, field) {
    if (!field) return null;
    if (field === 'text.any') return row._searchHaystack;
    if (field.startsWith('contact.')) {
      const rest = field.slice('contact.'.length);
      if (rest === 'emails') {
        return (row.emails || []).map((e) => e.address || e);
      }
      if (rest === 'phones') {
        return (row.phones || []).map((p) => p.number || p);
      }
      if (rest === 'name') {
        const n = row.name || {};
        return [n.first, n.last, n.preferred].filter(Boolean).join(' ');
      }
      if (rest === 'address') {
        const a = row.address;
        if (!a) return null;
        if (typeof a === 'string') return a;
        return [a.street, a.city, a.state, a.zip, a.zipcode].filter(Boolean).join(' ');
      }
      return rest.split('.').reduce((acc, k) => (acc == null ? null : acc[k]), row);
    }
    if (field.startsWith('vehicle.')) {
      const rest = field.slice('vehicle.'.length);
      const vehicles = Array.isArray(row.vehicles) ? row.vehicles : [];
      return vehicles.map((v) => rest.split('.').reduce((acc, k) => (acc == null ? null : acc[k]), v));
    }
    if (field.startsWith('opportunity.')) {
      const rest = field.slice('opportunity.'.length);
      return row._opps.map((o) => rest.split('.').reduce((acc, k) => (acc == null ? null : acc[k]), o));
    }
    return row[field];
  }

  // Filter pipeline: quick filter → advanced filter → free-form search → sort.
  const visible = useMemo(() => {
    let rows = allRows;

    // (1) Quick filter dropdown
    if (filter === 'with_opps') {
      rows = rows.filter((c) => c._totalOppCount > 0);
    } else if (filter === 'without_opps') {
      rows = rows.filter((c) => c._totalOppCount === 0);
    } else if (filter === 'without_vehicle') {
      rows = rows.filter((c) => c._vehicleCount === 0);
    }

    // (2) Advanced filter
    rows = applyFilters(rows, filterSchema, advValues, getter);

    // (3) Free-form search — pre-built haystack + digits-only phone check
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      const qDigits = digitsOnly(q);
      rows = rows.filter((c) => {
        if (c._searchHaystack.includes(q)) return true;
        if (qDigits && c._phonesDigits.includes(qDigits)) return true;
        return false;
      });
    }

    // (4) Sort — Wave 26a fu1 Item 4b. Default sortCol='age' sortDir='asc'
    // = smallest age first = most-recent-activity first = "Last activity
    // DESC" in user-facing terms.
    rows = [...rows].sort((a, b) => {
      const va = sortValueFor(a, sortCol);
      const vb = sortValueFor(b, sortCol);
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDir === 'asc' ? va - vb : vb - va;
      }
      const sa = String(va ?? '');
      const sb = String(vb ?? '');
      return sortDir === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });

    return rows;
  }, [allRows, filter, advValues, filterSchema, search, sortCol, sortDir]);

  function toggleSort(key) {
    if (key === sortCol) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(key);
      // Default direction per column. Age defaults to ASC (= newest
      // first = "Last activity DESC"); other text columns default to ASC
      // alphabetic; numeric vehicles defaults to DESC (most-vehicles
      // first is the more useful first-glance).
      setSortDir(key === 'vehicles' ? 'desc' : 'asc');
    }
  }

  // Active-filter chips for the AdvancedFilter values.
  const activeAdvChips = useMemo(() => {
    return filterSchema
      .map((f) => {
        const desc = describeFilterValue(f, advValues[f.key]);
        if (desc == null) return null;
        return { field: f, text: desc };
      })
      .filter(Boolean);
  }, [advValues, filterSchema]);

  // Infinite scroll over the filtered rows. The hook auto-resets on
  // length change so toggling filter/search/AdvancedFilter values
  // returns to page 1 automatically.
  const { visibleRows, sentinelRef, scrollerRef, hasMore } = useInfiniteScroll(
    visible,
    { pageSize: PAGE_SIZE },
  );
  const scrollContainerRef = useRef(null);

  function openProfile(contactId) {
    setRight({ kind: 'profile', contactId });
  }
  function closeRight() {
    setRight(null);
  }
  function handleOppCellClick(opp) {
    if (!opp) return;
    track('mission_control.contacts.opp_cell_clicked', {
      contact_id: opp.contact_id,
      opp_id: opp.id,
      type: opp.type,
    });
    if (onOpenOppInCoPilot) onOpenOppInCoPilot(opp.id);
  }

  // Right-pane: ContactProfile full-bleed (same pattern as AgentInbox)
  if (right?.kind === 'profile') {
    return (
      <ContactProfile
        key={right.contactId}
        contactId={right.contactId}
        contacts={contacts}
        opportunities={opportunities}
        appendOpportunity={appendOpportunity}
        appendVehicleToContact={appendVehicleToContact}
        patchContact={patchContact}
        appendContact={appendContact}
        appendHouseholdRelationship={appendHouseholdRelationship}
        persona={persona}
        onClose={closeRight}
        onOpenInCoPilot={onOpenOppInCoPilot}
        onOpenContactProfile={openProfile}
        testMode={testMode}
      />
    );
  }

  return (
    <div className="flex-1 flex min-h-0 bg-slate-50">
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-200 bg-white">
          <div className="flex items-center gap-2 text-emerald-600 mb-1">
            <Users className="w-4 h-4" />
            <span className="text-xs uppercase tracking-wide font-semibold">
              Agent · {activeKey}
            </span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Contacts
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {visible.length} of {allRows.length} contacts
          </p>
          <p className="text-[11px] text-slate-400 mt-1">
            Click a row to open the contact profile · click a Refi / Ins / VSC cell to open that opportunity in CoPilot.
          </p>
        </div>

        {/* Filters + Search */}
        <div className="px-6 py-3 bg-white border-b border-slate-200 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="text-sm border border-slate-200 rounded-md px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="all">All contacts</option>
              <option value="with_opps">With opportunities</option>
              <option value="without_opps">Without opportunities</option>
              <option value="without_vehicle">Without vehicle</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => setAdvOpen(true)}
            className="inline-flex items-center gap-1.5 text-sm border border-slate-200 rounded-md px-2.5 py-1.5 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <SlidersHorizontal className="w-4 h-4 text-slate-500" />
            Filters
            {activeAdvChips.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-emerald-600 text-white text-[10px] font-semibold px-1">
                {activeAdvChips.length}
              </span>
            )}
          </button>
          <div className="relative max-w-xs flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, phone…"
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        {/* Active advanced-filter chips */}
        {activeAdvChips.length > 0 && (
          <div className="px-6 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-1.5">
            {activeAdvChips.map(({ field, text }) => (
              <span
                key={field.key}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border border-slate-200 text-xs text-slate-700"
              >
                <span className="font-medium">{field.label}:</span>
                <span className="text-slate-600 truncate max-w-[160px]">{text}</span>
                <button
                  type="button"
                  onClick={() => {
                    setAdvValues((prev) => {
                      const next = { ...prev };
                      delete next[field.key];
                      return next;
                    });
                  }}
                  className="text-slate-400 hover:text-slate-700 p-0.5 -mr-1 rounded"
                  aria-label="Remove filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => setAdvValues({})}
              className="text-xs text-slate-500 hover:text-slate-800 px-1.5 py-0.5"
            >
              Clear all
            </button>
          </div>
        )}

        {/* Table */}
        <div
          className="flex-1 overflow-auto relative"
          ref={(el) => {
            scrollerRef.current = el;
            scrollContainerRef.current = el;
          }}
        >
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
              <tr>
                <SortableTh
                  label="Name"
                  colKey="name"
                  sortCol={sortCol}
                  sortDir={sortDir}
                  onToggle={toggleSort}
                />
                <SortableTh
                  label="Vehicles"
                  colKey="vehicles"
                  sortCol={sortCol}
                  sortDir={sortDir}
                  onToggle={toggleSort}
                />
                {/* Wave 26a fu1 Item 4a: VSC | Refi | Ins ordering. */}
                <th className="px-4 py-2.5 text-left font-medium text-slate-500 whitespace-nowrap">
                  VSC
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-slate-500 whitespace-nowrap">
                  Refi
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-slate-500 whitespace-nowrap">
                  Ins
                </th>
                <SortableTh
                  label="Last activity"
                  colKey="age"
                  sortCol={sortCol}
                  sortDir={sortDir}
                  onToggle={toggleSort}
                />
                <th className="px-4 py-2.5 text-left font-medium text-slate-500 whitespace-nowrap">
                  Tags
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((c) => {
                const displayName =
                  c.name?.preferred ||
                  `${c.name?.first ?? ''} ${c.name?.last ?? ''}`.trim() ||
                  c.id;
                const tags = Array.isArray(c.tags) ? c.tags : [];
                const tagLabel =
                  tags.length === 0
                    ? '—'
                    : tags.length <= 2
                      ? tags.map((t) => t.name || t).join(', ')
                      : `${tags.slice(0, 2).map((t) => t.name || t).join(', ')} +${tags.length - 2}`;
                // Source test-case scenarios from this contact's opps
                // (the field lives on opportunity records, not contacts).
                // Same pattern AgentInbox uses for the Name tooltip.
                const testCases =
                  testMode &&
                  c._opps
                    .filter((o) => o._test_case)
                    .map((o) => `${o.type}: ${o._test_case}`);
                const hasTestCases = testMode && testCases && testCases.length > 0;

                return (
                  <tr
                    key={c.id}
                    onClick={() => openProfile(c.id)}
                    className="border-b border-slate-100 transition-colors bg-white hover:bg-slate-50 cursor-pointer"
                  >
                    {/* Name — with optional test_case tooltip when testMode on */}
                    <td className="px-4 py-3 text-slate-900 font-medium whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        {displayName}
                        {hasTestCases && (
                          <Tooltip
                            content={
                              <>
                                {testCases.map((line, i) => (
                                  <div key={i}>{line}</div>
                                ))}
                              </>
                            }
                            placement="bottom-left"
                            maxWidth={320}
                          >
                            <HelpCircle className="w-3 h-3 text-slate-400 ml-1.5 flex-shrink-0" />
                          </Tooltip>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {c._vehicleCount === 0 ? (
                        <span className="text-slate-400 italic">none</span>
                      ) : (
                        c._vehicleCount
                      )}
                    </td>
                    {/* Wave 26a fu1 Item 4a: VSC | Refi | Ins ordering. */}
                    <td className="px-4 py-3 whitespace-nowrap align-top">
                      <OppCell opp={c._vscOpp} onClick={handleOppCellClick} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap align-top">
                      <OppCell opp={c._refiOpp} onClick={handleOppCellClick} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap align-top">
                      <OppCell opp={c._insOpp} onClick={handleOppCellClick} />
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {ageLabel(c._ageDays)}
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap max-w-[200px] truncate">
                      {tagLabel}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-sm text-slate-400"
                  >
                    No contacts match your filters.
                  </td>
                </tr>
              )}
              {hasMore && (
                <tr>
                  <td
                    ref={sentinelRef}
                    colSpan={7}
                    className="px-4 py-4 text-center text-xs text-slate-400"
                  >
                    Loading more…
                  </td>
                </tr>
              )}
              {!hasMore && visible.length > PAGE_SIZE && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-3 text-center text-[11px] text-slate-400 italic"
                  >
                    End of list · {visible.length} contacts
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <BackToTop scrollerRef={scrollContainerRef} threshold={600} />
      </div>

      <AdvancedFilter
        open={advOpen}
        onClose={() => setAdvOpen(false)}
        schema={filterSchema}
        values={advValues}
        onApply={(next) => setAdvValues(next)}
        onClear={() => setAdvValues({})}
      />
    </div>
  );
}

// SortableTh — column-header cell with click-to-toggle direction.
// Mirrors the AgentInbox pattern (ArrowUpDown / ArrowUp / ArrowDown).
function SortableTh({ label, colKey, sortCol, sortDir, onToggle }) {
  const isActive = sortCol === colKey;
  const Icon = !isActive ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      onClick={() => onToggle(colKey)}
      className="px-4 py-2.5 text-left font-medium text-slate-500 cursor-pointer hover:text-slate-800 select-none whitespace-nowrap"
    >
      <span className="inline-flex items-center gap-1.5">
        {label}
        <Icon className={'w-3 h-3 ' + (isActive ? 'text-slate-700' : 'text-slate-300')} />
      </span>
    </th>
  );
}

// OppCell — small inline component for Refi / Ins / VSC columns. Click
// stops row propagation so it doesn't also fire the row's openProfile
// handler. Mirrors AgentInbox's OppCell pattern minus the dim-cell logic
// (AgentContacts has no inboxFilter to gate against).
function OppCell({ opp, onClick }) {
  if (!opp) return <span className="text-slate-300">—</span>;
  const short = vehicleShortLabel(opp.vehicle);
  return (
    <Tooltip
      content={opp.next_action ? `Next: ${opp.next_action}` : null}
      placement="bottom-left"
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick(opp);
        }}
        className="text-left w-full group"
      >
        <div className="text-slate-700 text-sm font-medium leading-tight">
          {short || '—'}
        </div>
        <div className="mt-0.5">
          <span
            className={
              'inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-medium ring-1 ring-inset ' +
              statusPillClasses(opp.type, opp.status)
            }
          >
            {opp.status}
          </span>
        </div>
      </button>
    </Tooltip>
  );
}
