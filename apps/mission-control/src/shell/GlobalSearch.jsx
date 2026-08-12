import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { track } from 'blinker-platform/telemetry';
import {
  AdvancedFilter,
  applyFilters,
  describeFilterValue,
} from '../shared/AdvancedFilter.jsx';
import { TYPE_LABELS, TYPE_BADGE } from '../lib/canon.js';
import ghlStatus from '../constants/canon/ghl-status.json';
import {
  getAccessibleOrgs,
  deriveOwnerOrgMap,
  ownersForOrgs,
} from '../lib/agent-access.js';

// GlobalSearch — header-level free-form + advanced search across the
// agent's contact universe. v.3.0.7 PDF Task 2.
//
// Two affordances:
//   1. Search input (free-form, partial substring CI). Same fields as
//      AgentInbox's search box: contact name (first/last/preferred),
//      contact.emails[*].address, contact.phones[*].number (digits-only
//      compare on both sides), contact.vehicles[*].vin.
//   2. Filters button → shared AdvancedFilter modal. Schema parity with
//      AgentInbox: contact + vehicle + opportunity levels.
//
// Results render in a dropdown panel below the input (max 10). Each row
// shows: contact display name, household label, primary phone or email,
// and a tiny strip of opportunity-type badges (Refi / Ins / VSC / Pay)
// derived from the contact's opps. Click → onContactClick(contactId).
//
// PostHog events under mission_control.global_search.*

const MAX_RESULTS = 10;

function digitsOnly(s) {
  return String(s ?? '').replace(/\D+/g, '');
}

// Canon-derived per-type status lists — parity with AgentInbox / AgentContacts
// (Wave 26a fu1 Item 3 + fu2). Module-level because canon is static.
//   - vsc + insurance: keys of `statuses` object
//   - refi: flat `statuses_summary` array
//   - payments: not in canon; derived from live opps in filterSchema useMemo
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

