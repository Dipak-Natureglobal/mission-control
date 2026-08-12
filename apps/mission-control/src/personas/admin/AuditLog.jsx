// AuditLog — vertical timeline of admin-console events for one org.
// Per architecture/10-admin-console.md.
//
// Source: src/fixtures/audit-events.json (Phase 1). Filtered by current
// org id, grouped by day, sorted newest-first within each day.
// Phase 2 swap: server-side append-only log (super-admin pivots
// cross-org).
//
// Per-event icon + actor name (resolved from users.json) + human-
// readable line + timestamp. Line text is type-specific so the timeline
// reads naturally.

import { useEffect, useMemo, useState } from 'react';
import {
  Building,
  CheckCircle2,
  Edit3,
  Eye,
  FileText,
  KeyRound,
  Plug,
  ShieldOff,
  Sliders,
  TestTube2,
  UserMinus,
  UserPlus,
  Users as UsersIcon,
} from 'lucide-react';
import auditFixture from '../../fixtures/audit-events.json';
import usersFixture from '../../fixtures/users.json';
import { track } from 'blinker-platform/telemetry';

const FILTERS = [
  { key: 'all',           label: 'All' },
  { key: 'user',          label: 'Users' },
  { key: 'integration',   label: 'Integrations' },
  { key: 'config',        label: 'Configuration' },
  { key: 'test_mode',     label: 'Test mode' },
  { key: 'credential',    label: 'Credentials' },
  { key: 'org',           label: 'Org' },
];

