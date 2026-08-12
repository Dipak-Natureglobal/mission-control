import { useEffect, useMemo, useRef, useState } from 'react';
import { scoreAgents, scoreAgentsForOpps } from 'blinker-platform/utils';
import { track } from 'blinker-platform/telemetry';
import orgRegistry from '../../constants/canon/org-registry.json';
import { usePopoverPlacement } from '../../shared/usePopoverPlacement.js';

// Wave 29a — shared agent picker.
//
// Replaces the per-surface scored dropdowns that BulkReassignBar (W28d),
// AssignmentDropdown (W28e) and CoPilotPane's ManagerReassignControl
// (W28d) each rendered themselves. Centralises three concerns:
//
//   1. Suggestion scoring (delegates to scoreAgents / scoreAgentsForOpps).
//   2. Per-org grouping with cross-org policy gating (ADR 19 §6).
//   3. Telemetry surface tagging (picker_opened / suggestion_shown / assigned).
//
// Props:
//   selectedOpps:     Opportunity[]    — 1+ records; drives tag-match scoring
//                                        and source-org resolution.
//   eligibleAgents:   Agent[]          — the FULL pool the caller is willing
//                                        to surface (already intersected with
//                                        the manager's accessible orgs).
//   sourceOrgPolicy:  { enabled, contact_mode, opportunity_mode,
//                       mark_contact_readonly_on_copy,
//                       mark_opportunity_readonly_on_copy }
//   contacts:         optional contact map; lets the picker resolve the
//                     source-org for bulk-multi-source reduction without
//                     reading session in here.
//   onAssign(agentId, info): info = { wasSuggested, isCrossOrg,
//                                     sourceOrgId, destOrgId, mode }.
//                                     mode = 'copy' | 'move' | 'same-org'.
//   onCancel():       optional close hook (Esc / outside-click default).
//   placement:        'inline' | 'bulk-bar' — drives styling.
//   surface:          telemetry source label.
//   triggerLabel:     button text when placement='inline' (default 'Assign').
//
// Keyboard: ↓/↑ navigate rows (across group boundaries), Enter selects, Esc
// closes. Headers are skipped during keyboard nav.

function orgNameOf(orgId) {
  const orgs = orgRegistry.orgs || [];
  return orgs.find((o) => o.id === orgId)?.name || `Org ${orgId}`;
}

// Enumerate every unique source-org id across the bulk selection. Each
// distinct contact.org_id surfaces as its own `· source` group in the
// picker — so a multi-source bulk (e.g. 5 Apex opps + 4 Kings DR opps)
// renders TWO source headers, not one anchor.
function _sourceOrgIds(selectedOpps, contacts) {
  if (!Array.isArray(selectedOpps) || selectedOpps.length === 0) return [];
  const set = new Set();
  for (const opp of selectedOpps) {
    const c = contacts?.[opp?.contact_id];
    const orgId = c?.org_id;
    if (typeof orgId === 'number') set.add(orgId);
  }
  return Array.from(set);
}

function _scoreEnvelope(selectedOpps, eligibleAgents) {
  if (!Array.isArray(eligibleAgents) || eligibleAgents.length === 0) return [];
  if (!Array.isArray(selectedOpps) || selectedOpps.length === 0) {
    return scoreAgents({ agents: eligibleAgents, opp: null });
  }
  if (selectedOpps.length === 1) {
    return scoreAgents({ agents: eligibleAgents, opp: selectedOpps[0] });
  }
  return scoreAgentsForOpps({ agents: eligibleAgents, opps: selectedOpps });
}