export function GlobalSearch({ onContactClick, session }) {
  // session is owned by App.jsx so adds/edits across the shell reflect
  // here in real time. Defensive `|| {}` for any legacy mount without a
  // session prop — the search just returns no rows in that case.
  const { contacts, opportunities } = session || {};

  const [query, setQuery] = useState('');
  const [advOpen, setAdvOpen] = useState(false);
  const [advValues, setAdvValues] = useState({});
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const openedRef = useRef(false);

  // Close dropdown on outside click.
  useEffect(() => {
    function onDocClick(e) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target)) setOpen(false);
    }
    if (!open) return undefined;
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Fire 'opened' once per session — first time the user focuses / types.
  function markOpened() {
    if (openedRef.current) return;
    openedRef.current = true;
    track('mission_control.global_search.opened', {});
  }

  // Build a per-contact opp-summary index once. Each entry: oppTypes (set of
  // workflow types the contact has) used for the result-row badges.
  const oppIndex = useMemo(() => {
    const ix = new Map();
    for (const o of opportunities || []) {
      if (!o.contact_id) continue;
      const cur = ix.get(o.contact_id) || { types: new Set(), opps: [] };
      cur.types.add(o.type);
      cur.opps.push(o);
      ix.set(o.contact_id, cur);
    }
    return ix;
  }, [opportunities]);

  // Build contact rows once. Each row carries searchable strings and a
  // computed haystack + phonesDigits for fast free-form match.
  const allRows = useMemo(() => {
    const out = [];
    for (const c of Object.values(contacts || {})) {
      const n = c.name || {};
      const displayName =
        n.preferred ||
        [n.first, n.last].filter(Boolean).join(' ').trim() ||
        c.id;
      const emails = Array.isArray(c.emails)
        ? c.emails.map((e) => e.address).filter(Boolean)
        : [];
      const phones = Array.isArray(c.phones)
        ? c.phones.map((p) => p.number || p.value).filter(Boolean)
        : [];
      const vehicles = Array.isArray(c.vehicles) ? c.vehicles : [];
      const vins = vehicles.map((v) => v.vin).filter(Boolean);
      const parts = [
        n.first,
        n.last,
        n.preferred,
        ...emails,
        ...phones,
        ...vins,
      ]
        .filter(Boolean)
        .map((s) => String(s).toLowerCase());
      const haystack = parts.join(' ');
      const phonesDigits = phones.map(digitsOnly).filter(Boolean).join(' ');
      const oppEntry = oppIndex.get(c.id) || { types: new Set(), opps: [] };
      out.push({
        contact: c,
        contact_id: c.id,
        displayName,
        household: c.household_label || c.household || '',
        primaryContact: phones[0] || emails[0] || '',
        haystack,
        phonesDigits,
        types: Array.from(oppEntry.types),
        opps: oppEntry.opps,
      });
    }
    return out;
  }, [contacts, oppIndex]);

  // Free-form match — substring on haystack OR digits-only phone match.
  function matchFreeForm(row, q) {
    if (!q) return true;
    if (row.haystack.includes(q)) return true;
    const qDigits = digitsOnly(q);
    if (qDigits && row.phonesDigits.includes(qDigits)) return true;
    return false;
  }

  // AdvancedFilter schema — contact / vehicle / opportunity. Mirrors the
  // Inbox / Contacts schema (Wave 26a fu2 parity with bdafab6). An
  // opp-level field returns an ARRAY (one entry per opp on the contact) so
  // AdvancedFilter passes if ANY matches.
  //   - opp_type: standalone Opportunity Type filter (fu2)
  //   - status: grouped by opp type via enumGroups instead of flat union (fu2)
  //   - org: restricted to agent-accessible orgs (fu3)
  //   - owner: dynamic — narrows to owners whose opps touch the staged orgs (fu3)
  //   - payments statuses: not in canon; derived from live opp set as fallback
  const ownerOrgMap = useMemo(
    () => deriveOwnerOrgMap(opportunities, contacts),
    [opportunities, contacts],
  );
  const filterSchema = useMemo(() => {
    const paymentsStatusSet = new Set();
    (opportunities || []).forEach((o) => {
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
      { key: 'name', label: 'Name', field: 'contact.name', type: 'text', level: 'contact' },
      { key: 'email', label: 'Email', field: 'contact.emails', type: 'text', level: 'contact' },
      { key: 'phone', label: 'Phone', field: 'contact.phones', type: 'text', level: 'contact' },
      { key: 'vin', label: 'VIN', field: 'vehicle.vin', type: 'text', level: 'vehicle' },
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
      { key: 'org', label: 'Organization', field: 'contact.org_id', type: 'enum', enumValues: ACCESSIBLE_ORGS, level: 'contact' },
      { key: 'owner', label: 'Owner', field: 'opportunity.owner', type: 'enum', dynamicEnumValues: ownerDynamic, level: 'opportunity' },
      { key: 'created_at', label: 'Created', field: 'opportunity.created_at', type: 'date_range', level: 'opportunity' },
      { key: 'updated_at', label: 'Updated', field: 'opportunity.updated_at', type: 'date_range', level: 'opportunity' },
    ];
  }, [opportunities, ownerOrgMap]);

  // Path-resolving getter — duplicates AgentInbox's pattern. Contact-level
  // returns the resolved scalar/array; vehicle-level returns an array across
  // all of the contact's vehicles; opportunity-level returns an array across
  // all of the contact's opps. AdvancedFilter's matchText flattens these.
  function getter(row, field) {
    if (!field) return null;
    if (field === 'contact.name') {
      const n = row.contact.name || {};
      return [n.first, n.last, n.preferred].filter(Boolean).join(' ');
    }
    if (field === 'contact.emails') {
      return Array.isArray(row.contact.emails)
        ? row.contact.emails.map((e) => e.address).filter(Boolean)
        : [];
    }
    if (field === 'contact.phones') {
      return Array.isArray(row.contact.phones)
        ? row.contact.phones.map((p) => p.number || p.value).filter(Boolean)
        : [];
    }
    if (field.startsWith('contact.')) {
      const rest = field.slice('contact.'.length);
      return rest.split('.').reduce((acc, k) => (acc == null ? null : acc[k]), row.contact);
    }
    if (field.startsWith('vehicle.')) {
      const rest = field.slice('vehicle.'.length);
      const vehicles = Array.isArray(row.contact?.vehicles) ? row.contact.vehicles : [];
      return vehicles.map((v) => rest.split('.').reduce((acc, k) => (acc == null ? null : acc[k]), v));
    }
    if (field.startsWith('opportunity.')) {
      const rest = field.slice('opportunity.'.length);
      return row.opps.map((o) => rest.split('.').reduce((acc, k) => (acc == null ? null : acc[k]), o));
    }
    return null;
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let r = allRows;
    if (q) r = r.filter((row) => matchFreeForm(row, q));
    r = applyFilters(r, filterSchema, advValues, getter);
    return r;
  }, [allRows, query, advValues, filterSchema]);

  const visibleResults = filtered.slice(0, MAX_RESULTS);

  const activeAdvChips = useMemo(() => {
    return filterSchema
      .map((f) => {
        const desc = describeFilterValue(f, advValues[f.key]);
        if (desc == null) return null;
        return { field: f, text: desc };
      })
      .filter(Boolean);
  }, [advValues, filterSchema]);

  const hasAnyConstraint = query.trim().length > 0 || activeAdvChips.length > 0;
  const showDropdown = open && hasAnyConstraint;

  function handleResultClick(contactId) {
    track('mission_control.global_search.result_clicked', {
      result_type: 'contact',
      contact_id: contactId,
      query_length: query.length,
      had_advanced_filter: activeAdvChips.length > 0,
    });
    setOpen(false);
    if (onContactClick) onContactClick(contactId);
  }

  function handleAdvApply(next) {
    setAdvValues(next);
    track('mission_control.global_search.advanced_filter_applied', {
      active_count: Object.keys(next || {}).filter((k) => {
        const v = next[k];
        if (v == null) return false;
        if (Array.isArray(v)) return v.length > 0;
        if (typeof v === 'object') return Object.keys(v).length > 0;
        return String(v).trim().length > 0;
      }).length,
    });
    setOpen(true);
  }

  function clearChip(key) {
    setAdvValues((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function handleQueryChange(e) {
    const v = e.target.value;
    setQuery(v);
    if (v && !openedRef.current) markOpened();
    if (v) {
      // Fire query_typed at most once every 500ms-worth of edits via simple
      // last-char check — keep it simple, PostHog dedupes at scale anyway.
      track('mission_control.global_search.query_typed', { length: v.length });
    }
    setOpen(true);
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={handleQueryChange}
            onFocus={() => {
              markOpened();
              setOpen(true);
            }}
            placeholder="Search contacts, emails, phones, VINs…"
            className="w-full bg-slate-50 border border-slate-200 rounded-md pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            setAdvOpen(true);
            markOpened();
          }}
          title="Advanced filter"
          className="inline-flex items-center gap-1 text-xs px-2 py-1.5 border border-slate-200 rounded-md bg-white hover:bg-slate-50 text-slate-700 shrink-0"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Filters
          {activeAdvChips.length > 0 && (
            <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-blue-600 text-white text-[10px] font-semibold px-1">
              {activeAdvChips.length}
            </span>
          )}
        </button>
      </div>

      {/* Active-filter chips strip — sits just under the input when chips
          exist. Always visible regardless of dropdown open state so the
          user can see what's narrowed even after they tab away. */}
      {activeAdvChips.length > 0 && (
        <div className="absolute left-0 right-0 mt-1 flex flex-wrap gap-1 px-1 z-30">
          {activeAdvChips.map((chip) => (
            <button
              key={chip.field.key}
              type="button"
              onClick={() => clearChip(chip.field.key)}
              className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200 hover:bg-blue-100"
            >
              <span className="font-medium">{chip.field.label}:</span>
              <span className="truncate max-w-[120px]">{chip.text}</span>
              <X className="w-2.5 h-2.5" />
            </button>
          ))}
        </div>
      )}

      {showDropdown && (
        <div
          className={
            'absolute left-0 right-0 mt-1 bg-white rounded-md shadow-lg ring-1 ring-slate-200 z-40 overflow-hidden ' +
            (activeAdvChips.length > 0 ? 'top-[calc(100%+1.75rem)]' : 'top-full')
          }
        >
          {visibleResults.length === 0 && (
            <div className="px-3 py-4 text-sm text-slate-400 text-center">
              No matching contacts.
            </div>
          )}
          {visibleResults.map((row) => (
            <button
              key={row.contact_id}
              type="button"
              onClick={() => handleResultClick(row.contact_id)}
              className="w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-slate-50 border-b border-slate-50 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-900 truncate">
                  {row.displayName}
                </div>
                <div className="text-[11px] text-slate-500 truncate">
                  {row.household && (
                    <span className="text-slate-400 mr-1">{row.household} ·</span>
                  )}
                  {row.primaryContact || '—'}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {row.types.map((t) => (
                  <span
                    key={t}
                    className={
                      'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ring-1 ring-inset ' +
                      (TYPE_BADGE[t] || 'bg-slate-50 text-slate-700 ring-slate-200')
                    }
                  >
                    {TYPE_LABELS[t]?.charAt(0) || t.charAt(0).toUpperCase()}
                  </span>
                ))}
              </div>
            </button>
          ))}
          {filtered.length > MAX_RESULTS && (
            <div className="px-3 py-1.5 text-[11px] text-slate-400 italic border-t border-slate-100">
              Showing {MAX_RESULTS} of {filtered.length}. Refine to narrow.
            </div>
          )}
        </div>
      )}

      <AdvancedFilter
        open={advOpen}
        onClose={() => setAdvOpen(false)}
        schema={filterSchema}
        values={advValues}
        onApply={handleAdvApply}
        onClear={() => setAdvValues({})}
      />
    </div>
  );
}
