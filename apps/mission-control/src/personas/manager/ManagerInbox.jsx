import { useEffect, useMemo, useState } from 'react';
import { Inbox } from 'lucide-react';
import { AgentInbox } from '../agent/AgentInbox.jsx';
import { blinkerApi } from 'blinker-platform/api';
import { track } from 'blinker-platform/telemetry';
import { useActiveOrg, MY_ID } from '../../shell/active-org-context.jsx';
import { BulkReassignBar } from './BulkReassignBar.jsx';
import { reduceSourceOrgPolicy } from './AgentPicker.jsx';
import personasCanon from '../../constants/canon/personas.json';
import systemTagsCanon from '../../constants/canon/system-tags.json';
import { useSessionData } from '../../lib/session-data.js';

// Wave 28d — Manager Inbox.
//
// Replaces the 28a thin wrapper. Reuses AgentInbox in full with five
// optional props that switch the manager-overlay behavior on:
//
//   groupByAgent={true}                — collapsible group-by-owner rows
//   bulkActions={[{ id, label, onClick(ids) }]}
//                                       — checkbox column + bottom bulk bar
//   extraFilters={[...]}               — appended to AdvancedFilter spec
//   personaOverlay={{ onReassign, onNoteForAgent }}
//                                       — threaded into CoPilotPane → rail
//
// The manager-only "API failure" derived filter is gated by the current
// manager's preset carrying `view_api_responses`. Today only the
// `manager_lead` preset includes that badge (see canon/personas.json).
//
// Stuck filter pre-toggle: when ManagerHome's stale-KPI click routes here
// with `inboxFilter.derived === 'stuck'`, we seed `advValues.stuck=true`.
// AgentInbox forwards advValues into AdvancedFilter's `values` prop, which
// (post-Wave-28d) honors derived-filter defaults via that same path.

const STALE_MS = 7 * 24 * 60 * 60 * 1000;

function presetHasBadge(presetId, badge) {
  const personas = personasCanon.personas || {};
  for (const persona of Object.values(personas)) {
    const preset = (persona.presets || []).find((p) => p.id === presetId);
    if (preset) return (preset.badges || []).includes(badge);
  }
  return false;
}

function resolveTagOptions(orgId) {
  const system = (systemTagsCanon.system_tags || []).map((t) => ({
    value: t.id,
    label: t.name,
  }));
  const byOrg = orgId
    ? ((systemTagsCanon.by_org || {})[String(orgId)] || []).map((t) => ({
        value: t.id,
        label: t.name,
      }))
    : [];
  // Dedup by value, system wins.
  const seen = new Set();
  const all = [];
  for (const t of [...system, ...byOrg]) {
    if (seen.has(t.value)) continue;
    seen.add(t.value);
    all.push(t);
  }
  return all;
}

