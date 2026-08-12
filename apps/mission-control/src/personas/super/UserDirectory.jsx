// UserDirectory — Wave 19 Task 6 (super-admin shell).
//
// Per spec:
//   * Super admin can:  add user to ANY org; edit persona presets; reset
//                       password; edit user profile; add user.
//   * Admin can:        add user to one or more CHILD orgs (NOT any-org);
//                       plus the rest above.
//
// Built under super/ but designed to be re-usable by the admin persona —
// `persona` prop gates the org-scoping. When persona === 'super_admin',
// the org dropdown lists every org. When persona === 'admin', it lists only
// the admin's own org + descendants. Today the admin shell hasn't lifted
// this in yet; we use `org_id` (admin's home org) and walk children when
// the time comes.
//
// Persistence: src/lib/super-admin-storage.js (localStorage shim;
// deliberately separate from contact-storage.js to avoid a merge race
// with another agent in this wave).
//
// Persona presets: see src/fixtures/persona-presets.json. Includes a
// CANON _TODO comment block at the top documenting the proposed canon
// shape — promotion to canon/personas.json is a follow-up wave.

import { useEffect, useMemo, useState } from 'react';
import {
  KeyRound,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import {
  addUser,
  deleteUser,
  getUserOrgIds,
  listOrgs,
  listPresets,
  listUsers,
  resetPassword,
  resetPresetsToFixture,
  resetUsersToFixture,
  updateUser,
  upsertPreset,
  deletePreset,
} from '../../lib/super-admin-storage.js';
import { effectiveBadges } from '../../lib/permissions.js';
import personasCanon from '../../constants/canon/personas.json';
import { track } from 'blinker-platform/telemetry';

const PERSONA_OPTIONS = [
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'admin',       label: 'Admin' },
  { value: 'manager',     label: 'Manager' },
  { value: 'agent',       label: 'Agent' },
  { value: 'consumer',    label: 'Consumer' },
];