export function AuditLog({ org, superMode = false }) {
  const allEvents = auditFixture.events || [];
  const allUsers = usersFixture.users || [];
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    track('mission_control.admin.audit_viewed', {
      org_id: org?.id,
      super_mode: superMode,
    });
  }, [org?.id, superMode]);

  const userMap = useMemo(() => {
    const m = new Map();
    for (const u of allUsers) m.set(u.id, u);
    return m;
  }, [allUsers]);

  const events = useMemo(() => {
    let rows = superMode ? allEvents : allEvents.filter((e) => e.org_id === org?.id);
    if (filter !== 'all') {
      rows = rows.filter((e) => e.type.startsWith(filter + '.') || e.type === filter);
    }
    return [...rows].sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
  }, [allEvents, org?.id, filter, superMode]);

  const grouped = useMemo(() => groupByDay(events), [events]);

  function setFilterAndTrack(next) {
    setFilter(next);
    track('mission_control.admin.audit_filter_changed', {
      org_id: org?.id,
      filter: next,
    });
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-slate-900">
          {superMode ? 'Cross-org audit trail' : `Audit log · ${org?.name || ''}`}
        </div>
        <div className="text-xs text-slate-500">
          {events.length} event{events.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* Filter chips */}
      <div className="px-5 py-2.5 border-b border-slate-100 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilterAndTrack(f.key)}
            className={
              'text-[11px] font-semibold px-2 py-1 rounded border ' +
              (filter === f.key
                ? 'bg-violet-600 border-violet-600 text-white'
                : 'bg-white border-slate-200 text-slate-600 hover:border-violet-300')
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="px-5 py-4">
        {grouped.length === 0 ? (
          <div className="text-xs text-slate-500 italic text-center py-8">
            No events {filter === 'all' ? 'on this org yet' : 'match this filter'}.
          </div>
        ) : (
          <div className="space-y-5">
            {grouped.map(([day, dayEvents]) => (
              <div key={day}>
                <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 mb-2">
                  {day}
                </div>
                <ul className="relative border-l-2 border-slate-100 pl-4 space-y-2.5">
                  {dayEvents.map((ev) => (
                    <EventRow key={ev.id} ev={ev} actor={userMap.get(ev.user_id)} superMode={superMode} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EventRow({ ev, actor, superMode }) {
  const Icon = iconForType(ev.type);
  const tone = toneForType(ev.type);
  const actorName = actor
    ? `${actor.first_name} ${actor.last_name}`
    : `User ${ev.user_id}`;
  const line = lineForEvent(ev, actor);
  return (
    <li className="relative">
      <span
        className={
          'absolute -left-[22px] top-0 inline-flex items-center justify-center w-7 h-7 rounded-full border ' +
          tone
        }
      >
        <Icon className="w-3.5 h-3.5" />
      </span>
      <div className="text-xs text-slate-900">
        <span className="font-semibold">{actorName}</span>{' '}
        <span className="text-slate-700">{line}</span>
        {superMode && (
          <span className="ml-1.5 text-[10px] uppercase tracking-wide bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-mono">
            #{ev.org_id}
          </span>
        )}
      </div>
      <div className="text-[10px] text-slate-400 mt-0.5">
        {formatTime(ev.occurred_at)} · {ev.type}
      </div>
    </li>
  );
}

function iconForType(type) {
  if (type.startsWith('user.invited')) return UserPlus;
  if (type.startsWith('user.suspended')) return UserMinus;
  if (type.startsWith('user.persona_changed') || type.startsWith('user.badges_changed')) return UsersIcon;
  if (type.startsWith('user.')) return UsersIcon;
  if (type.startsWith('integration.')) return Plug;
  if (type === 'credential.revealed') return Eye;
  if (type.startsWith('credential.')) return KeyRound;
  if (type.startsWith('config.')) return Sliders;
  if (type === 'test_mode.toggled') return TestTube2;
  if (type === 'org.created') return Building;
  if (type === 'org.updated' || type === 'org.archived') return Edit3;
  if (type.startsWith('org.')) return Building;
  return CheckCircle2;
}

function toneForType(type) {
  if (type === 'credential.revealed') return 'bg-amber-50 border-amber-300 text-amber-700';
  if (type === 'test_mode.toggled') return 'bg-amber-50 border-amber-300 text-amber-700';
  if (type === 'user.suspended') return 'bg-rose-50 border-rose-300 text-rose-700';
  if (type.startsWith('integration.')) return 'bg-blue-50 border-blue-300 text-blue-700';
  if (type.startsWith('config.')) return 'bg-violet-50 border-violet-300 text-violet-700';
  if (type.startsWith('user.')) return 'bg-emerald-50 border-emerald-300 text-emerald-700';
  if (type.startsWith('org.')) return 'bg-slate-50 border-slate-300 text-slate-600';
  return 'bg-slate-50 border-slate-200 text-slate-600';
}

function lineForEvent(ev, actor) {
  const p = ev.payload || {};
  switch (ev.type) {
    case 'org.created':
      return `created the org${p.name ? ` (${p.name})` : ''}.`;
    case 'org.updated':
      return `updated org · ${p.field || 'metadata'}${p.from !== undefined ? ` (${p.from} → ${p.to})` : ''}.`;
    case 'org.archived':
      return `archived the org.`;
    case 'org.recopy_from_parent':
      return `re-copied configuration from parent org.`;
    case 'user.invited':
      return `invited ${p.email || 'a new user'}${p.persona ? ` as ${p.persona}` : ''}.`;
    case 'user.suspended':
      return `suspended user ${p.user_id}${p.reason ? ` (${p.reason})` : ''}.`;
    case 'user.persona_changed':
      return `changed user ${p.user_id}'s persona from ${p.from} to ${p.to}.`;
    case 'user.badges_changed':
      return `changed user ${p.user_id}'s badges (+${(p.added || []).length}/-${(p.removed || []).length}).`;
    case 'integration.enabled':
      return `enabled the ${p.provider} integration.`;
    case 'integration.disabled':
      return `disabled the ${p.provider} integration.`;
    case 'integration.credentials_updated': {
      const fields = (p.fields_changed || []).join(', ') || 'fields';
      return `updated ${p.provider} credentials${p.env ? ` (${p.env} env)` : ''} — ${fields}.`;
    }
    case 'integration.tested':
      return `tested the ${p.provider} integration.`;
    case 'credential.revealed':
      return `revealed ${p.provider} ${p.field}${p.env ? ` (${p.env})` : ''}.`;
    case 'config.updated': {
      const diffKeys = Object.keys(p.diff || {});
      const diffSummary = diffKeys
        .map((k) => {
          const d = p.diff[k];
          return `${k}: ${d.from} → ${d.to}`;
        })
        .join(', ');
      return `updated ${p.section || 'configuration'} — ${diffSummary || 'fields changed'}.`;
    }
    case 'test_mode.toggled':
      return `toggled test mode ${p.from ? 'OFF' : 'ON'} (${p.from} → ${p.to}).`;
    default:
      return `(${ev.type})`;
  }
}

function groupByDay(events) {
  const map = new Map();
  for (const ev of events) {
    const day = formatDay(ev.occurred_at);
    if (!map.has(day)) map.set(day, []);
    map.get(day).push(ev);
  }
  return [...map.entries()];
}

function formatDay(iso) {
  if (!iso) return 'Unknown';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function formatTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// Re-export for SuperHome's CrossOrgAuditTrail tile (commit 6).
export { ShieldOff, FileText };
