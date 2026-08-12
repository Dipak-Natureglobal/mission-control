import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity as ActivityIcon,
  Sun,
  UserPlus,
  Users,
  Zap,
} from 'lucide-react';
import { useSessionData } from '../../lib/session-data.js';
import {
  TODAY,
  relativeTime,
  formatOrgTime,
  getActiveOrgId,
  getOrgTimezone,
  crmStageOf,
} from '../../lib/canon.js';
import { track } from 'blinker-platform/telemetry';
import { blinkerApi } from 'blinker-platform/api';
import { AddContactModal } from '../../components/AddContactModal.jsx';
import { StartOpportunityFlow } from '../../components/StartOpportunityFlow.jsx';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll.js';
import { BackToTop } from '../../shared/BackToTop.jsx';
import { Tooltip } from '../../shared/Tooltip.jsx';
import { DateLensSelect } from '../../shared/DateLensSelect.jsx';
import { AgentMetricsGrid } from '../../shared/AgentMetricsGrid.jsx';

// AgentHome — landing page for the agent persona. Displays:
//   - greeting header (placeholder agent name "Devon" — agents.json fixture
//     does not exist yet; promote when it does)
//   - quick-action launchers ("+ Add contact", "+ Start opportunity")
//   - 4 KPI tiles (responsive grid)
//   - "By type" badge row
//   - "By status" pill row
//   - recent activity (top 5 from blinkerApi.activities.listAll, newest first)
//
// Click handlers push PostHog events under the mission_control.home.* prefix.
// All data is derived from the same useSessionData() hook AgentInbox uses,
// so adding/closing opportunities updates Home in real time.

const AGENT_FIRST_NAME = 'Devon';

// Open = anything not in a terminal/funded/closed state. Conservative regex
// match against status string keeps it canon-agnostic across the four
// workflow types.
const TERMINAL_STATUS_RE =
  /(funded|policy bound|policy written|paid in full|active|remitted|won|lost|closed|cancelled?|declined?|not interested|signed)/i;

function isOpen(opp) {
  if (!opp.status) return true;
  return !TERMINAL_STATUS_RE.test(opp.status);
}

