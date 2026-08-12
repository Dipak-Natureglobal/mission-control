import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Inbox,
  ArrowUpDown,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Filter,
  Search,
  HelpCircle,
  X,
  SlidersHorizontal,
} from 'lucide-react';
import { blinkerApi } from 'blinker-platform/api';
import { CoPilotPane } from '../../components/CoPilotPane.jsx';
import { ContactProfile } from './ContactProfile.jsx';
import { useSessionData } from '../../lib/session-data.js';
import {
  AdvancedFilter,
  applyFilters,
  describeFilterValue,
} from '../../shared/AdvancedFilter.jsx';
import { BackToTop } from '../../shared/BackToTop.jsx';
import { Tooltip } from '../../shared/Tooltip.jsx';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll.js';
import {
  TYPE_LABELS,
  TYPE_BADGE,
  statusPillClasses,
  ageDays,
  ageLabel,
  crmStageOf,
} from '../../lib/canon.js';
import ghlStatus from '../../constants/canon/ghl-status.json';
import orgRegistry from '../../constants/canon/org-registry.json';
import {
  getAccessibleOrgs,
  deriveOwnerOrgMap,
  ownersForOrgs,
} from '../../lib/agent-access.js';

// AgentInbox — opportunity-centric queue. One row per opportunity (the
// pre-Wave-26a shape). Wave 26a Task 1A–1D additions layered on:
//   1A — default sort by age ASC (newest first); clicking Age toggles to DESC.
//   1B — free-form search across the contact's name (first/last/preferred),
//        all email addresses, all phone numbers (digits-only normalized),
//        and every VIN on every vehicle the contact owns.
//   1C — AdvancedFilter (shared) with chips above the table.
//   1D — Infinite scroll (25/page) + BackToTop.
//
// Note on Wave 26a misread: the v.3.0.7 PDF letters E/F/G under "Task 1"
// were actually Task 2a (Contacts) sub-tasks. The contact-centric pivot,
// Refi/Ins/VSC triplet columns, and ?-on-contact-name tooltip relocation
// all belong to the Contacts surface — see commits 5e2daca / 7994034 /
// ae55a04. The Inbox stays opp-centric per the baseline.
//
// Right-pane routing: a single state machine `right` is `null` |
// `{ kind: 'copilot', oppId }` | `{ kind: 'profile', contactId }`. Only one
// is mounted at a time. The pane takes over the entire main content area
// (full-bleed) when open — it does NOT coexist alongside the inbox table.
// The inbox is unmounted while the pane is open; a "Back to inbox" chevron
// at the top of the pane resets `right` to null.
//   - Click contact-name cell  → ContactProfile for that contact
//   - Click any other cell     → CoPilotPane for that opportunity
//   - ContactProfile back      → close (returns to inbox)
//   - ContactProfile → opp row "Open in CoPilot" → switch to CoPilotPane
//   - CoPilotPane → "View full profile" → switch to ContactProfile
//   - ContactProfile household-member click → re-target ContactProfile
//
// Persona is threaded down from App so CoPilotPane → AgentView's View API
// Responses gate stays in sync with mission-control's PersonaSwitcher.

// 25 rows per page — see useInfiniteScroll default.
const PAGE_SIZE = 25;

const COLUMNS = [
  { key: 'type', label: 'Type' },
  { key: 'contact_name', label: 'Contact' },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'status', label: 'Status' },
  { key: 'age', label: 'Age', numeric: true },
  { key: 'owner', label: 'Owner' },
  { key: 'next_action', label: 'Next action' },
];

// Strip non-digits — used on both sides of the phone search compare so
// "555-1234" matches "5551234" and vice versa.
function digitsOnly(s) {
  return String(s ?? '').replace(/\D+/g, '');
}

// Canon-derived per-type status lists for the AdvancedFilter Status
// enum. Module-level because canon is static. Wave 26a fu1 Item 3:
// status enum is now grouped by opportunity type (Protection (VSC) /
// Refi / Insurance / Payments) rather than a flat union.
//   - vsc + insurance canon blocks have `statuses` as an object whose
//     KEYS are the status names.
//   - refi has no per-status mapping yet; falls back to its
//     `statuses_summary` flat array of names (same source AgentInbox
//     used for the flat union pre-fu1).
//   - payments isn't in canon. The schema build site derives that group
//     from the live opportunity set (see filterSchema useMemo below).
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

