// UserEdit — slide-out drawer for editing a single user. Per
// architecture/10-admin-console.md: "pick a persona (preset dropdown) then
// optionally toggle 1-2 badges". Replaces the legacy 60-checkbox dump.
//
// Drawer pattern: fixed-position right panel + backdrop, no router. Local
// React state for edits; Save is a Phase 1 stub (logs + emits PostHog;
// fixture file not mutated). Phase 2 swap: API mutation with the same shape.
//
// Persona dropdown sources canon/badges.json `presets`. Selecting a persona
// applies its badge preset by default (visually checked). The user's
// existing added_badges / removed_badges remain mutable on top of the
// preset — matches effectiveBadges() resolution.
//
// Reveal-style "effective badges: N" count lives in the footer so you can
// watch it move as you toggle.

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Power,
  Save,
  Shield,
  ShieldOff,
  X,
} from 'lucide-react';
import {
  allPresets,
  badgesByCategory,
  badgesFromPersona,
  effectiveBadges,
} from '../../lib/permissions.js';
import { track } from 'blinker-platform/telemetry';

export function UserEdit({ user, actorPersona = 'admin', onClose }) {
  // Working copy. Save = log + emit + close. Discard = close.
  const [persona, setPersona] = useState(user.persona);
  const [added, setAdded] = useState([...(user.added_badges || [])]);
  const [removed, setRemoved] = useState([...(user.removed_badges || [])]);
  const [status, setStatus] = useState(user.status || 'active');

  // Reset working copy if a different user is opened.
  useEffect(() => {
    setPersona(user.persona);
    setAdded([...(user.added_badges || [])]);
    setRemoved([...(user.removed_badges || [])]);
    setStatus(user.status || 'active');
  }, [user]);

  const presets = allPresets();
  const grouped = badgesByCategory();

  // Effective set is recomputed from current working copy.
  const working = { persona, added_badges: added, removed_badges: removed };
  const effective = useMemo(() => effectiveBadges(working), [persona, added, removed]);
  const effectiveSet = useMemo(() => new Set(effective), [effective]);
  const presetSet = useMemo(() => new Set(badgesFromPersona(persona)), [persona]);

  const personaChanged = persona !== user.persona;
  const statusChanged = status !== user.status;
  const badgesChanged =
    JSON.stringify([...added].sort()) !== JSON.stringify([...(user.added_badges || [])].sort()) ||
    JSON.stringify([...removed].sort()) !== JSON.stringify([...(user.removed_badges || [])].sort());
  const dirty = personaChanged || statusChanged || badgesChanged;

  function onPersonaChange(next) {
    if (next === persona) return;
    setPersona(next);
    // Reset overrides when changing persona — the preset is the new baseline.
    setAdded([]);
    setRemoved([]);
    track('mission_control.admin.user_persona_changed', {
      user_id: user.id,
      from: user.persona,
      to: next,
    });
  }

  function toggleBadge(badgeId) {
    const inPreset = presetSet.has(badgeId);
    const isEffective = effectiveSet.has(badgeId);
    // If currently effective: remove it. inPreset → add to removed; else
    // strip from added.
    if (isEffective) {
      if (inPreset) {
        setRemoved((prev) => (prev.includes(badgeId) ? prev : [...prev, badgeId]));
        setAdded((prev) => prev.filter((b) => b !== badgeId));
      } else {
        setAdded((prev) => prev.filter((b) => b !== badgeId));
      }
    } else {
      // Currently not effective: add it. inPreset (so user must have it in
      // removed) → strip removed; else push into added.
      if (inPreset) {
        setRemoved((prev) => prev.filter((b) => b !== badgeId));
      } else {
        setAdded((prev) => (prev.includes(badgeId) ? prev : [...prev, badgeId]));
      }
    }
    track('mission_control.admin.user_badges_changed', {
      user_id: user.id,
      badge: badgeId,
    });
  }

  function toggleStatus() {
    const next = status === 'suspended' ? 'active' : 'suspended';
    setStatus(next);
    if (next === 'suspended') {
      track('mission_control.admin.user_suspended', { user_id: user.id });
    }
  }

  function onSave() {
    track('mission_control.admin.user_saved', {
      user_id: user.id,
      persona,
      added_count: added.length,
      removed_count: removed.length,
      status,
      effective_count: effective.length,
    });
    // Phase 1 stub — log + close. Phase 2 swap: blinkerApi.users.update().
    if (typeof console !== 'undefined') {
      console.log('[UserEdit] save (Phase 1 stub):', {
        user_id: user.id,
        persona,
        added_badges: added,
        removed_badges: removed,
        status,
      });
    }
    if (onClose) onClose();
  }

  return (
    <div className="fixed inset-0 z-30 flex">
      <button
        type="button"
        aria-label="Close drawer"
        onClick={onClose}
        className="flex-1 bg-slate-900/40"
      />
      <div
        className="w-full max-w-xl bg-white shadow-2xl flex flex-col h-full"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-violet-600 font-semibold mb-0.5">
              Admin · Edit user
            </div>
            <div className="text-lg font-semibold text-slate-900 leading-tight">
              {user.first_name} {user.last_name}
            </div>
            <div className="text-xs text-slate-500 font-mono">{user.email}</div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          <div className="p-6 space-y-6">
            {/* Profile */}
            <Section label="Profile">
              <ReadOnly label="First name" value={user.first_name} />
              <ReadOnly label="Last name" value={user.last_name} />
              <ReadOnly label="Email" value={user.email} />
              <ReadOnly label="Org" value={`#${user.org_id}`} />
            </Section>

            {/* Persona preset */}
            <Section label="Persona preset">
              <div className="text-[11px] text-slate-500 mb-2 leading-relaxed">
                Pick a preset to seed the badge bundle. Override individual
                badges below.
              </div>
              <select
                value={persona}
                onChange={(e) => onPersonaChange(e.target.value)}
                className="w-full text-xs border border-slate-200 rounded px-2 py-2 bg-white focus:outline-none focus:border-violet-500"
              >
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} — {p.badges?.length || 0} badges
                  </option>
                ))}
              </select>
              {presets.find((p) => p.id === persona)?.description && (
                <div className="text-[11px] text-slate-500 mt-1.5 italic leading-relaxed">
                  {presets.find((p) => p.id === persona).description}
                </div>
              )}
            </Section>

            {/* Badges */}
            <Section label={`Badges · effective ${effective.length}`}>
              <div className="text-[11px] text-slate-500 mb-2 leading-relaxed">
                Preset-derived badges show in violet (the persona accent). Click
                any badge to add or remove vs. the preset.
              </div>
              <div className="space-y-4">
                {Object.entries(grouped).map(([category, badges]) => (
                  <div key={category}>
                    <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 mb-1.5">
                      {category}
                    </div>
                    <div className="space-y-1">
                      {badges.map((b) => (
                        <BadgeRow
                          key={b.id}
                          badge={b}
                          inPreset={presetSet.has(b.id)}
                          isEffective={effectiveSet.has(b.id)}
                          onToggle={() => toggleBadge(b.id)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            {/* Status */}
            <Section label="Account status">
              <button
                type="button"
                onClick={toggleStatus}
                className={
                  'w-full text-left flex items-start gap-3 p-3 rounded border ' +
                  (status === 'suspended'
                    ? 'border-rose-300 bg-rose-50'
                    : 'border-slate-200 bg-white hover:border-slate-300')
                }
              >
                <Power
                  className={
                    'w-4 h-4 mt-0.5 shrink-0 ' +
                    (status === 'suspended' ? 'text-rose-600' : 'text-emerald-600')
                  }
                />
                <div className="flex-1">
                  <div className="text-xs font-semibold text-slate-900">
                    {status === 'suspended' ? 'Suspended' : 'Active'}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {status === 'suspended'
                      ? 'Click to reactivate this user.'
                      : 'Click to suspend this user (audit-logged).'}
                  </div>
                </div>
              </button>
            </Section>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center gap-2">
          <div className="text-[11px] text-slate-500 mr-auto">
            {dirty ? (
              <span className="inline-flex items-center gap-1 text-amber-700">
                <AlertTriangle className="w-3 h-3" /> Unsaved changes
              </span>
            ) : (
              <span>No changes</span>
            )}
            <span className="mx-2 text-slate-300">·</span>
            actor: {actorPersona}
          </div>
          <button
            onClick={onClose}
            className="text-xs font-medium px-3 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-100 text-slate-700"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={!dirty}
            className={
              'text-xs font-semibold px-3 py-1.5 rounded inline-flex items-center gap-1.5 ' +
              (dirty
                ? 'bg-violet-600 hover:bg-violet-700 text-white'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed')
            }
          >
            <Save className="w-3 h-3" />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div>
      <div className="text-xs font-semibold text-slate-900 mb-2">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function ReadOnly({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 text-xs">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-900 font-medium">{value}</span>
    </div>
  );
}

function BadgeRow({ badge, inPreset, isEffective, onToggle }) {
  // Visual: violet check when effective + inPreset; outline check when
  // effective but added; faded when not effective.
  let Icon = Shield;
  let cls = 'border-slate-200 bg-white text-slate-400 hover:border-slate-300';
  if (isEffective && inPreset) {
    cls = 'border-violet-300 bg-violet-50 text-violet-700 hover:border-violet-400';
  } else if (isEffective && !inPreset) {
    cls = 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:border-emerald-400';
  } else if (!isEffective && inPreset) {
    Icon = ShieldOff;
    cls = 'border-rose-200 bg-rose-50 text-rose-600 hover:border-rose-300';
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      className={
        'w-full text-left flex items-start gap-2 px-2.5 py-2 rounded border transition-colors ' +
        cls
      }
    >
      <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">{badge.label}</span>
          <span className="text-[9px] uppercase tracking-wide text-slate-400 font-mono">
            {badge.id}
          </span>
        </div>
        {badge.description && (
          <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">
            {badge.description}
          </div>
        )}
      </div>
    </button>
  );
}
