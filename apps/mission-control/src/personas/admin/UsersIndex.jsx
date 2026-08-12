// UsersIndex — admin-console users table for one org. Replaces the legacy
// 60-checkbox per-user form (BlinkerLegacy/MissionControl/.../badges.ts) with
// a row → drawer pattern. Per architecture/10-admin-console.md.
//
// Source: src/fixtures/users.json (Phase 1). Phase 2 swap: API fetch with
// the same shape.
//
// Filtering: rows scoped to the OrgDetail context (org.id). Super-admin
// using SuperHome's User directory tile renders the same component with
// a `superMode` flag that drops the org filter (see SuperHome wiring in
// commit 6).
//
// Click row → opens UserEdit drawer. Drawer is local state — no router.

import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ShieldCheck,
  Search,
  XCircle,
} from 'lucide-react';
import usersFixture from '../../fixtures/users.json';
import { effectiveBadges } from '../../lib/permissions.js';
import { UserEdit } from './UserEdit.jsx';
import { track } from 'blinker-platform/telemetry';

export function UsersIndex({ org, persona = 'admin', superMode = false }) {
  const [editing, setEditing] = useState(null); // user object or null
  const [filter, setFilter] = useState('');

  const allUsers = usersFixture.users || [];
  const visibleUsers = useMemo(() => {
    let rows = allUsers;
    if (!superMode && org?.id != null) {
      rows = rows.filter((u) => u.org_id === org.id);
    }
    if (filter.trim()) {
      const q = filter.trim().toLowerCase();
      rows = rows.filter(
        (u) =>
          u.first_name?.toLowerCase().includes(q) ||
          u.last_name?.toLowerCase().includes(q) ||
          u.email?.toLowerCase().includes(q),
      );
    }
    return [...rows].sort((a, b) => {
      const an = (a.last_name || '') + (a.first_name || '');
      const bn = (b.last_name || '') + (b.first_name || '');
      return an.localeCompare(bn);
    });
  }, [allUsers, org?.id, filter, superMode]);

  function openEdit(user) {
    track('mission_control.admin.user_opened', {
      user_id: user.id,
      org_id: user.org_id,
      persona: user.persona,
    });
    setEditing(user);
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold text-slate-900">
            {superMode ? 'All users' : `Users · ${org?.name || ''}`}
          </div>
          <span className="text-xs text-slate-500">
            {visibleUsers.length} {visibleUsers.length === 1 ? 'user' : 'users'}
          </span>
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search name or email"
            className="text-xs pl-7 pr-2 py-1.5 border border-slate-200 rounded bg-white focus:outline-none focus:border-violet-500 w-56"
          />
        </div>
      </div>

      <table className="w-full text-xs">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <Th>Name</Th>
            <Th>Email</Th>
            {superMode && <Th>Org</Th>}
            <Th>Persona</Th>
            <Th>Badges</Th>
            <Th>Status</Th>
            <Th>Last active</Th>
          </tr>
        </thead>
        <tbody>
          {visibleUsers.length === 0 ? (
            <tr>
              <td colSpan={superMode ? 7 : 6} className="px-5 py-10 text-center text-slate-500">
                No users {filter ? 'match the filter' : 'in this org yet'}.
              </td>
            </tr>
          ) : (
            visibleUsers.map((u) => {
              const eff = effectiveBadges(u);
              return (
                <tr
                  key={u.id}
                  onClick={() => openEdit(u)}
                  className="border-b border-slate-100 last:border-b-0 hover:bg-violet-50/40 cursor-pointer"
                >
                  <Td>
                    <div className="font-medium text-slate-900">
                      {u.last_name}, {u.first_name}
                    </div>
                  </Td>
                  <Td>
                    <div className="text-slate-600 font-mono text-[11px]">{u.email}</div>
                  </Td>
                  {superMode && (
                    <Td>
                      <span className="text-[10px] uppercase tracking-wide bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-mono">
                        #{u.org_id}
                      </span>
                    </Td>
                  )}
                  <Td>
                    <PersonaChip persona={u.persona} />
                  </Td>
                  <Td>
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200">
                      <ShieldCheck className="w-2.5 h-2.5" />
                      {eff.length}
                    </span>
                  </Td>
                  <Td>
                    <StatusPill status={u.status} />
                  </Td>
                  <Td>
                    <div className="text-slate-500 text-[11px]">
                      {formatDate(u.last_active_at)}
                    </div>
                  </Td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {editing && (
        <UserEdit
          user={editing}
          actorPersona={persona}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function PersonaChip({ persona }) {
  const map = {
    super_admin: 'bg-amber-50 text-amber-700 border-amber-200',
    admin: 'bg-violet-50 text-violet-700 border-violet-200',
    manager: 'bg-blue-50 text-blue-700 border-blue-200',
    agent: 'bg-slate-50 text-slate-700 border-slate-200',
    consumer: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
  const cls = map[persona] || 'bg-slate-50 text-slate-700 border-slate-200';
  return (
    <span
      className={
        'inline-flex text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full border ' +
        cls
      }
    >
      {persona}
    </span>
  );
}

function StatusPill({ status }) {
  if (status === 'suspended') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
        <XCircle className="w-2.5 h-2.5" />
        suspended
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
      <CheckCircle2 className="w-2.5 h-2.5" />
      active
    </span>
  );
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function Th({ children }) {
  return (
    <th className="text-left text-[10px] uppercase tracking-wider font-semibold text-slate-500 px-4 py-2">
      {children}
    </th>
  );
}

function Td({ children }) {
  return <td className="px-4 py-2.5 align-middle">{children}</td>;
}