export function AgentInbox({
  activeKey,
  persona,
  session,
  deepLinkOppId,
  onConsumeDeepLink,
  inboxFilter,
  onClearInboxFilter,
  testMode = false,
  // Wave 28d — manager-overlay props. All optional; absent = identical
  // agent-persona behavior (byte-identical render path when none pass).
  // - groupByAgent: collapsible group-by-owner header rows above the
  //   regular row stream.
  // - bulkActions: [{ id, label, onClick(selectedOppIds) }] — when non-
  //   empty, renders a checkbox column + bottom bulk-action bar.
  // - extraFilters: AdvancedFilter spec entries appended to the schema.
  // - personaOverlay: { onReassign(oppId, agentId), onNoteForAgent(oppId,
  //   agentId, body) } — forwarded to CoPilotPane as managerOverlay so the
  //   left rail renders the manager-only re-assign + coaching-note items.
  groupByAgent = false,
  // Wave 28d fu — manager-overlay outer grouping layer. When true AND
  // groupByAgent is also true, agents are nested inside org groups
  // (org headers default expanded; agent headers default collapsed —
  // see seedCollapsed logic below). When true and groupByAgent is
  // false, rows are grouped only by org (flat opps under each org
  // header; built but not wired in any current call site). Default
  // false → identical Agent-persona behavior.
  groupByOrg = false,
  bulkActions = [],
  extraFilters,
  personaOverlay,
  // Wave 28d — seed for the AdvancedFilter draft. Defaults to {} (matches
  // pre-28d). ManagerInbox uses this to pre-toggle the Stuck derived
  // filter when ManagerHome's stale-KPI deep-links here. Honored once at
  // mount; subsequent changes do not re-seed.
  initialAdvValues,
}) {
  // Fallback: if a parent doesn't provide a session bag (e.g. legacy
  // call sites), spin up our own local one. App.jsx now lifts a single
  // session via useSessionData() so AgentHome + AgentInbox share state.
  //
  // Wave 31b-fu3 — AgentInbox is never the host of session-data; its
  // localSession is a legacy fallback for callers that don't pass a
  // `session` prop. Even in that case, App.jsx is the canonical writer
  // host today. Opting out of `registerAsHost` prevents the
  // registerOpportunityWriter race where AgentInbox's local writer
  // (mounted after App.jsx) would shadow App.jsx's writer and orphan
  // any opp spawned via opportunitiesApi.create() — causing CoPilot to
  // close because enriched.find() searches the parent session (which
  // never received the append) and returns null.
  const localSession = useSessionData({ registerAsHost: false });
  const {
    opportunities,
    contacts,
    appendOpportunity,
    appendVehicleToContact,
    updateContactVehicle,
    dedupAndUpsertVehicle,
    updateOpportunity,
    patchContact,
    appendContact,
    appendHouseholdRelationship,
  } = session || localSession;

  // Task 1A: default sort = age ASC (smallest age = newest first).
  const [sortCol, setSortCol] = useState('age');
  const [sortDir, setSortDir] = useState('asc');
  const [typeFilter, setTypeFilter] = useState('all');
  const [search, setSearch] = useState('');
  // Task 1C: advanced filter modal open/closed + committed values.
  const [advOpen, setAdvOpen] = useState(false);
  // Seed advValues from optional `initialAdvValues` prop (Wave 28d) only
  // on first mount; downstream filter edits flow through setAdvValues as
  // before. When the prop is absent, default {} = pre-28d behavior.
  const [advValues, setAdvValues] = useState(() =>
    initialAdvValues && typeof initialAdvValues === 'object'
      ? { ...initialAdvValues }
      : {},
  );

  // Honor deep-link from AgentHome's "Start opportunity" → open CoPilot
  // for the freshly-minted opp. We seed `right` from the deep-link prop
  // once at mount and immediately consume it via the parent callback so
  // re-mounts don't re-open. Lifting to a useEffect would trip the
  // react-hooks/set-state-in-effect rule.
  const [right, setRight] = useState(() =>
    deepLinkOppId ? { kind: 'copilot', oppId: deepLinkOppId } : null,
  );
  useEffect(() => {
    if (deepLinkOppId && onConsumeDeepLink) onConsumeDeepLink();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enrich opps with `age` + a per-opp search-haystack rolled up from
  // the linked contact (name/emails/phones/vehicles). Pre-compute so the
  // search input stays cheap on every keystroke.
  const enriched = useMemo(() => {
    return opportunities.map((o) => {
      const contact = contacts[o.contact_id] || null;
      const parts = [];
      // Opp-level
      parts.push(o.contact_name, o.vehicle, o.id, o.status, o.next_action, o.owner);
      if (contact) {
        const n = contact.name || {};
        parts.push(n.first, n.last, n.preferred);
        const emails = Array.isArray(contact.emails)
          ? contact.emails.map((e) => e.address)
          : contact.email
            ? [contact.email]
            : [];
        parts.push(...emails);
        const phones = Array.isArray(contact.phones)
          ? contact.phones.map((p) => p.number || p.value)
          : [];
        parts.push(...phones);
        const vehicles = Array.isArray(contact.vehicles) ? contact.vehicles : [];
        vehicles.forEach((v) => {
          parts.push(v.vin, v.year, v.make, v.model, v.trim);
        });
      }
      const searchHaystack = parts
        .filter(Boolean)
        .map((s) => String(s).toLowerCase())
        .join(' ');
      const phonesDigits = (contact?.phones || [])
        .map((p) => digitsOnly(p.number || p.value))
        .filter(Boolean)
        .join(' ');
      return {
        ...o,
        age: ageDays(o.created_at),
        _contact: contact,
        searchHaystack,
        phonesDigits,
      };
    });
  }, [opportunities, contacts]);

  // Build the schema for AdvancedFilter. Status enum is grouped by opp
  // type (Wave 26a fu1 Item 3); Payments group is derived from the live
  // opportunity set since canon doesn't define payments statuses yet.
  // Wave 26a fu3 — Owner enum is DYNAMIC: when one or more orgs are
  // staged in the same modal's Organization filter, the Owner option
  // set narrows to owners whose opps touch those orgs (intersection
  // via deriveOwnerOrgMap + ownersForOrgs). With zero orgs staged the
  // full per-opp owner set is shown. The map itself is built once per
  // opps/contacts render (memoized below).
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
    const STATUS_GROUPS = [
      { groupLabel: 'Protection (VSC)', values: PROTECTION_STATUSES },
      { groupLabel: 'Refi', values: REFI_STATUSES },
      { groupLabel: 'Insurance', values: INSURANCE_STATUSES },
    ];
    if (paymentsStatuses.length > 0) {
      STATUS_GROUPS.push({ groupLabel: 'Payments', values: paymentsStatuses });
    }
    // Inbox has no `opp_type` schema entry — it uses the top-level <select>
    // dropdown (typeFilter) and the AgentHome deep-link (inboxFilter.type).
    // Derive the effective type from those outer-state sources so the modal's
    // status groups mirror the page-level narrowing. (fu5b)
    const effectiveType =
      (typeFilter && typeFilter !== 'all') ? typeFilter :
      inboxFilter?.type ? inboxFilter.type :
      null;
    // Dependent owner enum — `staged.org` is an array of org IDs.
    // selectedOrgIds [] → all owners in the map (scoped by agent access).
    // selectedOrgIds [102] → only owners whose opps touch a contact in 102.
    const ownerDynamic = (staged) => {
      const selectedOrgIds = Array.isArray(staged?.org) ? staged.org : [];
      const owners = ownersForOrgs(ownerOrgMap, selectedOrgIds).sort();
      return owners.map((o) => ({ value: o, label: o }));
    };
    return [
      // Free-form text — routed to the per-opp pre-built haystack.
      { key: 'text', label: 'Any text', field: 'text.any', type: 'text', level: 'opportunity' },
      {
        key: 'status',
        label: 'Status',
        field: 'opportunity.status',
        type: 'enum',
        dynamicEnumGroups: () => {
          if (!effectiveType) return STATUS_GROUPS;
          const TYPE_TO_GROUP_LABEL = {
            protection: 'Protection (VSC)',
            refi: 'Refi',
            insurance: 'Insurance',
            payments: 'Payments',
          };
          const wanted = TYPE_TO_GROUP_LABEL[effectiveType];
          return STATUS_GROUPS.filter((g) => g.groupLabel === wanted);
        },
        level: 'opportunity',
      },
      {
        key: 'org',
        label: 'Organization',
        field: 'contact.org_id',
        type: 'enum',
        enumValues: ACCESSIBLE_ORGS,
        level: 'contact',
      },
      {
        key: 'owner',
        label: 'Agent user / owner',
        field: 'opportunity.owner',
        type: 'enum',
        dynamicEnumValues: ownerDynamic,
        level: 'opportunity',
      },
      { key: 'value', label: 'Value', field: 'opportunity.value', type: 'number_range', level: 'opportunity' },
      { key: 'created_at', label: 'Created', field: 'opportunity.created_at', type: 'date_range', level: 'opportunity' },
      { key: 'updated_at', label: 'Updated', field: 'opportunity.updated_at', type: 'date_range', level: 'opportunity' },
      { key: 'deadline', label: 'Deadline', field: 'opportunity.deadline', type: 'date_range', level: 'opportunity' },
      // Wave 28d — manager-overlay extra filter entries (Owner=Unassigned
      // option + Stuck derived filter + API-failure derived gated by preset).
      ...(Array.isArray(extraFilters) ? extraFilters : []),
    ];
  }, [opportunities, ownerOrgMap, typeFilter, inboxFilter, extraFilters]);

  // Path resolver for AdvancedFilter. Row shape here is opp-centric:
  // each row IS one opportunity (with `_contact` attached). Resolve
  // 'contact.*' paths off `_contact`, 'opportunity.*' off the row,
  // 'text.any' off the pre-built haystack.
  function getter(row, field) {
    if (!field) return null;
    if (field === 'text.any') return row.searchHaystack;
    if (field.startsWith('contact.')) {
      const rest = field.slice('contact.'.length);
      if (!row._contact) return null;
      return rest.split('.').reduce((acc, k) => (acc == null ? null : acc[k]), row._contact);
    }
    if (field.startsWith('vehicle.')) {
      const rest = field.slice('vehicle.'.length);
      const vehicles = Array.isArray(row._contact?.vehicles) ? row._contact.vehicles : [];
      return vehicles.map((v) => rest.split('.').reduce((acc, k) => (acc == null ? null : acc[k]), v));
    }
    if (field.startsWith('opportunity.')) {
      const rest = field.slice('opportunity.'.length);
      return rest.split('.').reduce((acc, k) => (acc == null ? null : acc[k]), row);
    }
    return row[field];
  }

  // Visible-rows pipeline: inboxFilter (type / status / stage from
  // AgentHome) → local type-dropdown → adv-filter → search → sort.
  // All filters apply DIRECTLY to the opp row (not "any of this contact's
  // opps") — Inbox is opp-centric.
  const visible = useMemo(() => {
    let rows = enriched;
    // (1) AgentHome inboxFilter
    if (inboxFilter?.type) rows = rows.filter((r) => r.type === inboxFilter.type);
    if (inboxFilter?.status) rows = rows.filter((r) => r.status === inboxFilter.status);
    if (inboxFilter?.stage) {
      rows = rows.filter((r) => crmStageOf(r) === inboxFilter.stage);
    }
    // (2) Local type-dropdown (stacks with inboxFilter.type)
    if (typeFilter !== 'all') rows = rows.filter((r) => r.type === typeFilter);
    // (3) Advanced filter
    rows = applyFilters(rows, filterSchema, advValues, getter);
    // (4) Free-form search — Task 1B
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      const qDigits = digitsOnly(q);
      rows = rows.filter((r) => {
        if (r.searchHaystack.includes(q)) return true;
        if (qDigits && r.phonesDigits.includes(qDigits)) return true;
        return false;
      });
    }
    // (5) Sort
    rows = [...rows].sort((a, b) => {
      const va = a[sortCol];
      const vb = b[sortCol];
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDir === 'asc' ? va - vb : vb - va;
      }
      const sa = String(va ?? '');
      const sb = String(vb ?? '');
      return sortDir === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
    return rows;
  }, [enriched, inboxFilter, typeFilter, search, advValues, filterSchema, sortCol, sortDir]);

  // Task 1D: infinite scroll. The hook auto-resets when `rows.length`
  // changes, which covers filter/search-change reset for us.
  const { visibleRows, sentinelRef, scrollerRef, hasMore } = useInfiniteScroll(
    visible,
    { pageSize: PAGE_SIZE },
  );
  // Single ref for both the scroll container AND BackToTop.
  const scrollContainerRef = useRef(null);

  const selectedOpp = useMemo(() => {
    if (right?.kind !== 'copilot') return null;
    return enriched.find((o) => o.id === right.oppId) || null;
  }, [enriched, right]);

  // Wave 28d — bulk selection state. Only active when the caller provides
  // bulkActions; otherwise these stay empty and have no rendering effect.
  const hasBulkActions = Array.isArray(bulkActions) && bulkActions.length > 0;
  const [selectedOppIds, setSelectedOppIds] = useState(() => new Set());
  function toggleSelect(oppId) {
    setSelectedOppIds((prev) => {
      const next = new Set(prev);
      if (next.has(oppId)) next.delete(oppId);
      else next.add(oppId);
      return next;
    });
  }
  function toggleSelectAll(rows) {
    setSelectedOppIds((prev) => {
      const ids = rows.map((r) => r.id);
      const allSelected = ids.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelectedOppIds(new Set());
  }

  // Wave 28d fu Change 1 — flipped default: agent groups now render
  // COLLAPSED by default. Convention is inverted vs. the pre-fu state:
  // the set now tracks owners the user has explicitly EXPANDED; absence
  // from the set = collapsed. This avoids a first-render expand→collapse
  // flicker (vs. seeding via effect) and means filter / search / scroll
  // changes never force-collapse an owner the user has opened — they're
  // simply not removed from the set unless toggled.
  //
  // Wave 28d-fu2 — when `groupByOrg === true`, the expansion key includes
  // the org context as `${orgId}__${owner}` so an agent rendered inside
  // two different org groups has independent expansion state. Single-org
  // mode (groupByOrg false) keeps the existing owner-only key — no
  // regression.
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  function expansionKey(owner, orgId) {
    return orgId == null ? owner : `${orgId}__${owner}`;
  }
  function toggleGroup(owner, orgId) {
    const key = expansionKey(owner, orgId);
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Wave 28d fu — outer org grouping layer. Org groups default EXPANDED
  // (so the manager sees all orgs without clicking, and the agent
  // groups inside are collapsed per Change 1). Mirrored convention to
  // the agent layer: in-set ⇒ collapsed. Default empty ⇒ all expanded.
  const [collapsedOrgGroups, setCollapsedOrgGroups] = useState(() => new Set());
  function toggleOrgGroup(orgId) {
    setCollapsedOrgGroups((prev) => {
      const next = new Set(prev);
      const key = String(orgId);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Per-agent metric chips for group headers — read once per render off the
  // shared blinkerApi cache so the counts stay in sync with the same agents
  // SDK that ManagerHome / ManagerTeam consume.
  const agentMetricsByName = useMemo(() => {
    if (!groupByAgent) return null;
    const rows = blinkerApi.agents.list();
    const map = new Map();
    for (const a of rows) map.set(a.name, a);
    return map;
  }, [groupByAgent]);

  function toggleSort(key) {
    if (key === sortCol) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortCol(key);
      // Task 1A: age defaults to ASC; other columns also default to ASC
      // (matches pre-Wave-26a behavior for non-age columns).
      setSortDir('asc');
    }
  }

  function openCoPilot(oppId) {
    setRight({ kind: 'copilot', oppId });
  }
  function openProfile(contactId) {
    setRight({ kind: 'profile', contactId });
  }
  function closeRight() {
    setRight(null);
  }

  function rowClasses(o) {
    const isSelectedOpp = right?.kind === 'copilot' && right.oppId === o.id;
    const isSelectedContact = right?.kind === 'profile' && right.contactId === o.contact_id;
    if (isSelectedOpp) return 'bg-blue-50';
    if (isSelectedContact) return 'bg-emerald-50';
    return 'bg-white hover:bg-slate-50';
  }

  // Active-filter chips strip — clicking the X clears that single field.
  const activeAdvChips = useMemo(() => {
    return filterSchema
      .map((f) => {
        const desc = describeFilterValue(f, advValues[f.key]);
        if (desc == null) return null;
        return { field: f, text: desc };
      })
      .filter(Boolean);
  }, [advValues, filterSchema]);

  // Full-bleed pane: when a row is selected, the pane replaces the inbox in
  // the main content area. The left nav rail (Inbox / Contacts / Calendar)
  // stays visible — it's owned by App.jsx, not this component.
  if (right?.kind === 'copilot' && selectedOpp) {
    return (
      <CoPilotPane
        opportunity={selectedOpp}
        persona={persona}
        contacts={contacts}
        opportunities={opportunities}
        appendVehicleToContact={appendVehicleToContact}
        updateContactVehicle={updateContactVehicle}
        dedupAndUpsertVehicle={dedupAndUpsertVehicle}
        updateOpportunity={updateOpportunity}
        onClose={closeRight}
        onOpenContactProfile={() => openProfile(selectedOpp.contact_id)}
        // Wave 31 v3.0.11 (ADR 21 D3a / D4) — Find Coverage spawn AND
        // related-opp row clicks both route through here. Reuses the
        // existing openCoPilot setter that powers the inbox-row click
        // affordance.
        onOpenOpportunity={openCoPilot}
        managerOverlay={personaOverlay}
      />
    );
  }
  if (right?.kind === 'profile') {
    return (
      // key={contactId} forces a fresh mount when household-member click
      // re-targets the profile, which resets sessionNotes seed + draft.
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
        onOpenInCoPilot={openCoPilot}
        onOpenContactProfile={openProfile}
        testMode={testMode}
      />
    );
  }

  return (
    <div className="flex-1 flex min-h-0 bg-slate-50">
      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-6 pt-6 pb-4 border-b border-slate-200 bg-white">
          <div className="flex items-center gap-2 text-blue-600 mb-1">
            <Inbox className="w-4 h-4" />
            <span className="text-xs uppercase tracking-wide font-semibold">
              Agent · {activeKey}
            </span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Opportunity inbox
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {visible.length} of {enriched.length} opportunities · sorted by{' '}
            <span className="font-medium text-slate-700">{sortCol}</span> ({sortDir})
          </p>
          <p className="text-[11px] text-slate-400 mt-1">
            Click a contact name to open their profile · click any other column to open the
            co-pilot pane.
          </p>
        </div>

        {/* Dashboard filter chip — shown when AgentHome type-tile, status-pill, or funnel-header sets a filter */}
        {inboxFilter && (
          <div className="px-6 py-2 bg-blue-50 border-b border-blue-100 flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-blue-500 shrink-0" />
            <span className="text-xs text-blue-700 font-medium">
              Filter:
              {inboxFilter.type && (
                <span className="ml-1 uppercase">{inboxFilter.type}</span>
              )}
              {inboxFilter.status && (
                <span className="ml-1">· {inboxFilter.status}</span>
              )}
              {inboxFilter.stage && (
                <span className="ml-1">· stage: {inboxFilter.stage}</span>
              )}
            </span>
            <button
              onClick={onClearInboxFilter}
              className="ml-auto text-blue-500 hover:text-blue-700 p-0.5 rounded"
              aria-label="Clear filter"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="px-6 py-3 bg-white border-b border-slate-200 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="text-sm border border-slate-200 rounded-md px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All types</option>
              <option value="protection">Protection</option>
              <option value="refi">Refi</option>
              <option value="insurance">Insurance</option>
              <option value="payments">Payments</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => setAdvOpen(true)}
            className="inline-flex items-center gap-1.5 text-sm border border-slate-200 rounded-md px-2.5 py-1.5 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <SlidersHorizontal className="w-4 h-4 text-slate-500" />
            Filters
            {activeAdvChips.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-blue-600 text-white text-[10px] font-semibold px-1">
                {activeAdvChips.length}
              </span>
            )}
          </button>
          <div className="relative max-w-md flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, phone, VIN, vehicle…"
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

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
                {hasBulkActions && (
                  <th className="px-3 py-2.5 w-8">
                    <input
                      type="checkbox"
                      checked={
                        visibleRows.length > 0 &&
                        visibleRows.every((r) => selectedOppIds.has(r.id))
                      }
                      onChange={() => toggleSelectAll(visibleRows)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      aria-label="Select all visible"
                    />
                  </th>
                )}
                {COLUMNS.map((col) => {
                  const isActive = sortCol === col.key;
                  const Icon = !isActive ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;
                  return (
                    <th
                      key={col.key}
                      onClick={() => toggleSort(col.key)}
                      className="px-4 py-2.5 text-left font-medium text-slate-500 cursor-pointer hover:text-slate-800 select-none whitespace-nowrap"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {col.label}
                        <Icon
                          className={
                            'w-3 h-3 ' + (isActive ? 'text-slate-700' : 'text-slate-300')
                          }
                        />
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {renderRowsOrGroups({
                visibleRows,
                groupByAgent,
                groupByOrg,
                hasBulkActions,
                expandedGroups,
                toggleGroup,
                collapsedOrgGroups,
                toggleOrgGroup,
                selectedOppIds,
                toggleSelect,
                rowClasses,
                openCoPilot,
                openProfile,
                testMode,
                agentMetricsByName,
                colSpan: COLUMNS.length + (hasBulkActions ? 1 : 0),
              })}
              {visible.length === 0 && (
                <tr>
                  <td
                    colSpan={COLUMNS.length + (hasBulkActions ? 1 : 0)}
                    className="px-4 py-12 text-center text-sm text-slate-400"
                  >
                    No opportunities match your filters.
                  </td>
                </tr>
              )}
              {/* Sentinel for IntersectionObserver-driven infinite scroll. */}
              {hasMore && (
                <tr>
                  <td
                    ref={sentinelRef}
                    colSpan={COLUMNS.length + (hasBulkActions ? 1 : 0)}
                    className="px-4 py-4 text-center text-xs text-slate-400"
                  >
                    Loading more…
                  </td>
                </tr>
              )}
              {!hasMore && visible.length > PAGE_SIZE && (
                <tr>
                  <td
                    colSpan={COLUMNS.length + (hasBulkActions ? 1 : 0)}
                    className="px-4 py-3 text-center text-[11px] text-slate-400 italic"
                  >
                    End of list · {visible.length} opportunities
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {hasBulkActions && selectedOppIds.size > 0 && (
          <BulkActionBar
            count={selectedOppIds.size}
            actions={bulkActions}
            selectedIds={Array.from(selectedOppIds)}
            onClear={clearSelection}
          />
        )}
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

// One opportunity row. Factored out so the group-by-agent renderer can
// reuse it without duplicating cell markup. The default (flat) render
// path drives the same component, so backwards-compat is preserved.
function OppRow({
  o,
  hasBulkActions,
  selected,
  onToggleSelect,
  rowClasses,
  openCoPilot,
  openProfile,
  testMode,
}) {
  return (
    <tr className={'border-b border-slate-100 transition-colors ' + rowClasses(o)}>
      {hasBulkActions && (
        <td className="px-3 py-3 w-8">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(o.id)}
            onClick={(e) => e.stopPropagation()}
            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            aria-label="Select opportunity"
          />
        </td>
      )}
      <td onClick={() => openCoPilot(o.id)} className="px-4 py-3 whitespace-nowrap cursor-pointer">
        <Tooltip
          content={testMode && o._test_case ? `Test case: ${o._test_case}` : null}
          placement="bottom-left"
        >
          <span
            className={
              'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ring-1 ring-inset ' +
              TYPE_BADGE[o.type]
            }
          >
            {TYPE_LABELS[o.type]}
            {testMode && o._test_case && (
              <HelpCircle className="w-3 h-3 ml-1 inline-block opacity-60" />
            )}
          </span>
        </Tooltip>
      </td>
      <td
        onClick={() => openProfile(o.contact_id)}
        className="px-4 py-3 text-slate-900 font-medium whitespace-nowrap cursor-pointer hover:underline"
      >
        {o.contact_name}
      </td>
      <td
        onClick={() => openCoPilot(o.id)}
        className="px-4 py-3 text-slate-600 whitespace-nowrap cursor-pointer"
      >
        {o.vehicle}
      </td>
      <td onClick={() => openCoPilot(o.id)} className="px-4 py-3 whitespace-nowrap cursor-pointer">
        <span
          className={
            'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ring-1 ring-inset ' +
            statusPillClasses(o.type, o.status)
          }
        >
          {o.status}
        </span>
      </td>
      <td
        onClick={() => openCoPilot(o.id)}
        className="px-4 py-3 text-slate-600 whitespace-nowrap cursor-pointer"
      >
        {ageLabel(o.age)}
      </td>
      <td
        onClick={() => openCoPilot(o.id)}
        className="px-4 py-3 text-slate-600 whitespace-nowrap cursor-pointer"
      >
        {o.owner}
      </td>
      <td
        onClick={() => openCoPilot(o.id)}
        className="px-4 py-3 text-slate-500 truncate max-w-[260px] cursor-pointer"
      >
        {o.next_action}
      </td>
    </tr>
  );
}

// Org-name lookup off canon. Falls back to "Org {id}" when an opp's
// contact references an id not in the canon registry (e.g. test fixtures
// pointing at a partner that's been retired).
const ORG_NAME_BY_ID = new Map(
  (orgRegistry.orgs || []).map((o) => [o.id, o.name]),
);
function orgNameFor(orgId) {
  if (orgId == null) return 'Unknown org';
  return ORG_NAME_BY_ID.get(orgId) || `Org ${orgId}`;
}

// Render one agent's collapsible group (header row + child OppRows).
// Factored out so the org-grouped render path can reuse it without
// duplicating header markup. `orgId` is forwarded to toggleGroup so the
// expansion key matches the per-org-instance key when nested under an
// org group (Wave 28d-fu2). Pass orgId=undefined for flat agent mode.
function renderAgentGroup({
  g,
  collapsed,
  toggleGroup,
  orgId,
  rowProps,
  colSpan,
  keyPrefix = '',
}) {
  const out = [];
  out.push(
    <tr
      key={`__agent__${keyPrefix}${g.owner}`}
      className="bg-slate-100 border-b border-slate-200 cursor-pointer hover:bg-slate-200/80"
      onClick={() => toggleGroup(g.owner, orgId)}
    >
      <td colSpan={colSpan} className="px-3 py-2">
        <div className="flex items-center gap-2 text-xs">
          {collapsed ? (
            <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
          )}
          <span className="font-semibold text-slate-800">
            {g.owner === '__unassigned__' ? 'Unassigned' : g.owner}
          </span>
          <span className="text-slate-500">·</span>
          <span className="text-slate-600">
            <span className="font-medium text-slate-800">{g.openCount}</span> open
          </span>
          {g.staleCount > 0 && (
            <>
              <span className="text-slate-500">·</span>
              <span className="text-amber-700">
                <span className="font-medium">{g.staleCount}</span> stale
              </span>
            </>
          )}
          {g.conversion != null && (
            <>
              <span className="text-slate-500">·</span>
              <span className="text-slate-600">
                conv <span className="font-medium text-slate-800">
                  {(g.conversion * 100).toFixed(0)}%
                </span>
              </span>
            </>
          )}
          <span className="text-slate-400 ml-2">
            ({g.rows.length} in view)
          </span>
        </div>
      </td>
    </tr>,
  );
  if (!collapsed) {
    for (const o of g.rows) {
      out.push(<OppRow key={o.id} {...rowProps(o)} />);
    }
  }
  return out;
}

// Status-class predicates — mirrors ManagerHome's WINNING/LOSING sets.
// Inlined here so `buildAgentGroups` can recompute per-org-scope metrics
// from a row subset without cross-file coupling. The status strings come
// from the canonical GHL status taxonomy (canon/ghl-status.json).
const _WINNING_STATUSES = new Set([
  'Won', 'Closed Won', 'Active', 'Paid in Full', 'Funded',
  'Payment Agreement Signed', 'Remitted', 'Policy Written',
]);
const _LOSING_STATUSES = new Set([
  'Lost', 'Closed Lost', 'Abandoned', 'Cancelled', 'Rejected',
]);
function _isOpen(o) {
  return !_LOSING_STATUSES.has(o?.status) && !_WINNING_STATUSES.has(o?.status);
}
function _isWon(o) {
  return _WINNING_STATUSES.has(o?.status);
}
function _isLost(o) {
  return _LOSING_STATUSES.has(o?.status);
}
const _STALE_MS = 7 * 24 * 3600 * 1000;

// Build the per-owner group descriptors (sorted busiest-first) off a
// set of opp rows. Pure — no state.
//
// When `perOrgScope` is true, the open/stale/conversion metrics are
// recomputed from the input row subset (which is already filtered to
// one org's opps by the caller). This is what makes an agent rendered
// in multiple org groups show independent per-org counts. When false
// (flat agent grouping), the global SDK metrics from `agentMetricsByName`
// remain authoritative.
function buildAgentGroups(rows, agentMetricsByName, perOrgScope = false) {
  const byOwner = new Map();
  for (const o of rows) {
    const k = o.owner || '__unassigned__';
    if (!byOwner.has(k)) byOwner.set(k, []);
    byOwner.get(k).push(o);
  }
  const now = Date.now();
  const groups = Array.from(byOwner.entries()).map(([owner, rs]) => {
    const meta = agentMetricsByName?.get(owner) || null;
    if (perOrgScope) {
      const openRows = rs.filter(_isOpen);
      const openCount = openRows.length;
      const staleCount = openRows.filter((o) => {
        const t = Date.parse(o.updated_at || '');
        return Number.isFinite(t) && now - t > _STALE_MS;
      }).length;
      const won = rs.filter(_isWon).length;
      const lost = rs.filter(_isLost).length;
      const conversion = won + lost === 0 ? null : won / (won + lost);
      return { owner, rows: rs, openCount, staleCount, conversion };
    }
    const openCount = meta?.open_count ?? rs.length;
    const staleCount = meta?.stale_count ?? 0;
    const conversion = meta?.conversion;
    return { owner, rows: rs, openCount, staleCount, conversion };
  });
  groups.sort((a, b) => b.openCount - a.openCount);
  return groups;
}

// Render the visible rows in one of four shapes:
//   - flat                              (no grouping)
//   - by agent only                     (Wave 28d)
//   - by org only                       (Wave 28d fu — built; not wired)
//   - by org → by agent (nested)        (Wave 28d fu — manager multi-org)
// Pure render helper — no state, no side effects.
function renderRowsOrGroups({
  visibleRows,
  groupByAgent,
  groupByOrg,
  hasBulkActions,
  expandedGroups,
  toggleGroup,
  collapsedOrgGroups,
  toggleOrgGroup,
  selectedOppIds,
  toggleSelect,
  rowClasses,
  openCoPilot,
  openProfile,
  testMode,
  agentMetricsByName,
  colSpan,
}) {
  const rowProps = (o) => ({
    o,
    hasBulkActions,
    selected: selectedOppIds.has(o.id),
    onToggleSelect: toggleSelect,
    rowClasses,
    openCoPilot,
    openProfile,
    testMode,
  });
  if (!groupByAgent && !groupByOrg) {
    return visibleRows.map((o) => <OppRow key={o.id} {...rowProps(o)} />);
  }
  if (groupByAgent && !groupByOrg) {
    const groups = buildAgentGroups(visibleRows, agentMetricsByName);
    const out = [];
    for (const g of groups) {
      out.push(
        ...renderAgentGroup({
          g,
          collapsed: !expandedGroups.has(g.owner),
          toggleGroup,
          orgId: undefined,
          rowProps,
          colSpan,
        }),
      );
    }
    return out;
  }
  // groupByOrg true (with or without nested groupByAgent). Partition rows
  // by the contact's org_id, drop empty orgs, sort busiest-first then by
  // org name asc. Each org header is its own row.
  const byOrg = new Map();
  for (const o of visibleRows) {
    const orgId = o._contact?.org_id ?? null;
    const key = orgId == null ? '__no_org__' : orgId;
    if (!byOrg.has(key)) byOrg.set(key, []);
    byOrg.get(key).push(o);
  }
  const orgGroups = Array.from(byOrg.entries()).map(([key, rs]) => {
    const orgId = key === '__no_org__' ? null : key;
    const name = key === '__no_org__' ? 'Unknown org' : orgNameFor(orgId);
    const owners = new Set(rs.map((r) => r.owner || '__unassigned__'));
    return {
      key: String(key),
      orgId,
      name,
      rows: rs,
      oppCount: rs.length,
      agentCount: owners.size,
    };
  });
  orgGroups.sort((a, b) => {
    if (b.oppCount !== a.oppCount) return b.oppCount - a.oppCount;
    return String(a.name).localeCompare(String(b.name));
  });
  const out = [];
  for (const og of orgGroups) {
    if (og.oppCount === 0) continue;
    const orgCollapsed = collapsedOrgGroups.has(og.key);
    out.push(
      <tr
        key={`__org__${og.key}`}
        className="bg-slate-200 border-b border-slate-300 cursor-pointer hover:bg-slate-300/80"
        onClick={() => toggleOrgGroup(og.key)}
      >
        <td colSpan={colSpan} className="px-3 py-2">
          <div className="flex items-center gap-2 text-xs">
            {orgCollapsed ? (
              <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-slate-600" />
            )}
            <span className="font-semibold text-slate-900">{og.name}</span>
            <span className="text-slate-500">·</span>
            <span className="text-slate-700">
              <span className="font-medium text-slate-900">{og.agentCount}</span>{' '}
              agent{og.agentCount === 1 ? '' : 's'}
            </span>
            <span className="text-slate-500">·</span>
            <span className="text-slate-700">
              <span className="font-medium text-slate-900">{og.oppCount}</span>{' '}
              opportunit{og.oppCount === 1 ? 'y' : 'ies'}
            </span>
          </div>
        </td>
      </tr>,
    );
    if (orgCollapsed) continue;
    if (groupByAgent) {
      // Per-org-scope: metrics recompute from og.rows; expansion state
      // keyed `${orgId}__${owner}` so the same agent in another org's
      // group toggles independently. Wave 28d-fu2.
      const innerGroups = buildAgentGroups(og.rows, agentMetricsByName, true);
      for (const g of innerGroups) {
        out.push(
          ...renderAgentGroup({
            g,
            collapsed: !expandedGroups.has(`${og.key}__${g.owner}`),
            toggleGroup,
            orgId: og.key,
            rowProps,
            colSpan,
            keyPrefix: `${og.key}__`,
          }),
        );
      }
    } else {
      for (const o of og.rows) {
        out.push(<OppRow key={o.id} {...rowProps(o)} />);
      }
    }
  }
  return out;
}

function BulkActionBar({ count, actions, selectedIds, onClear }) {
  return (
    <div className="border-t border-slate-200 bg-white px-4 py-2 flex items-center gap-2 shadow-[0_-4px_8px_-4px_rgba(15,23,42,0.08)]">
      <span className="text-xs text-slate-600">
        <span className="font-semibold text-slate-900">{count}</span>{' '}
        opportunit{count === 1 ? 'y' : 'ies'} selected
      </span>
      <div className="flex items-center gap-1.5 ml-2">
        {actions.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => a.onClick(selectedIds)}
            className="text-xs px-2.5 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
          >
            {a.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto text-xs text-slate-500 hover:text-slate-800 px-1.5"
      >
        Clear
      </button>
    </div>
  );
}