function greeting() {
  // Pinned today → use the pinned hour (12:00 UTC ≈ morning in most US TZs).
  const h = TODAY.getUTCHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function AgentHome({ session, onJumpToInbox, onHomeFilter }) {
  // Prefer the App-level session bag so adds in Home reflect in Inbox.
  // Fallback covers any standalone Storybook-style mount.
  // Wave 31b-fu3 — opt out of writer registration; App.jsx is the host.
  const localSession = useSessionData({ registerAsHost: false });
  const {
    opportunities,
    contacts,
    appendOpportunity,
    appendContact,
    appendVehicleToContact,
    appendHouseholdRelationship,
    patchContact,
  } = session || localSession;

  const [addContactOpen, setAddContactOpen] = useState(false);
  const [startOppOpen, setStartOppOpen] = useState(false);
  // When the "+ Add contact" launcher saves, we route into Start
  // Opportunity seeded with the new contact (and skip the contact-picker
  // step). Cleared once the StartOpp modal closes.
  const [seededContact, setSeededContact] = useState(null);
  // Date filter lens — Task 3D. Drives the shared AgentMetricsGrid
  // (KPI tiles + by-type cards + status-pill rollups). The funnel-header
  // line (Task 3F) deliberately ignores the lens — it's always all-time.
  const [dateLens, setDateLens] = useState('recent');

  useEffect(() => {
    track('mission_control.home.viewed', {
      open_count: opportunities.filter(isOpen).length,
    });
    // Eslint exhaustive-deps would push us to depend on opportunities,
    // but we only want to fire once per home mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Agent funnel snapshot (Task 3F) — ALWAYS all-time, NEVER lens-scoped.
  // The brief is explicit: even though the page has a date lens, the
  // header line shows the agent's full-time funnel. Today there is no
  // real agent identity (no agents.json fixture yet — see TODO at top
  // of file). For Phase 1.5 we count ALL org opps unscoped; flagged
  // for Wave 26b once the fixture lands.
  // TODO Wave 26b: per-agent scoping needs agents.json fixture; when
  // it does, filter enriched by `owner === <session.user.display_name>`.
  const funnelCounts = useMemo(() => {
    const counts = { open: 0, won: 0, lost: 0, abandoned: 0 };
    for (const o of opportunities) {
      const s = crmStageOf(o);
      if (s === 'unknown') counts.open += 1;
      else if (counts[s] !== undefined) counts[s] += 1;
    }
    return counts;
  }, [opportunities]);

  // Pull from the platform SDK so notes/activities written at runtime
  // (ContactProfile addNote, future agent-action writes) flow into the
  // dashboard feed without a fixture round-trip. `contact_ids` scopes the
  // cross-contact merge to the contacts the session knows about — the SDK
  // falls back to the fixture's distinct contact_ids when omitted, but
  // passing the session set keeps newly-added contacts in scope too.
  //
  // Wave 26a Phase 2 / Task 3A — limit dropped (was 5). The card paginates
  // 25 rows at a time via useInfiniteScroll below, so the full feed is
  // available for scroll-through without round-tripping the SDK on every
  // page.
  const recentActivities = useMemo(() => {
    const ids = Object.keys(contacts || {});
    return blinkerApi.activities.listAll({ contact_ids: ids });
  }, [contacts]);

  // Resolved active org TZ for the activity-card timestamp. Today the
  // active-org lookup falls back to the first canon org with
  // status='active' (Apex 102 in fixtures); when the org switcher lands
  // this becomes parameterized. See lib/canon.js getActiveOrgId.
  const activeOrgId = useMemo(() => getActiveOrgId(), []);
  const activeOrgTz = useMemo(() => getOrgTimezone(activeOrgId), [activeOrgId]);

  // Page-level scroll container so the BackToTop button has a target.
  // AgentHome's outer flex-1 overflow-auto wrapper IS the scroller (the
  // page itself is constrained-height); RecentActivityCard sits inside
  // that wrapper and grows tall as we paginate.
  const pageScrollerRef = useRef(null);

  // Unified handler — the shared AgentMetricsGrid fires both KPI-tile
  // tokens ('open_opps' | 'avg_age' | 'lost_opps' | 'conversions') and
  // by-type/by-status payloads ('by_type:X' | 'by_status:X:Y'). Route
  // each shape to the matching App-level inbox handler.
  function handleMetricsClick(payload) {
    if (payload === 'open_opps' || payload === 'avg_age' || payload === 'conversions') {
      track('mission_control.home.kpi_clicked', { tile: payload });
      if (onJumpToInbox) onJumpToInbox();
      return;
    }
    if (payload === 'lost_opps') {
      track('mission_control.home.kpi_clicked', { tile: 'lost_opps' });
      if (onHomeFilter) onHomeFilter('by_stage:lost');
      return;
    }
    if (payload.startsWith('by_type:')) {
      const type = payload.slice('by_type:'.length);
      track('mission_control.agent_home.inbox_filter_applied', {
        filter_type: 'by_type',
        type,
        status: null,
      });
    } else if (payload.startsWith('by_status:')) {
      const parts = payload.slice('by_status:'.length).split(':');
      const [type, ...rest] = parts;
      const status = rest.join(':');
      track('mission_control.agent_home.inbox_filter_applied', {
        filter_type: 'by_status',
        type,
        status,
      });
    }
    if (onHomeFilter) onHomeFilter(payload);
  }

  // Funnel-header (Task 3F) click — fires by_stage:<bucket> which
  // routes to Inbox with NO date filter (all-time).
  function handleFunnelClick(stage) {
    track('mission_control.home.funnel_clicked', { stage });
    if (onHomeFilter) onHomeFilter(`by_stage:${stage}`);
  }

  function handleAddContactOpen() {
    track('mission_control.home.add_contact_opened');
    setAddContactOpen(true);
  }

  function handleAddContactSaved({ contact, householdRelationship }) {
    if (appendContact) appendContact(contact);
    if (householdRelationship && appendHouseholdRelationship) {
      appendHouseholdRelationship(householdRelationship);
    }
    track('mission_control.home.add_contact_saved', {
      contact_id: contact.id,
      with_household_relationship: !!householdRelationship,
    });
    setAddContactOpen(false);
    // Route immediately to Start Opportunity seeded with the new contact.
    // The StartOpp modal opens at the type-pick step (contact already
    // chosen → contact step is skipped via initialStep).
    setSeededContact(contact);
    setStartOppOpen(true);
    track('mission_control.home.start_opportunity_after_add_contact', {
      contact_id: contact.id,
    });
  }

  function handleStartOppOpen() {
    track('mission_control.home.start_opportunity_clicked');
    setStartOppOpen(true);
  }

  function handleStartOppCreated(oppId) {
    setStartOppOpen(false);
    if (onJumpToInbox) onJumpToInbox(oppId);
  }

  return (
    <div ref={pageScrollerRef} className="flex-1 overflow-auto bg-slate-50 relative">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <Header />
        <QuickActions
          onAddContact={handleAddContactOpen}
          onStartOpportunity={handleStartOppOpen}
          dateLens={dateLens}
          onDateLensChange={(v) => {
            track('mission_control.home.date_lens_changed', { lens: v });
            setDateLens(v);
          }}
        />
        <AgentMetricsGrid
          lens={dateLens}
          onPillClick={handleMetricsClick}
          session={session || localSession}
        />
        <RecentActivityCard
          recentActivities={recentActivities}
          contacts={contacts}
          orgTz={activeOrgTz}
        />
      </div>
      <BackToTop scrollerRef={pageScrollerRef} threshold={400} />

      <AddContactModal
        open={addContactOpen}
        onClose={() => setAddContactOpen(false)}
        onAdd={handleAddContactSaved}
        contacts={contacts}
        orgId={Object.values(contacts || {})[0]?.org_id ?? 102}
      />
      <StartOpportunityFlow
        open={startOppOpen}
        contacts={contacts}
        appendContact={appendContact}
        appendOpportunity={appendOpportunity}
        appendVehicleToContact={appendVehicleToContact}
        appendHouseholdRelationship={appendHouseholdRelationship}
        seededContact={seededContact}
        onClose={() => {
          setStartOppOpen(false);
          setSeededContact(null);
        }}
        onCreated={handleStartOppCreated}
      />
    </div>
  );

  function Header() {
    // Wave 26a Phase 2 / Task 3F — funnel snapshot replaces the
    // "## open · ## due today" line. Counts are ALL-TIME (no lens),
    // per the brief. Each ## is a clickable count → inbox filtered by
    // stage. Reads from funnelCounts (all-time, ignores dateLens).
    //
    // PDF Task 1A vs 3F contradiction reminder: 1A said "default
    // sort by age ASC" (newest first), 3F said "default by age desc"
    // — Phase 1 stuck with ASC. This funnel line is from 3F and
    // bypasses the dateLens deliberately.
    const stagesInOrder = [
      { key: 'open', label: 'open' },
      { key: 'won', label: 'won' },
      { key: 'lost', label: 'lost' },
      { key: 'abandoned', label: 'abandoned' },
    ];
    return (
      <div className="mb-6">
        <div className="flex items-center gap-2 text-blue-600 mb-1">
          <Sun className="w-4 h-4" />
          <span className="text-xs uppercase tracking-wide font-semibold">
            Agent · Home
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {greeting()}, {AGENT_FIRST_NAME}
        </h1>
        <p className="text-sm text-slate-500 mt-1 flex flex-wrap items-center gap-x-1">
          {stagesInOrder.map((s, i) => (
            <span key={s.key} className="inline-flex items-center gap-1">
              <Tooltip content={`Filter inbox to ${s.label}`} placement="bottom-left">
                <button
                  type="button"
                  onClick={() => handleFunnelClick(s.key)}
                  className="font-semibold text-slate-700 hover:text-blue-600 hover:underline"
                >
                  {funnelCounts[s.key] ?? 0}
                </button>
              </Tooltip>
              <span>{s.label}</span>
              {i < stagesInOrder.length - 1 && <span className="text-slate-300">·</span>}
            </span>
          ))}
          <span className="ml-1">opportunities</span>
        </p>
      </div>
    );
  }
}

function QuickActions({ onAddContact, onStartOpportunity, dateLens, onDateLensChange }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <button
        onClick={onStartOpportunity}
        className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
      >
        <Zap className="w-4 h-4" />
        Start opportunity
      </button>
      <button
        onClick={onAddContact}
        className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-md bg-white ring-1 ring-slate-300 hover:bg-slate-50 text-slate-700"
      >
        <UserPlus className="w-4 h-4" />
        Add contact
      </button>
      {/* Date filter lens — applies to KPI counts, by-type, by-status,
          and the Conversions tile label. The funnel-header line (Task
          3F) deliberately ignores this (all-time agent snapshot). */}
      <div className="ml-auto">
        <DateLensSelect value={dateLens} onChange={onDateLensChange} />
      </div>
    </div>
  );
}

function RecentActivityCard({ recentActivities, contacts, orgTz }) {
  // useInfiniteScroll defaults to 25/page. The card itself is NOT the
  // scroller — the page is — so we omit scrollerRef and let the hook
  // observe against the document. As the sentinel scrolls into view we
  // bump the page count.
  const { visibleRows, sentinelRef, hasMore } = useInfiniteScroll(
    recentActivities,
    { pageSize: 25 },
  );

  return (
    <div className="bg-white rounded-lg ring-1 ring-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <ActivityIcon className="w-3.5 h-3.5 text-slate-400" />
        <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
          Recent activity
        </div>
        <div className="ml-auto text-[11px] text-slate-400">
          {visibleRows.length} of {recentActivities.length}
        </div>
      </div>
      <ul className="divide-y divide-slate-100">
        {visibleRows.map((a) => {
          const c = contacts[a.contact_id];
          const name = c
            ? c.name?.preferred ||
              `${c.name?.first ?? ''} ${c.name?.last ?? ''}`.trim()
            : a.contact_id;
          return (
            <li key={a.id} className="px-4 py-2.5 flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                <Users className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-slate-800 truncate">
                  <span className="font-medium">{name}</span>
                  <span className="text-slate-500"> · {a.summary_text}</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {relativeTime(a.occurred_at)} ·{' '}
                  <span className="text-slate-500">
                    {formatOrgTime(a.occurred_at, orgTz)}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
        {recentActivities.length === 0 && (
          <li className="px-4 py-6 text-sm text-slate-400 text-center">
            No recent activity.
          </li>
        )}
        {/* Infinite-scroll sentinel — the IntersectionObserver triggers
            another page-bump when this element scrolls into view. We
            render it ONLY when more pages remain so the document end
            doesn't keep firing. */}
        {hasMore && (
          <li
            ref={sentinelRef}
            className="px-4 py-3 text-center text-[11px] text-slate-400 italic"
          >
            Loading more…
          </li>
        )}
      </ul>
    </div>
  );
}