export function ManagerInbox({ persona, session, testMode = false }) {
  const { orgId, allOrgs, orgName, accessibleOrgIds } = useActiveOrg();
  // Wave 31b-fu3 — opt out of writer registration; App.jsx is the host.
  const localSession = useSessionData({ registerAsHost: false });
  const sess = session || localSession;
  const filter = allOrgs || orgId == null ? {} : { org_id: orgId };
  const agents = blinkerApi.agents.list(filter).filter((a) => a.persona === 'agent');
  const scopeLabel = allOrgs ? 'All my orgs' : orgName;

  const me = useMemo(() => blinkerApi.agents.get(MY_ID), []);
  const myPresetId = me?.preset_id || 'manager_standard';
  const canViewApiFailures = presetHasBadge(myPresetId, 'view_api_responses');

  // Bulk-action state. The Reassign action opens a sticky BulkReassignBar
  // overlay with a scored picker; Add tag opens a small inline tag picker;
  // Mark stuck is a one-click bulk apply.
  const [pendingReassign, setPendingReassign] = useState(null); // { oppIds }
  const [pendingTag, setPendingTag] = useState(null);            // { oppIds }
  const [seedInboxFilter, setSeedInboxFilter] = useState(null);  // forwarded

  // Wave 28d — accept the `filter=stuck` deep-link from ManagerHome's
  // stale-KPI click. Today ManagerHome calls onNavigate('inbox') with no
  // accompanying state; the contract is that the Stuck derived filter
  // defaults on via the schema spec below (defaultOn=false; ManagerHome
  // can flip it on once it threads the filter payload through). The hook
  // below is intentionally non-no-op so a future ManagerHome wire-up
  // doesn't need a second pass here.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('filter') === 'stuck') {
      setSeedInboxFilter({ derivedStuck: true });
    }
  }, []);

  // Build the extraFilters spec. Owner=Unassigned is an enum `allowNull`;
  // Stuck is a `derived` predicate over the opp.updated_at age; API
  // failure is gated by the manager's preset.
  const extraFilters = useMemo(() => {
    const out = [
      {
        key: 'owner_null',
        label: 'Show only unassigned',
        field: 'opportunity.owner',
        type: 'enum',
        allowNull: true,
        nullLabel: 'Unassigned',
        // No real-value options — this filter exists purely for the
        // Unassigned tickbox. Owner-enum stays separate so managers can
        // mix "Unassigned" with specific owners by combining filters.
        enumValues: [],
        level: 'opportunity',
      },
      {
        key: 'stuck',
        label: 'Stuck (no movement > 7 days)',
        description: 'Opportunities whose updated_at is older than the org SLA (7d default).',
        type: 'derived',
        computer: (row) => {
          const t = Date.parse(row.updated_at || '');
          if (!Number.isFinite(t)) return false;
          return Date.now() - t > STALE_MS;
        },
      },
    ];
    if (canViewApiFailures) {
      out.push({
        key: 'api_failure',
        label: 'Has API failure',
        description: 'Last integration response logged a failure (preset-gated).',
        type: 'derived',
        // Phase 1 stub — fixture rows don't carry an api_failure marker yet.
        // The Phase 2 lift wires this to the API-response log per ADR §5.3.
        computer: (row) => row._api_failure === true,
      });
    }
    return out;
  }, [canViewApiFailures]);

  // Persona overlay handlers. These are the only paths through which the
  // CoPilotPane left-rail manager items mutate state. They emit telemetry
  // per ADR §7 and route through the existing session-data /
  // blinkerApi.agents primitives.
  const managerOverlay = useMemo(
    () => ({
      // info = { wasSuggested, isCrossOrg, sourceOrgId, destOrgId, mode }
      // (optional for legacy callers that only pass agentId).
      onReassign: (oppId, agentId, info) => {
        const agent = blinkerApi.agents.get(agentId);
        if (sess?.updateOpportunity) {
          sess.updateOpportunity(oppId, {
            owner: agent?.name || null,
            owner_id: agentId,
          });
        }
        // Cross-org route runs the cascade helper per source policy.
        if (info && info.isCrossOrg && agent) {
          const opp = (sess?.opportunities || []).find((o) => o.id === oppId);
          if (opp) {
            const contactsMap = sess?.contacts || {};
            const policy = reduceSourceOrgPolicy([opp], contactsMap);
            const helper = info.mode === 'move'
              ? blinkerApi.contacts.crossOrgMove
              : blinkerApi.contacts.crossOrgCopy;
            const destOrgId = info.destOrgId
              ?? (Array.isArray(agent.org_ids) ? agent.org_ids[0] : null);
            if (destOrgId != null) {
              helper(opp.contact_id, info.sourceOrgId, destOrgId, {
                session: sess,
                policy,
              });
            }
          }
        }
      },
      onNoteForAgent: (oppId, agentId, body) => {
        try {
          blinkerApi.agents.addCoachingNote(agentId, body, { author_id: MY_ID });
          track('mission_control.coaching_note.added', {
            agent_id: agentId,
            opp_id: oppId,
            source: 'copilot_rail',
            body_length: body.length,
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[manager] addCoachingNote failed:', err);
        }
      },
    }),
    [sess],
  );

  function handleBulkReassign(selectedIds) {
    track('mission_control.assignment.bulk_started', {
      opp_ids: selectedIds,
      source: 'manager_inbox',
    });
    setPendingReassign({ oppIds: selectedIds });
  }

  function handleBulkAddTag(selectedIds) {
    track('mission_control.tagging.bulk_started', {
      opp_ids: selectedIds,
      source: 'manager_inbox',
    });
    setPendingTag({ oppIds: selectedIds });
  }

  function handleBulkMarkStuck(selectedIds) {
    track('mission_control.tagging.bulk_applied', {
      opp_ids: selectedIds,
      tag_id: 'stuck',
      source: 'manager_inbox',
    });
    // Phase 1: telemetry-only — opportunity.tags isn't part of the canon
    // shape; tags belong to contacts (per canon/blinker-domain.json). The
    // Phase 2 lift adds an opportunity-level "stuck" marker the manager
    // can review on the queue. For now the event captures intent.
  }

  // Resolve eligible agents for the bulk reassignment picker. Restricted to
  // the manager's accessible orgs (caller responsibility per BulkReassignBar
  // contract). Single-org mode previously filtered to just `orgId`, which is
  // wrong now that cross-org assignment is policy-gated — the AgentPicker
  // needs the FULL accessible-org union pool so it can present cross-org
  // destinations when policy allows. Same eligible-pool resolution as
  // Assignment.jsx; AgentPicker filters down based on sourceOrgPolicy.
  const eligibleAgentsForBulk = useMemo(() => {
    const pool = blinkerApi.agents.list().filter((a) => a.persona === 'agent');
    if (!Array.isArray(accessibleOrgIds) || accessibleOrgIds.length === 0) {
      return pool;
    }
    const set = new Set(accessibleOrgIds);
    return pool.filter(
      (a) => Array.isArray(a.org_ids) && a.org_ids.some((id) => set.has(id)),
    );
  }, [accessibleOrgIds]);

  // Resolve the actual opportunity records for the picker — multi-opp
  // scoring averages tag-match across these.
  const selectedOpps = useMemo(() => {
    if (!pendingReassign) return [];
    const set = new Set(pendingReassign.oppIds);
    return (sess?.opportunities || []).filter((o) => set.has(o.id));
  }, [pendingReassign, sess]);

  const bulkSourceOrgPolicy = useMemo(
    () => reduceSourceOrgPolicy(selectedOpps, sess?.contacts || {}),
    [selectedOpps, sess?.contacts],
  );

  function confirmBulkAssign(agentId, info) {
    const agent = blinkerApi.agents.get(agentId);
    const ids = pendingReassign?.oppIds || [];
    const destOrgIds = Array.isArray(agent?.org_ids) ? agent.org_ids : [];
    const contactsMap = sess?.contacts || {};
    const cascadeIds = [];
    for (const oppId of ids) {
      const opp = (sess?.opportunities || []).find((o) => o.id === oppId);
      if (!opp) continue;
      const sourceOrgId = contactsMap[opp.contact_id]?.org_id;
      const isCrossOrg =
        typeof sourceOrgId === 'number' && !destOrgIds.includes(sourceOrgId);
      if (sess?.updateOpportunity) {
        sess.updateOpportunity(oppId, {
          owner: agent?.name || null,
          owner_id: agentId,
        });
      }
      if (isCrossOrg && agent) {
        const policy = reduceSourceOrgPolicy([opp], contactsMap);
        const helper = info.mode === 'move'
          ? blinkerApi.contacts.crossOrgMove
          : blinkerApi.contacts.crossOrgCopy;
        helper(opp.contact_id, sourceOrgId, destOrgIds[0], {
          session: sess,
          policy,
        });
        cascadeIds.push(oppId);
      }
    }
    track('mission_control.assignment.assigned', {
      opp_ids: ids,
      agent_id: agentId,
      was_suggested: !!info.wasSuggested,
      is_cross_org: cascadeIds.length > 0,
      mode: info.mode,
      cross_org_count: cascadeIds.length,
      source: 'manager_inbox',
    });
    setPendingReassign(null);
  }

  const tagOptions = useMemo(() => resolveTagOptions(orgId), [orgId]);
  function confirmBulkTag(tagId) {
    const ids = pendingTag?.oppIds || [];
    track('mission_control.tagging.bulk_applied', {
      opp_ids: ids,
      tag_id: tagId,
      source: 'manager_inbox',
    });
    setPendingTag(null);
  }

  // Stuck deep-link seed — pre-populate advValues with { stuck: true } so
  // the schema's derived filter is on at first open. Wired through
  // AgentInbox's existing `inboxFilter` channel for the type/status case
  // is separate from this; we add a parallel "seed values" path.
  const initialFilterValues = useMemo(() => {
    if (seedInboxFilter?.derivedStuck) return { stuck: true };
    return undefined;
  }, [seedInboxFilter]);

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      <div className="px-6 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-2 text-xs text-slate-600">
        <Inbox className="w-3.5 h-3.5 text-slate-400" />
        <span>
          Team Inbox · <span className="font-semibold text-slate-800">{agents.length}</span> agents
          {scopeLabel ? <> in <span className="font-semibold text-slate-800">{scopeLabel}</span></> : null}
        </span>
        {seedInboxFilter?.derivedStuck && (
          <span className="ml-2 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-medium ring-1 ring-inset ring-amber-200">
            Stuck filter seeded (from Home)
          </span>
        )}
      </div>
      <div className="flex-1 min-h-0">
        <AgentInbox
          persona={persona}
          session={sess}
          testMode={testMode}
          groupByAgent={true}
          groupByOrg={allOrgs || (Array.isArray(accessibleOrgIds) && accessibleOrgIds.length > 1)}
          bulkActions={[
            { id: 'reassign', label: 'Reassign', onClick: handleBulkReassign },
            { id: 'add_tag', label: 'Add tag', onClick: handleBulkAddTag },
            { id: 'stuck', label: 'Mark stuck', onClick: handleBulkMarkStuck },
          ]}
          extraFilters={extraFilters}
          personaOverlay={managerOverlay}
          initialAdvValues={initialFilterValues}
        />
      </div>

      {pendingReassign && (
        <BulkReassignBar
          selectedOppIds={pendingReassign.oppIds}
          selectedOpps={selectedOpps}
          eligibleAgents={eligibleAgentsForBulk}
          sourceOrgPolicy={bulkSourceOrgPolicy}
          contacts={sess?.contacts || {}}
          onAssign={confirmBulkAssign}
          onDismiss={() => setPendingReassign(null)}
          surface="manager_inbox"
        />
      )}

      {pendingTag && (
        <BulkTagPickerOverlay
          oppIds={pendingTag.oppIds}
          tagOptions={tagOptions}
          onPick={confirmBulkTag}
          onDismiss={() => setPendingTag(null)}
        />
      )}
    </div>
  );
}

// Tiny inline picker. Re-uses the system-tags canon as the option set;
// the Phase 2 lift swaps to `blinkerApi.tags.list({ org_id })`.
function BulkTagPickerOverlay({ oppIds, tagOptions, onPick, onDismiss }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white shadow-[0_-8px_24px_-12px_rgba(15,23,42,0.18)]">
      <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
        <span className="text-xs text-slate-600">
          Apply tag to{' '}
          <span className="font-semibold text-slate-900">{oppIds.length}</span>{' '}
          opportunit{oppIds.length === 1 ? 'y' : 'ies'}:
        </span>
        <select
          onChange={(e) => {
            if (e.target.value) onPick(e.target.value);
          }}
          className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 flex-1 max-w-xs"
          defaultValue=""
        >
          <option value="" disabled>
            Pick a tag…
          </option>
          {tagOptions.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onDismiss}
          className="ml-auto text-xs text-slate-500 hover:text-slate-800 px-2 py-1"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