export function AgentPicker({
  selectedOpps,
  eligibleAgents,
  sourceOrgPolicy,
  contacts,
  onAssign,
  onCancel,
  placement = 'inline',
  surface = 'agent_picker',
  triggerLabel = 'Assign',
  open: openProp,
  defaultOpen = false,
  showTrigger = true,
}) {
  const isControlled = typeof openProp === 'boolean';
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = isControlled ? openProp : internalOpen;
  const containerRef = useRef(null);
  const shownRef = useRef(false);
  const openedRef = useRef(false);
  const [hoverIdx, setHoverIdx] = useState(0);

  // Viewport-anchored placement for `placement='inline'`. The CoPilot
  // left rail has overflow-hidden + ~320px width, so the prior
  // `position: absolute` dropdown got clipped. Hook re-measures on
  // open / resize / scroll and clamps so the panel always stays in
  // viewport. Bulk-bar keeps its bottom-anchored overlay.
  const popover = usePopoverPlacement({
    open: open && placement === 'inline',
    placement: 'bottom-end',
    preferredWidth: 320,
    maxHeightVh: 70,
  });

  const sourceOrgIds = useMemo(
    () => _sourceOrgIds(selectedOpps, contacts),
    [selectedOpps, contacts],
  );
  const sourceOrgIdSet = useMemo(() => new Set(sourceOrgIds), [sourceOrgIds]);
  // Anchor for telemetry continuity (W29a) — first source in selection
  // order is "the" sourceOrgId on emitted events. Multi-source picker
  // rendering no longer depends on this value.
  const sourceOrgId = sourceOrgIds[0] ?? null;

  const crossOrgEnabled = !!sourceOrgPolicy?.enabled;

  // Filter the pool to same-org-only when policy disables cross-org.
  // Same-org = the agent's org_ids must intersect AT LEAST ONE source org.
  const visibleAgents = useMemo(() => {
    if (!Array.isArray(eligibleAgents)) return [];
    if (crossOrgEnabled || sourceOrgIds.length === 0) return eligibleAgents;
    return eligibleAgents.filter(
      (a) =>
        Array.isArray(a.org_ids) && a.org_ids.some((id) => sourceOrgIdSet.has(id)),
    );
  }, [eligibleAgents, crossOrgEnabled, sourceOrgIds, sourceOrgIdSet]);

  const scored = useMemo(
    () => _scoreEnvelope(selectedOpps, visibleAgents),
    [selectedOpps, visibleAgents],
  );

  // Enumerate EVERY unique source org as its own `· source` group, then
  // render remaining accessible orgs (orgs represented in the eligible
  // pool) as `· destination` groups when cross-org policy is enabled.
  // Agents who carry multiple orgs surface in each matching group via the
  // `agent.org_ids.includes(orgId)` filter — this is intentional (a
  // multi-org agent CAN take the opp from either source perspective).
  const groupedRows = useMemo(() => {
    if (scored.length === 0) return [];
    // Orgs represented in the scored pool.
    const orgIdsInPool = new Set();
    for (const row of scored) {
      const ids = Array.isArray(row.agent.org_ids) ? row.agent.org_ids : [];
      for (const id of ids) orgIdsInPool.add(id);
    }
    // Source groups: every source org id, in alphabetical name order.
    const sourceGroupIds = Array.from(sourceOrgIdSet).sort((a, b) =>
      orgNameOf(a).localeCompare(orgNameOf(b)),
    );
    // Destination groups: orgs in the pool that aren't sources, only when
    // cross-org policy is enabled.
    const destGroupIds = crossOrgEnabled
      ? Array.from(orgIdsInPool)
          .filter((id) => !sourceOrgIdSet.has(id))
          .sort((a, b) => orgNameOf(a).localeCompare(orgNameOf(b)))
      : [];

    function rowsForOrg(orgId) {
      const rows = scored.filter(
        (r) => Array.isArray(r.agent.org_ids) && r.agent.org_ids.includes(orgId),
      );
      const ranked = rows.slice().sort((x, y) => y.score - x.score);
      const localTop3 = new Set(ranked.slice(0, 3).map((r) => r.agent.id));
      const withSuggested = ranked.map((r) => ({
        ...r,
        suggested: localTop3.has(r.agent.id),
      }));
      const suggestedRows = withSuggested
        .filter((r) => r.suggested)
        .sort((x, y) => y.score - x.score);
      const restRows = withSuggested
        .filter((r) => !r.suggested)
        .sort((a, b) => (a.agent.name || '').localeCompare(b.agent.name || ''));
      return [...suggestedRows, ...restRows];
    }

    const ordered = [];
    function pushGroup(orgId, role) {
      const rows = rowsForOrg(orgId);
      if (rows.length === 0) return;
      ordered.push({
        kind: 'header',
        orgId,
        orgName: orgNameOf(orgId),
        count: rows.length,
        role, // 'source' | 'destination'
      });
      for (const r of rows) {
        ordered.push({
          kind: 'row',
          orgId,
          isCrossOrg: role === 'destination',
          ...r,
        });
      }
    }
    for (const id of sourceGroupIds) pushGroup(id, 'source');
    for (const id of destGroupIds) pushGroup(id, 'destination');
    return ordered;
  }, [scored, sourceOrgIdSet, crossOrgEnabled]);

  // Flat list of selectable rows (skip headers for keyboard nav).
  const navRows = useMemo(
    () => groupedRows.filter((r) => r.kind === 'row'),
    [groupedRows],
  );

  // Emit picker_opened + suggestion_shown once when the dropdown first opens.
  useEffect(() => {
    if (!open || openedRef.current) return undefined;
    openedRef.current = true;
    const accessibleOrgCount = new Set(
      (eligibleAgents || []).flatMap((a) =>
        Array.isArray(a.org_ids) ? a.org_ids : [],
      ),
    ).size;
    track('mission_control.assignment.picker_opened', {
      surface,
      source_org_id: sourceOrgId,
      accessible_org_count: accessibleOrgCount,
      eligible_agent_count: visibleAgents.length,
      cross_org_enabled: crossOrgEnabled,
    });
    if (!shownRef.current && navRows.length > 0) {
      shownRef.current = true;
      const top = navRows.slice(0, 3);
      track('mission_control.assignment.suggestion_shown', {
        surface,
        opp_ids: (selectedOpps || []).map((o) => o.id),
        top_agent_ids: top.map((r) => r.agent.id),
        top_scores: top.map((r) => Number(r.score.toFixed(4))),
      });
    }
    return undefined;
  }, [
    open,
    surface,
    sourceOrgId,
    eligibleAgents,
    visibleAgents.length,
    crossOrgEnabled,
    navRows,
    selectedOpps,
  ]);

  // Outside-click close. With the inline variant now rendering the
  // panel as `position: fixed` (escaping the rail's overflow-hidden),
  // the panel is no longer a DOM child of `containerRef`. Check both
  // the trigger container AND the floating panel.
  useEffect(() => {
    if (!open) return undefined;
    function handle(e) {
      const inTrigger = containerRef.current && containerRef.current.contains(e.target);
      const inPanel = popover.panelRef.current && popover.panelRef.current.contains(e.target);
      if (inTrigger || inPanel) return;
      if (isControlled) {
        if (onCancel) onCancel();
      } else {
        setInternalOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open, isControlled, onCancel, popover.panelRef]);

  function setOpen(next) {
    if (isControlled) {
      if (!next && onCancel) onCancel();
    } else {
      setInternalOpen(next);
    }
  }

  function pick(row) {
    if (!row || !onAssign) return;
    const mode = row.isCrossOrg
      ? (sourceOrgPolicy?.opportunity_mode || 'copy')
      : 'same-org';
    onAssign(row.agent.id, {
      wasSuggested: !!row.suggested,
      isCrossOrg: !!row.isCrossOrg,
      sourceOrgId,
      destOrgId: row.orgId,
      mode,
    });
    track('mission_control.assignment.assigned', {
      surface,
      opp_ids: (selectedOpps || []).map((o) => o.id),
      agent_id: row.agent.id,
      was_suggested: !!row.suggested,
      is_cross_org: !!row.isCrossOrg,
      source_org_id: sourceOrgId,
      dest_org_id: row.orgId,
      mode,
      source: surface,
    });
    if (!isControlled) setInternalOpen(false);
  }

  function handleKey(e) {
    if (!open) return;
    if (e.key === 'Escape') {
      setOpen(false);
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowDown') {
      setHoverIdx((i) => Math.min(navRows.length - 1, i + 1));
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowUp') {
      setHoverIdx((i) => Math.max(0, i - 1));
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      const row = navRows[hoverIdx];
      if (row) pick(row);
      e.preventDefault();
    }
  }

  const dropdownContent = (
    <div
      role="listbox"
      className={
        placement === 'bulk-bar'
          ? 'bg-white border border-slate-200 rounded-md shadow-lg overflow-auto min-w-[300px] max-h-80'
          : 'h-full'
      }
    >
      {navRows.length === 0 && (
        <div className="px-3 py-2 text-xs text-slate-400 italic">
          No eligible agents in the active scope
        </div>
      )}
      {groupedRows.map((item, i) => {
        if (item.kind === 'header') {
          return (
            <div
              key={`hdr_${item.orgId}`}
              className="px-2.5 py-1.5 bg-slate-50 border-b border-t border-slate-100 first:border-t-0 flex items-center justify-between"
            >
              <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">
                {item.orgName}
                {item.role === 'source' && (
                  <span className="ml-1.5 text-[9px] font-medium text-slate-400 normal-case tracking-normal">
                    · source
                  </span>
                )}
                {item.role === 'destination' && (
                  <span className="ml-1.5 text-[9px] font-medium text-amber-600 normal-case tracking-normal">
                    · destination
                  </span>
                )}
              </span>
              <span className="text-[10px] text-slate-400">
                {item.count} agent{item.count === 1 ? '' : 's'}
              </span>
            </div>
          );
        }
        // Compute the keyboard-index for this row by re-scanning navRows.
        // Cheap (small lists) and avoids carrying a parallel index.
        const navIdx = navRows.findIndex((n) => n.agent.id === item.agent.id);
        const hovered = navIdx === hoverIdx;
        return (
          <AgentRow
            key={`row_${item.agent.id}_${item.orgId}`}
            row={item}
            hovered={hovered}
            onPick={() => pick(item)}
            onHover={() => setHoverIdx(navIdx)}
          />
        );
      })}
      {!crossOrgEnabled && sourceOrgId != null && (
        <div className="px-2.5 py-1.5 border-t border-slate-100 text-[10px] italic text-slate-400">
          Cross-org assignment disabled for this org.
        </div>
      )}
    </div>
  );

  if (placement === 'bulk-bar') {
    // Bulk-bar variant: the bar's trigger lives in the parent; we render
    // the floating overlay only. Open state is controlled by the caller.
    return (
      <div ref={containerRef} onKeyDown={handleKey} tabIndex={-1}>
        {open && (
          <div className="absolute z-50 bottom-full mb-1 right-0">
            {dropdownContent}
          </div>
        )}
      </div>
    );
  }

  // Inline variant: trigger lives inline, panel renders fixed to the
  // viewport so it escapes any `overflow-hidden` ancestor (e.g. the
  // CoPilot left rail). Panel position recomputes on resize / scroll
  // via usePopoverPlacement.
  return (
    <div
      ref={containerRef}
      className="relative inline-block"
      onKeyDown={handleKey}
    >
      {showTrigger && (
        <button
          ref={popover.triggerRef}
          type="button"
          onClick={() => setOpen(!open)}
          className="text-xs px-2 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 inline-flex items-center gap-1 max-w-[160px]"
        >
          <span className="truncate">{triggerLabel}</span>
          <span className="text-slate-400 shrink-0">{open ? '▲' : '▼'}</span>
        </button>
      )}
      {!showTrigger && (
        // Hidden anchor — call sites that pass showTrigger=false still
        // need a measurable reference point. Container itself supplies it.
        <span ref={popover.triggerRef} className="absolute inset-0 pointer-events-none" aria-hidden="true" />
      )}
      {open && (
        <div
          ref={popover.panelRef}
          style={popover.style}
          className={
            'z-50 transition-opacity duration-75 overflow-auto rounded-md bg-white border border-slate-200 shadow-lg ' +
            (popover.ready ? 'opacity-100' : 'opacity-0')
          }
        >
          {dropdownContent}
        </div>
      )}
    </div>
  );
}

function initials(name) {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

function AgentRow({ row, hovered, onPick, onHover }) {
  const { agent, breakdown, suggested, isCrossOrg, orgId } = row;
  return (
    <button
      type="button"
      role="option"
      aria-selected={hovered}
      onClick={onPick}
      onMouseEnter={onHover}
      className={
        'w-full px-2.5 py-1.5 text-left text-xs flex items-center gap-2 ' +
        (hovered ? 'bg-slate-100 ' : 'hover:bg-slate-50 ') +
        (isCrossOrg ? 'bg-amber-50/30 ' : '')
      }
    >
      <span className="inline-flex w-5 h-5 rounded-full bg-slate-100 text-slate-600 items-center justify-center text-[9px] font-semibold shrink-0">
        {initials(agent.name)}
      </span>
      <span className="text-slate-800 truncate flex-1">{agent.name}</span>
      <span className="flex items-center gap-1 shrink-0">
        {isCrossOrg && (
          <span className="px-1.5 py-0.5 rounded text-[9.5px] font-medium bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200">
            → {orgNameOf(orgId)}
          </span>
        )}
        {suggested && (
          <span className="px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[9.5px] font-semibold ring-1 ring-inset ring-blue-200">
            Suggested
          </span>
        )}
        <span className="text-slate-400 text-[10px]">
          {breakdown?.open_count ?? 0} open
        </span>
      </span>
    </button>
  );
}

// Helper consumed by callers (BulkReassignBar / Assignment / ManagerInbox)
// to reduce per-opp policies down to a single envelope. Strictest wins:
//   enabled = AND
//   contact_mode = 'move' if any source has 'move' else 'copy'
//   opportunity_mode = 'move' if any source has 'move' else 'copy'
//   readonly flags = OR
//
// Single-source selections collapse to that org's raw policy.
export function reduceSourceOrgPolicy(selectedOpps, contacts) {
  if (!Array.isArray(selectedOpps) || selectedOpps.length === 0) {
    return {
      enabled: false,
      contact_mode: 'copy',
      opportunity_mode: 'copy',
      mark_contact_readonly_on_copy: true,
      mark_opportunity_readonly_on_copy: true,
    };
  }
  const sourceOrgIds = new Set();
  for (const opp of selectedOpps) {
    const c = contacts?.[opp?.contact_id];
    if (c && typeof c.org_id === 'number') sourceOrgIds.add(c.org_id);
  }
  const orgs = orgRegistry.orgs || [];
  const policies = Array.from(sourceOrgIds)
    .map((id) => orgs.find((o) => o.id === id)?.cross_org_assignment)
    .filter(Boolean);
  if (policies.length === 0) {
    return {
      enabled: false,
      contact_mode: 'copy',
      opportunity_mode: 'copy',
      mark_contact_readonly_on_copy: true,
      mark_opportunity_readonly_on_copy: true,
    };
  }
  if (policies.length === 1) return policies[0];
  return {
    enabled: policies.every((p) => p.enabled === true),
    contact_mode: policies.some((p) => p.contact_mode === 'move')
      ? 'move'
      : 'copy',
    opportunity_mode: policies.some((p) => p.opportunity_mode === 'move')
      ? 'move'
      : 'copy',
    mark_contact_readonly_on_copy: policies.some(
      (p) => p.mark_contact_readonly_on_copy === true,
    ),
    mark_opportunity_readonly_on_copy: policies.some(
      (p) => p.mark_opportunity_readonly_on_copy === true,
    ),
  };
}

export default AgentPicker;
