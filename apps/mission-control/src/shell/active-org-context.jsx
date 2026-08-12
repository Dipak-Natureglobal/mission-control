import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { blinkerApi } from 'blinker-platform/api';
import { track } from 'blinker-platform/telemetry';
import orgRegistry from '../constants/canon/org-registry.json';

// Wave 28a — Manager-experience foundation.
//
// Source of truth for "which org am I currently looking at?". Manager
// shell screens (Home / Team / Inbox / Assignment) read this context to
// scope their data; Agent screens ignore it (their scoping is implicit
// via the assigned-contacts surface).
//
// ADR ref: architecture/19-manager-experience.md §6 (Multi-org scoping).
//
// Phase 1: a hard-coded MY_ID identifies the logged-in user against
// agents.json. Phase 2 swaps for a real auth identity.

// Hard-coded Phase-1 identity. Flip to 'mgr_morgan_diaz' to exercise the
// parent-partner multi-org rollup scenario (American Auto Alliance tree).
export const MY_ID = 'mgr_taylor_brooks';

const STORAGE_KEY = 'blinker.activeOrgId';

const ActiveOrgContext = createContext(null);

function readPersisted() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writePersisted(value) {
  if (typeof window === 'undefined') return;
  try {
    if (value == null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // ignore
  }
}

// Resolve the agent's accessible orgs as canon { id, name } pairs.
// Intersects agents.json[me].org_ids with canon org-registry so the
// labels match canon and unknown ids are silently dropped.
export function resolveAccessibleOrgs(agentId = MY_ID) {
  const agent = blinkerApi.agents.get(agentId);
  if (!agent || !Array.isArray(agent.org_ids)) return [];
  const byId = new Map((orgRegistry.orgs || []).map((o) => [o.id, o]));
  return agent.org_ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((o) => ({ id: o.id, name: o.name }));
}

export function ActiveOrgProvider({ children, agentId = MY_ID }) {
  const accessible = useMemo(() => resolveAccessibleOrgs(agentId), [agentId]);
  const accessibleIds = useMemo(() => accessible.map((o) => o.id), [accessible]);

  const [stored] = useState(readPersisted);
  // Default = first accessible org. 'all' sentinel = rollup mode.
  const initial = useMemo(() => {
    if (stored === 'all') return { orgId: null, allOrgs: true };
    if (stored != null) {
      const n = Number(stored);
      if (Number.isFinite(n) && accessibleIds.includes(n)) {
        return { orgId: n, allOrgs: false };
      }
    }
    return { orgId: accessibleIds[0] ?? null, allOrgs: false };
  }, [stored, accessibleIds]);

  const [state, setState] = useState(initial);

  // Persist whenever state changes.
  useEffect(() => {
    writePersisted(state.allOrgs ? 'all' : state.orgId);
  }, [state.allOrgs, state.orgId]);

  const setActiveOrg = useCallback(
    (next) => {
      setState((prev) => {
        // next: number (org id) | 'all' (rollup) | null (reset to first)
        const isAll = next === 'all';
        const orgId = isAll ? null : next == null ? accessibleIds[0] ?? null : Number(next);
        const nextState = { orgId, allOrgs: isAll };
        const fromOrgId = prev.allOrgs ? null : prev.orgId;
        track('mission_control.org_switched', {
          from_org_id: fromOrgId,
          to_org_id: orgId,
          all_orgs: isAll,
        });
        return nextState;
      });
    },
    [accessibleIds],
  );

  const orgName = useMemo(() => {
    if (state.allOrgs) return 'All my orgs';
    return accessible.find((o) => o.id === state.orgId)?.name ?? null;
  }, [state, accessible]);

  const value = useMemo(
    () => ({
      orgId: state.orgId,
      orgName,
      allOrgs: state.allOrgs,
      accessibleOrgs: accessible,
      accessibleOrgIds: accessibleIds,
      setActiveOrg,
    }),
    [state, orgName, accessible, accessibleIds, setActiveOrg],
  );

  return <ActiveOrgContext.Provider value={value}>{children}</ActiveOrgContext.Provider>;
}

export function useActiveOrg() {
  const ctx = useContext(ActiveOrgContext);
  if (!ctx) {
    // Defensive default for tests / unmounted previews. Matches the
    // "no orgs accessible" shape.
    return {
      orgId: null,
      orgName: null,
      allOrgs: false,
      accessibleOrgs: [],
      accessibleOrgIds: [],
      setActiveOrg: () => {},
    };
  }
  return ctx;
}