export function UserDirectory({ persona = 'super_admin', adminOrgId = null }) {
  const [users, setUsers] = useState(() => listUsers());
  // Orgs are a static read for the user-directory dropdown; OrgRegistry owns
  // mutations. If a user re-opens the directory after an org edit, the next
  // mount picks up the new list. eslint-disable-line is intentional.
  const [orgs] = useState(() => listOrgs());
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState(null);     // user object or null
  const [adding, setAdding] = useState(false);
  const [presetEditorOpen, setPresetEditorOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [flash, setFlash] = useState(null);         // {kind, msg}

  // Re-read after any mutation so the table reflects the current store.
  function refreshUsers() {
    setUsers(listUsers());
  }

  // PostHog: surface open event.
  useEffect(() => {
    track('mission_control.super_admin.user_directory_opened', {
      persona,
      visible_users: users.length,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Org scoping: super sees all orgs. Admin sees own + descendants. We use
  // the same eligibleParents() helper inverted — for admin we'd want to
  // include adminOrgId AND all descendants. Today admin reuse is future
  // work; the simple super_admin path is a no-op filter.
  const visibleOrgs = useMemo(() => {
    if (persona === 'super_admin') return orgs;
    if (!adminOrgId) return [];
    // Admin: own + descendants. Walk down from adminOrgId.
    const allowed = new Set();
    function collect(id) {
      allowed.add(id);
      for (const o of orgs) if (o.parent_org_id === id) collect(o.id);
    }
    collect(adminOrgId);
    return orgs.filter((o) => allowed.has(o.id));
  }, [persona, adminOrgId, orgs]);

  const visibleUsers = useMemo(() => {
    let rows = users;
    // Admin: scope rows to visibleOrgs ids. User may belong to multiple orgs;
    // include row if ANY of their org_ids overlaps the allowed set.
    if (persona !== 'super_admin') {
      const allowedIds = new Set(visibleOrgs.map((o) => o.id));
      rows = rows.filter((u) => getUserOrgIds(u).some((id) => allowedIds.has(id)));
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
  }, [users, persona, visibleOrgs, filter]);

  const orgsById = useMemo(() => {
    const m = new Map();
    for (const o of orgs) m.set(o.id, o);
    return m;
  }, [orgs]);

  function showFlash(kind, msg) {
    setFlash({ kind, msg });
    setTimeout(() => setFlash(null), 2200);
  }

  function handleAdd(user) {
    addUser(user);
    refreshUsers();
    setAdding(false);
    track('mission_control.super_admin.user_added', {
      persona: user.persona,
      org_ids: getUserOrgIds(user),
      org_ids_count: getUserOrgIds(user).length,
      preset_id: user.preset_id || null,
    });
    showFlash('ok', `Added ${user.first_name} ${user.last_name}`);
  }

  function handleEdit(id, patch) {
    updateUser(id, patch);
    refreshUsers();
    setEditing(null);
    track('mission_control.super_admin.user_edited', {
      user_id: id,
      keys: Object.keys(patch),
      org_ids: patch.org_ids != null ? patch.org_ids : undefined,
      org_ids_count: patch.org_ids != null ? patch.org_ids.length : undefined,
    });
    showFlash('ok', 'User updated');
  }

  function handleResetPassword(user) {
    resetPassword(user.id);
    refreshUsers();
    track('mission_control.super_admin.password_reset', { user_id: user.id });
    showFlash('ok', `Password reset for ${user.first_name} ${user.last_name}`);
  }

  function handleDelete(user) {
    deleteUser(user.id);
    refreshUsers();
    setConfirmDelete(null);
    track('mission_control.super_admin.user_deleted', { user_id: user.id });
    showFlash('ok', `Deleted ${user.first_name} ${user.last_name}`);
  }

  function handleResetAll() {
    resetUsersToFixture();
    refreshUsers();
    showFlash('ok', 'Users reset to fixture');
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setAdding(true)}
          className="text-xs font-semibold px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white inline-flex items-center gap-1.5"
        >
          <Plus className="w-3 h-3" />
          Add user
        </button>
        <button
          onClick={() => setPresetEditorOpen(true)}
          className="text-xs font-medium px-3 py-1.5 rounded border border-slate-200 bg-white hover:border-amber-500 inline-flex items-center gap-1.5"
        >
          <ShieldCheck className="w-3 h-3" />
          Edit persona presets
        </button>
        <button
          onClick={handleResetAll}
          className="text-xs font-medium px-3 py-1.5 rounded border border-slate-200 bg-white hover:border-slate-400 inline-flex items-center gap-1.5"
          title="Reset users to bundled fixture"
        >
          <RotateCcw className="w-3 h-3" />
          Reset to fixture
        </button>

        <div className="ml-auto relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search name or email"
            className="text-xs pl-7 pr-2 py-1.5 border border-slate-200 rounded bg-white focus:outline-none focus:border-amber-500 w-64"
          />
        </div>
      </div>

      {flash && (
        <div
          className={
            'text-xs px-3 py-2 rounded border ' +
            (flash.kind === 'err'
              ? 'bg-rose-50 border-rose-200 text-rose-700'
              : 'bg-emerald-50 border-emerald-200 text-emerald-700')
          }
        >
          {flash.msg}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
          <div className="text-sm font-semibold text-slate-900">Users</div>
          <span className="text-xs text-slate-500">
            {visibleUsers.length} {visibleUsers.length === 1 ? 'user' : 'users'}
          </span>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Org</Th>
              <Th>Persona / Preset</Th>
              <Th>Badges</Th>
              <Th>Status</Th>
              <Th className="w-32 text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {visibleUsers.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-slate-500">
                  No users {filter ? 'match the filter' : 'yet'}.
                </td>
              </tr>
            ) : (
              visibleUsers.map((u) => {
                const eff = effectiveBadges(u);
                const userOrgIds = getUserOrgIds(u);
                return (
                  <tr key={u.id} className="border-b border-slate-100 last:border-b-0 hover:bg-amber-50/30">
                    <Td>
                      <div className="font-medium text-slate-900">
                        {u.last_name}, {u.first_name}
                      </div>
                    </Td>
                    <Td>
                      <div className="text-slate-600 font-mono text-[11px]">{u.email}</div>
                    </Td>
                    <Td>
                      <OrgChips orgIds={userOrgIds} orgsById={orgsById} />
                    </Td>
                    <Td>
                      <PersonaChip persona={u.persona} />
                      {u.preset_id && (
                        <div className="text-[10px] text-slate-500 mt-0.5 font-mono">{u.preset_id}</div>
                      )}
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                        <ShieldCheck className="w-2.5 h-2.5" />
                        {eff.length}
                      </span>
                    </Td>
                    <Td>
                      <span
                        className={
                          'inline-flex text-[10px] font-medium px-2 py-0.5 rounded-full border ' +
                          (u.status === 'suspended'
                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200')
                        }
                      >
                        {u.status || 'active'}
                      </span>
                    </Td>
                    <Td className="text-right">
                      <div className="inline-flex items-center gap-1 justify-end">
                        <IconBtn title="Edit user" onClick={() => setEditing(u)}>
                          <Pencil className="w-3 h-3" />
                        </IconBtn>
                        <IconBtn title="Reset password" onClick={() => handleResetPassword(u)}>
                          <KeyRound className="w-3 h-3" />
                        </IconBtn>
                        <IconBtn title="Delete user" tone="rose" onClick={() => setConfirmDelete(u)}>
                          <Trash2 className="w-3 h-3" />
                        </IconBtn>
                      </div>
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {adding && (
        <UserAddDialog
          orgs={visibleOrgs}
          actorPersona={persona}
          onSave={handleAdd}
          onClose={() => setAdding(false)}
        />
      )}
      {editing && (
        <UserEditDialog
          user={editing}
          orgs={visibleOrgs}
          actorPersona={persona}
          onSave={(patch) => handleEdit(editing.id, patch)}
          onClose={() => setEditing(null)}
        />
      )}
      {presetEditorOpen && (
        <PersonaPresetEditor
          onClose={() => setPresetEditorOpen(false)}
          onChanged={() => {
            track('mission_control.super_admin.persona_preset_edited', {});
            showFlash('ok', 'Persona presets updated');
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${confirmDelete.first_name} ${confirmDelete.last_name}?`}
          body="This removes the user from the local store. The bundled fixture is unchanged; use Reset to fixture to restore."
          confirmLabel="Delete"
          tone="rose"
          onConfirm={() => handleDelete(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

// ─── User Add Dialog ───────────────────────────────────────────────────────

function UserAddDialog({ orgs, actorPersona, onSave, onClose }) {
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    persona: 'agent',
    preset_id: '',
    org_ids: [],
    status: 'active',
  });
  const [orgSearch, setOrgSearch] = useState('');
  const presets = listPresets();
  const personaPresets = presets[form.persona] || [];

  // Seed preset_id to the persona's default preset whenever persona changes.
  useEffect(() => {
    if (personaPresets.length === 0) {
      setForm((f) => ({ ...f, preset_id: '' }));
      return;
    }
    const def = personaPresets.find((p) => p.is_default) || personaPresets[0];
    setForm((f) => ({ ...f, preset_id: def?.id || '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.persona]);

  const isSuper = actorPersona === 'super_admin';
  const orgScopeBlurb = isSuper
    ? 'Super admin can assign to any org. Select one or more.'
    : 'Admin can assign to own org + child orgs. Select one or more.';

  const filteredOrgs = orgSearch.trim()
    ? orgs.filter((o) =>
        o.name?.toLowerCase().includes(orgSearch.trim().toLowerCase()) ||
        String(o.id).includes(orgSearch.trim()),
      )
    : orgs;

  function toggleOrg(id) {
    setForm((f) => ({
      ...f,
      org_ids: f.org_ids.includes(id)
        ? f.org_ids.filter((x) => x !== id)
        : [...f.org_ids, id],
    }));
  }

  function submit(e) {
    e.preventDefault();
    if (!form.first_name || !form.last_name || !form.email || form.org_ids.length === 0) return;
    onSave(form);
  }

  return (
    <Drawer title="Add user" subtitle={orgScopeBlurb} onClose={onClose}>
      <form onSubmit={submit} className="p-6 space-y-4">
        <Field label="First name">
          <input
            type="text"
            value={form.first_name}
            onChange={(e) => setForm({ ...form, first_name: e.target.value })}
            className={inputCls}
            required
          />
        </Field>
        <Field label="Last name">
          <input
            type="text"
            value={form.last_name}
            onChange={(e) => setForm({ ...form, last_name: e.target.value })}
            className={inputCls}
            required
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className={inputCls + ' font-mono'}
            required
          />
        </Field>
        <Field label={`Orgs (${form.org_ids.length} selected — at least one required)`}>
          <OrgMultiSelect
            orgs={filteredOrgs}
            selectedIds={form.org_ids}
            orgSearch={orgSearch}
            onSearchChange={setOrgSearch}
            onToggle={toggleOrg}
          />
        </Field>
        <Field label="Persona">
          <select
            value={form.persona}
            onChange={(e) => setForm({ ...form, persona: e.target.value })}
            className={inputCls}
          >
            {PERSONA_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Persona preset">
          <select
            value={form.preset_id || ''}
            onChange={(e) => setForm({ ...form, preset_id: e.target.value })}
            className={inputCls}
          >
            {personaPresets.length === 0 ? (
              <option value="">— no presets defined for this persona —</option>
            ) : (
              personaPresets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({p.badges.length} badges){p.is_default ? ' · default' : ''}
                </option>
              ))
            )}
          </select>
        </Field>
        <DialogFooter onCancel={onClose} submitLabel="Add user" />
      </form>
    </Drawer>
  );
}

// ─── User Edit Dialog ──────────────────────────────────────────────────────

function UserEditDialog({ user, orgs, actorPersona, onSave, onClose }) {
  const [form, setForm] = useState({
    first_name: user.first_name || '',
    last_name: user.last_name || '',
    email: user.email || '',
    persona: user.persona || 'agent',
    preset_id: user.preset_id || '',
    org_ids: getUserOrgIds(user),
    status: user.status || 'active',
  });
  const [orgSearch, setOrgSearch] = useState('');
  const presets = listPresets();
  const personaPresets = presets[form.persona] || [];
  const isSuper = actorPersona === 'super_admin';

  const filteredOrgs = orgSearch.trim()
    ? orgs.filter((o) =>
        o.name?.toLowerCase().includes(orgSearch.trim().toLowerCase()) ||
        String(o.id).includes(orgSearch.trim()),
      )
    : orgs;

  function toggleOrg(id) {
    setForm((f) => ({
      ...f,
      org_ids: f.org_ids.includes(id)
        ? f.org_ids.filter((x) => x !== id)
        : [...f.org_ids, id],
    }));
  }

  function submit(e) {
    e.preventDefault();
    if (form.org_ids.length === 0) return; // at least one org required
    onSave(form);
  }

  return (
    <Drawer
      title={`Edit ${user.first_name} ${user.last_name}`}
      subtitle={isSuper ? 'Super admin · any org' : 'Admin · own + child orgs'}
      onClose={onClose}
    >
      <form onSubmit={submit} className="p-6 space-y-4">
        <Field label="First name">
          <input
            type="text"
            value={form.first_name}
            onChange={(e) => setForm({ ...form, first_name: e.target.value })}
            className={inputCls}
            required
          />
        </Field>
        <Field label="Last name">
          <input
            type="text"
            value={form.last_name}
            onChange={(e) => setForm({ ...form, last_name: e.target.value })}
            className={inputCls}
            required
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className={inputCls + ' font-mono'}
            required
          />
        </Field>
        <Field label={`Orgs (${form.org_ids.length} selected — at least one required)`}>
          <OrgMultiSelect
            orgs={filteredOrgs}
            selectedIds={form.org_ids}
            orgSearch={orgSearch}
            onSearchChange={setOrgSearch}
            onToggle={toggleOrg}
          />
        </Field>
        <Field label="Persona">
          <select
            value={form.persona}
            onChange={(e) => setForm({ ...form, persona: e.target.value, preset_id: '' })}
            className={inputCls}
          >
            {PERSONA_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Persona preset">
          <select
            value={form.preset_id || ''}
            onChange={(e) => setForm({ ...form, preset_id: e.target.value })}
            className={inputCls}
          >
            <option value="">— no preset —</option>
            {personaPresets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} ({p.badges.length} badges){p.is_default ? ' · default' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
            className={inputCls}
          >
            <option value="active">active</option>
            <option value="suspended">suspended</option>
          </select>
        </Field>
        <DialogFooter onCancel={onClose} submitLabel="Save changes" />
      </form>
    </Drawer>
  );
}

// ─── Persona Preset Editor ─────────────────────────────────────────────────
//
// Shows each persona as a section. Each section lists the persona's presets
// with their badge subset; admin can rename, edit the badge list, add a new
// preset, or delete an existing one.
//
// Available badges are sourced from canon/personas.json#permissions for that
// persona — checkboxes seeded against the preset's current badge list.

function PersonaPresetEditor({ onClose, onChanged }) {
  const [presets, setPresets] = useState(() => listPresets());
  const [activePersona, setActivePersona] = useState('agent');

  function refresh() {
    setPresets(listPresets());
    if (onChanged) onChanged();
  }

  function handleSavePreset(persona, preset) {
    upsertPreset(persona, preset);
    refresh();
  }

  function handleDeletePreset(persona, presetId) {
    deletePreset(persona, presetId);
    refresh();
  }

  function handleResetAll() {
    resetPresetsToFixture();
    refresh();
  }

  return (
    <Drawer title="Persona presets" subtitle="Bundles of badges per persona. Phase 1 — fixture-backed, canon-promotion TODO." onClose={onClose} wide>
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          {PERSONA_OPTIONS.filter((p) => p.value !== 'consumer').map((p) => (
            <button
              key={p.value}
              onClick={() => setActivePersona(p.value)}
              className={
                'text-xs px-3 py-1.5 rounded border ' +
                (activePersona === p.value
                  ? 'bg-amber-600 border-amber-600 text-white'
                  : 'bg-white border-slate-200 hover:border-amber-400 text-slate-700')
              }
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={handleResetAll}
            className="ml-auto text-xs font-medium px-3 py-1.5 rounded border border-slate-200 bg-white hover:border-slate-400 inline-flex items-center gap-1.5"
            title="Reset all presets to bundled fixture"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
        </div>

        <PresetList
          persona={activePersona}
          presets={presets[activePersona] || []}
          onSave={(p) => handleSavePreset(activePersona, p)}
          onDelete={(id) => handleDeletePreset(activePersona, id)}
        />

        <div className="text-[10px] text-slate-500 leading-relaxed border-t border-slate-100 pt-3">
          Storage: <code className="font-mono">localStorage[blinker.super.persona_presets.v1]</code>.
          Promotion to canon: see <code className="font-mono">_CANON_TODO</code> at the top of{' '}
          <code className="font-mono">src/fixtures/persona-presets.json</code>.
        </div>
      </div>
    </Drawer>
  );
}

function PresetList({ persona, presets, onSave, onDelete }) {
  // Available badges: the persona's canon permissions list. Pulls from
  // canon/personas.json (stable shape: personas[persona].permissions[]).
  const availableBadges = useMemo(
    () => personasCanon?.personas?.[persona]?.permissions || [],
    [persona],
  );

  const [draft, setDraft] = useState(null); // {id?, label, description, badges, is_default}

  function startNew() {
    setDraft({
      id: '',
      label: '',
      description: '',
      badges: [],
      is_default: false,
    });
  }

  function startEdit(p) {
    setDraft({ ...p });
  }

  function saveDraft() {
    if (!draft) return;
    if (!draft.id || !draft.label) return;
    onSave(draft);
    setDraft(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-slate-700">
          {presets.length} preset{presets.length === 1 ? '' : 's'} for {persona}
        </div>
        <button
          onClick={startNew}
          className="text-xs font-semibold px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white inline-flex items-center gap-1.5"
        >
          <Plus className="w-3 h-3" /> New preset
        </button>
      </div>

      <div className="space-y-2">
        {presets.map((p) => (
          <div key={p.id} className="border border-slate-200 rounded-md p-3 bg-white">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold text-slate-900">{p.label}</div>
                  {p.is_default && (
                    <span className="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                      default
                    </span>
                  )}
                </div>
                <div className="text-[10px] font-mono text-slate-400 mt-0.5">{p.id}</div>
                <div className="text-[11px] text-slate-500 mt-1 leading-snug">{p.description}</div>
                <div className="text-[11px] text-slate-700 mt-2">
                  {p.badges.length} badge{p.badges.length === 1 ? '' : 's'}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <IconBtn title="Edit preset" onClick={() => startEdit(p)}>
                  <Pencil className="w-3 h-3" />
                </IconBtn>
                <IconBtn title="Delete preset" tone="rose" onClick={() => onDelete(p.id)}>
                  <Trash2 className="w-3 h-3" />
                </IconBtn>
              </div>
            </div>
          </div>
        ))}
      </div>

      {draft && (
        <div className="border border-amber-300 rounded-md p-4 bg-amber-50/40 space-y-3">
          <div className="text-xs font-semibold text-amber-800">
            {draft.id && presets.some((p) => p.id === draft.id) ? 'Edit preset' : 'New preset'}
          </div>
          <Field label="Preset id (snake_case)">
            <input
              type="text"
              value={draft.id}
              onChange={(e) => setDraft({ ...draft, id: e.target.value })}
              className={inputCls + ' font-mono'}
              placeholder={`${persona}_custom`}
            />
          </Field>
          <Field label="Label">
            <input
              type="text"
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="Description">
            <input
              type="text"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="Default for this persona?">
            <label className="text-xs text-slate-700 inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!draft.is_default}
                onChange={(e) => setDraft({ ...draft, is_default: e.target.checked })}
              />
              Seed this preset on new users of this persona
            </label>
          </Field>
          <Field label={`Badges (subset of canon ${persona} permissions)`}>
            <div className="grid grid-cols-2 gap-1 max-h-48 overflow-auto p-2 bg-white border border-slate-200 rounded">
              {availableBadges.length === 0 ? (
                <div className="text-[11px] text-slate-500">
                  No canon permissions defined for {persona}.
                </div>
              ) : (
                availableBadges.map((b) => {
                  const checked = draft.badges.includes(b);
                  return (
                    <label key={b} className="text-[11px] text-slate-700 inline-flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setDraft({ ...draft, badges: [...draft.badges, b] });
                          } else {
                            setDraft({ ...draft, badges: draft.badges.filter((x) => x !== b) });
                          }
                        }}
                      />
                      <span className="font-mono truncate">{b}</span>
                    </label>
                  );
                })
              )}
            </div>
          </Field>
          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={() => setDraft(null)}
              className="text-xs font-medium px-3 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-100 text-slate-700"
            >
              Cancel
            </button>
            <button
              onClick={saveDraft}
              disabled={!draft.id || !draft.label}
              className={
                'text-xs font-semibold px-3 py-1.5 rounded ' +
                (draft.id && draft.label
                  ? 'bg-amber-600 hover:bg-amber-700 text-white'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed')
              }
            >
              Save preset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Org chips (table cell) ────────────────────────────────────────────────
//
// Renders org memberships as small pills. If a user is in 5+ orgs, shows the
// first 3 + an overflow chip with a title tooltip listing all remaining orgs.

const ORG_CHIP_LIMIT = 3;

function OrgChips({ orgIds, orgsById }) {
  if (!orgIds || orgIds.length === 0) {
    return <span className="text-slate-400 text-[11px]">—</span>;
  }
  const visible = orgIds.slice(0, ORG_CHIP_LIMIT);
  const overflow = orgIds.slice(ORG_CHIP_LIMIT);
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((id) => {
        const org = orgsById.get(id);
        return (
          <span
            key={id}
            className="inline-flex flex-col text-[9px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 leading-tight"
          >
            <span>{org?.name || `Org #${id}`}</span>
            <span className="text-slate-400 font-mono">#{id}</span>
          </span>
        );
      })}
      {overflow.length > 0 && (
        <span
          className="inline-flex items-center text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 cursor-default"
          title={overflow
            .map((id) => {
              const org = orgsById.get(id);
              return org ? `${org.name} (#${id})` : `#${id}`;
            })
            .join(', ')}
        >
          +{overflow.length} more
        </span>
      )}
    </div>
  );
}

// ─── Org multi-select (Add/Edit dialogs) ──────────────────────────────────
//
// Checkbox list with a filter-input above. Renders all orgs passed in via the
// `orgs` prop (already scoped to actor's visibleOrgs by the parent dialog).

function OrgMultiSelect({ orgs, selectedIds, orgSearch, onSearchChange, onToggle }) {
  return (
    <div className="border border-slate-200 rounded">
      <div className="p-1.5 border-b border-slate-200">
        <input
          type="text"
          value={orgSearch}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Filter orgs…"
          className="w-full text-xs px-2 py-1 border border-slate-200 rounded bg-white focus:outline-none focus:border-amber-500"
        />
      </div>
      <div className="max-h-44 overflow-auto p-1.5 space-y-0.5">
        {orgs.length === 0 ? (
          <div className="text-[11px] text-slate-500 px-1 py-2">No orgs match.</div>
        ) : (
          orgs.map((o) => {
            const checked = selectedIds.includes(o.id);
            return (
              <label
                key={o.id}
                className={
                  'flex items-center gap-2 text-[11px] px-2 py-1 rounded cursor-pointer hover:bg-amber-50 ' +
                  (checked ? 'bg-amber-50 text-amber-800' : 'text-slate-700')
                }
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(o.id)}
                  className="accent-amber-600"
                />
                <span className="flex-1 min-w-0 truncate">{o.name}</span>
                <span className="text-slate-400 font-mono shrink-0">#{o.id}</span>
              </label>
            );
          })
        )}
      </div>
      {selectedIds.length === 0 && (
        <div className="px-2 py-1 text-[10px] text-rose-600 border-t border-slate-200">
          At least one org is required.
        </div>
      )}
    </div>
  );
}

// ─── shared dialog primitives ──────────────────────────────────────────────

function Drawer({ title, subtitle, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-30 flex">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="flex-1 bg-slate-900/40"
      />
      <div
        className={
          'bg-white shadow-2xl flex flex-col h-full ' +
          (wide ? 'w-full max-w-3xl' : 'w-full max-w-lg')
        }
        role="dialog"
        aria-modal="true"
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-amber-600 font-semibold mb-0.5">
              Super Admin
            </div>
            <div className="text-base font-semibold text-slate-900 leading-tight">{title}</div>
            {subtitle && <div className="text-[11px] text-slate-500 mt-0.5">{subtitle}</div>}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  );
}

function ConfirmDialog({ title, body, confirmLabel, tone = 'amber', onConfirm, onClose }) {
  const cls =
    tone === 'rose'
      ? 'bg-rose-600 hover:bg-rose-700 text-white'
      : 'bg-amber-600 hover:bg-amber-700 text-white';
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-md w-full p-5">
        <div className="text-base font-semibold text-slate-900">{title}</div>
        <div className="text-xs text-slate-600 mt-2 leading-relaxed">{body}</div>
        <div className="flex items-center gap-2 justify-end mt-4">
          <button
            onClick={onClose}
            className="text-xs font-medium px-3 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-100 text-slate-700"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={'text-xs font-semibold px-3 py-1.5 rounded ' + cls}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">
        {label}
      </div>
      {children}
    </div>
  );
}

function DialogFooter({ onCancel, submitLabel }) {
  return (
    <div className="flex items-center gap-2 justify-end pt-2">
      <button
        type="button"
        onClick={onCancel}
        className="text-xs font-medium px-3 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-100 text-slate-700"
      >
        Cancel
      </button>
      <button
        type="submit"
        className="text-xs font-semibold px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white"
      >
        {submitLabel}
      </button>
    </div>
  );
}

function PersonaChip({ persona }) {
  const map = {
    super_admin: 'bg-amber-50 text-amber-700 border-amber-200',
    admin:       'bg-violet-50 text-violet-700 border-violet-200',
    manager:     'bg-blue-50 text-blue-700 border-blue-200',
    agent:       'bg-slate-50 text-slate-700 border-slate-200',
    consumer:    'bg-emerald-50 text-emerald-700 border-emerald-200',
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

function IconBtn({ children, onClick, title, tone = 'slate' }) {
  const cls =
    tone === 'rose'
      ? 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'
      : 'text-slate-400 hover:text-amber-700 hover:bg-amber-50';
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={'p-1.5 rounded ' + cls}
    >
      {children}
    </button>
  );
}

function Th({ children, className }) {
  return (
    <th
      className={
        'text-left text-[10px] uppercase tracking-wider font-semibold text-slate-500 px-4 py-2 ' +
        (className || '')
      }
    >
      {children}
    </th>
  );
}

function Td({ children, className }) {
  return (
    <td className={'px-4 py-2.5 align-middle ' + (className || '')}>{children}</td>
  );
}

const inputCls =
  'w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:border-amber-500';
