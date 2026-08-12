// OrgRegistry — Wave 19 Task 6 + Wave 20 v3.0.3 Tasks 1+2.
//
// Per spec: super admin only. CRUD orgs; edit hierarchy (parent_org_id);
// copy and edit org configs.
//
// Reads from canon/org-registry.json (seeded once into localStorage by
// src/lib/super-admin-storage.js); does NOT write back to canon. Mutations
// land in localStorage and survive reload; "Reset to canon" wipes the key.
//
// W20 changes:
//   * Edit dialog rebuilt around the v3.0.3 hierarchical bucket model
//     (Overview / System / Contacts / Opportunities { Refinance / Insurance /
//     Protection } / Payments / Integrations / Relationship types).
//   * Vertical left-rail nav replaces horizontal tabs for scale.
//   * Per-section dirty tracking + global "Unsaved changes in ..." indicator.
//   * Save flushes all dirty sections in one updateOrg call (transaction-ish).
//   * Cancel prompts confirm if any section is dirty.
//   * Section components live in ./OrgConfigSections/ to keep this file
//     readable.
//   * Persistence path: super-admin-storage.updateOrg(orgId, patch). Phase 2
//     swap target documented in storage.js.

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import {
  addOrg,
  copyOrg,
  deleteOrg,
  eligibleParents,
  listOrgs,
  resetOrgsToCanon,
  updateOrg,
  withConfigDefaults,
} from '../../lib/super-admin-storage.js';
import { track } from 'blinker-platform/telemetry';

import { OverviewSection } from './OrgConfigSections/Overview.jsx';
import { SystemSection } from './OrgConfigSections/System.jsx';
import { ContactsSection } from './OrgConfigSections/Contacts.jsx';
import { RefinanceSection } from './OrgConfigSections/Refinance.jsx';
import { InsuranceSection } from './OrgConfigSections/Insurance.jsx';
import { ProtectionSection } from './OrgConfigSections/Protection.jsx';
import { PaymentsSection } from './OrgConfigSections/Payments.jsx';
import { IntegrationsSection } from './OrgConfigSections/Integrations.jsx';
import { RelationshipTypesSection } from './OrgConfigSections/RelationshipTypes.jsx';

// Section catalog. `key` is what we track in dirtyBuckets; `parent` is null
// for root nav items, set for sub-items under Opportunities.
const SECTIONS = [
  { key: 'overview', label: 'Overview' },
  { key: 'system', label: 'System' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'opportunities', label: 'Opportunities', isGroup: true },
  { key: 'opp_refinance', parent: 'opportunities', label: 'Refinance' },
  { key: 'opp_insurance', parent: 'opportunities', label: 'Insurance' },
  { key: 'opp_protection', parent: 'opportunities', label: 'Protection' },
  { key: 'payments', label: 'Payments' },
  { key: 'integrations', label: 'Integrations' },
  { key: 'relationship_types', label: 'Relationship types' },
];

const SECTION_LABEL = SECTIONS.reduce((acc, s) => {
  acc[s.key] = s.label;
  return acc;
}, {});

export function OrgRegistry() {
  const [orgs, setOrgs] = useState(() => listOrgs());
  const [editing, setEditing] = useState(null);   // org or null
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [flash, setFlash] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set(orgs.filter((o) => !o.parent_org_id).map((o) => o.id)));

  function refresh() {
    setOrgs(listOrgs());
  }

  useEffect(() => {
    track('mission_control.super_admin.org_registry_opened', {
      org_count: orgs.length,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function showFlash(kind, msg) {
    setFlash({ kind, msg });
    setTimeout(() => setFlash(null), 2200);
  }

  function handleAdd(org) {
    addOrg(org);
    refresh();
    setAdding(false);
    track('mission_control.super_admin.org_added', { name: org.name });
    showFlash('ok', `Added ${org.name}`);
  }

  function handleSave(id, patch, dirtyKeys) {
    updateOrg(id, patch);
    refresh();
    setEditing(null);
    track('mission_control.super_admin.org_edited', {
      org_id: id,
      keys: Object.keys(patch),
    });
    // W20 — fire one event per dirty section so dashboards can slice by
    // which area changed.
    for (const section of dirtyKeys || []) {
      track('mission_control.super_admin.org_config_section_saved', {
        section,
        org_id: id,
        dirty_field_count: 1, // Phase 1: per-section diff is whole-block; field-level diff is Phase 2.
      });
    }
    showFlash('ok', 'Org updated');
  }

  function handleCopy(org) {
    copyOrg(org.id);
    refresh();
    track('mission_control.super_admin.org_copied', { source_id: org.id });
    showFlash('ok', `Copied ${org.name}`);
  }

  function handleDelete(org) {
    deleteOrg(org.id);
    refresh();
    setConfirmDelete(null);
    track('mission_control.super_admin.org_deleted', { org_id: org.id });
    showFlash('ok', `Deleted ${org.name}`);
  }

  function handleReset() {
    resetOrgsToCanon();
    refresh();
    showFlash('ok', 'Orgs reset to canon');
  }

  function toggle(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Build tree: root orgs (no parent_org_id) + recursive children.
  const roots = useMemo(
    () => orgs.filter((o) => o.parent_org_id == null),
    [orgs],
  );
  const childrenOf = useMemo(() => {
    const map = new Map();
    for (const o of orgs) {
      if (o.parent_org_id != null) {
        if (!map.has(o.parent_org_id)) map.set(o.parent_org_id, []);
        map.get(o.parent_org_id).push(o);
      }
    }
    return map;
  }, [orgs]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setAdding(true)}
          className="text-xs font-semibold px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white inline-flex items-center gap-1.5"
        >
          <Plus className="w-3 h-3" />
          Add org
        </button>
        <button
          onClick={handleReset}
          className="text-xs font-medium px-3 py-1.5 rounded border border-slate-200 bg-white hover:border-slate-400 inline-flex items-center gap-1.5"
          title="Reset orgs to canon-seeded defaults"
        >
          <RotateCcw className="w-3 h-3" />
          Reset to canon
        </button>
        <div className="ml-auto text-xs text-slate-500">{orgs.length} orgs total</div>
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

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm divide-y divide-slate-100">
        <div className="px-5 py-3 flex items-center gap-2">
          <div className="text-sm font-semibold text-slate-900">Org hierarchy</div>
          <span className="text-xs text-slate-500">
            click row actions to edit / copy / delete
          </span>
        </div>
        <div className="p-2">
          {roots.length === 0 ? (
            <div className="text-xs text-slate-500 py-6 text-center">
              No root orgs. Add one to get started.
            </div>
          ) : (
            roots.map((root) => (
              <OrgRow
                key={root.id}
                org={root}
                depth={0}
                expanded={expanded}
                onToggle={toggle}
                childrenOf={childrenOf}
                onEdit={setEditing}
                onCopy={handleCopy}
                onDelete={setConfirmDelete}
              />
            ))
          )}
        </div>
      </div>

      {adding && (
        <OrgEditDialog
          mode="add"
          orgs={orgs}
          onSave={handleAdd}
          onClose={() => setAdding(false)}
        />
      )}
      {editing && (
        <OrgEditDialog
          key={editing.id /* re-mount when jumping orgs from hierarchy view */}
          mode="edit"
          org={editing}
          orgs={orgs}
          onSave={(patch, dirtyKeys) => handleSave(editing.id, patch, dirtyKeys)}
          onClose={() => setEditing(null)}
          onJumpToOrg={(o) => setEditing(o)}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${confirmDelete.name}?`}
          body={
            (childrenOf.get(confirmDelete.id) || []).length > 0
              ? `Heads up: this org has ${(childrenOf.get(confirmDelete.id) || []).length} child org(s). They will be orphaned (their parent_org_id will dangle). Edit them first if you need to re-parent.`
              : 'This removes the org from the local store. Canon is unchanged; use Reset to canon to restore.'
          }
          confirmLabel="Delete"
          tone="rose"
          onConfirm={() => handleDelete(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

function OrgRow({ org, depth, expanded, onToggle, childrenOf, onEdit, onCopy, onDelete }) {
  const kids = childrenOf.get(org.id) || [];
  const isOpen = expanded.has(org.id);
  const hasKids = kids.length > 0;
  return (
    <>
      <div
        className="flex items-center gap-2 px-2 py-1.5 hover:bg-amber-50/40 rounded text-xs"
        style={{ paddingLeft: 8 + depth * 18 }}
      >
        <button
          onClick={() => hasKids && onToggle(org.id)}
          className={
            'shrink-0 w-4 h-4 inline-flex items-center justify-center text-slate-500 ' +
            (hasKids ? 'hover:text-amber-700' : 'opacity-30 cursor-default')
          }
          title={hasKids ? (isOpen ? 'Collapse' : 'Expand') : 'No children'}
        >
          {hasKids ? (
            isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />
          ) : (
            <span className="w-3 h-3 inline-block">·</span>
          )}
        </button>
        <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 w-14 shrink-0">
          {org.type || '—'}
        </span>
        <span className="font-medium text-slate-900 truncate flex-1">{org.name}</span>
        <span className="text-[10px] text-slate-400 font-mono">#{org.id}</span>
        <StatusPill status={org.status} />
        <span className="text-[10px] text-slate-400 hidden md:inline-block w-32 truncate" title={org.timezone}>
          {org.timezone || '—'}
        </span>
        <div className="inline-flex items-center gap-0.5">
          <IconBtn title="Edit" onClick={() => onEdit(org)}>
            <Pencil className="w-3 h-3" />
          </IconBtn>
          <IconBtn title="Copy" onClick={() => onCopy(org)}>
            <Copy className="w-3 h-3" />
          </IconBtn>
          <IconBtn title="Delete" tone="rose" onClick={() => onDelete(org)}>
            <Trash2 className="w-3 h-3" />
          </IconBtn>
        </div>
      </div>
      {isOpen &&
        kids.map((k) => (
          <OrgRow
            key={k.id}
            org={k}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            childrenOf={childrenOf}
            onEdit={onEdit}
            onCopy={onCopy}
            onDelete={onDelete}
          />
        ))}
    </>
  );
}

// ─── OrgEditDialog ─────────────────────────────────────────────────────────

function OrgEditDialog({ mode, org, orgs, onSave, onClose, onJumpToOrg }) {
  // Hydrate the working form copy with v3.0.3 defaults so all section forms
  // can bind without null-safety paranoia.
  const [form, setForm] = useState(() => {
    const base =
      mode === 'edit' && org
        ? JSON.parse(JSON.stringify(org))
        : {
            name: '',
            type: 'child',
            status: 'paused',
            parent_org_id: null,
            timezone: 'America/Chicago',
            test_mode: false,
            integrations: {},
          };
    return withConfigDefaults(base);
  });
  // Per-section dirty tracking. A section is "dirty" once any input under it
  // mutates form. Cleared on save.
  const [dirtyBuckets, setDirtyBuckets] = useState(() => new Set());
  const [activeSection, setActiveSection] = useState('overview');
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Eligible parents: never self, never own descendants. (For 'add' there's
  // no self yet, so all orgs are eligible.)
  const eligibleParentList = useMemo(
    () => (mode === 'edit' ? eligibleParents(orgs, org.id) : orgs),
    [mode, orgs, org],
  );

  // Map a top-level form key onto a dirty bucket. Mutations flow through
  // `setSectioned(sectionKey, patch)` which patches form + marks the section
  // dirty in one shot.
  function setSectioned(sectionKey, patch) {
    setForm((f) => ({ ...f, ...patch }));
    setDirtyBuckets((s) => {
      const next = new Set(s);
      next.add(sectionKey);
      return next;
    });
  }

  function submit(e) {
    e.preventDefault();
    if (!form.name) {
      // Force the user back to System where the name input lives if blank.
      setActiveSection('system');
      return;
    }
    const dirtyKeys = Array.from(dirtyBuckets);
    onSave(form, dirtyKeys);
  }

  function handleClose() {
    if (dirtyBuckets.size > 0) {
      setConfirmCancel(true);
    } else {
      onClose();
    }
  }

  // For 'add' mode we don't render the nested sub-sections (Overview makes
  // no sense yet, no audit story to surface). Add mode collapses to a
  // streamlined "name + system + opportunities.protection" minimal flow:
  // we show every section but it's just the editor surface.

  const dirtySectionLabels = Array.from(dirtyBuckets)
    .map((k) => SECTION_LABEL[k])
    .filter(Boolean);

  return (
    <Drawer
      title={mode === 'add' ? 'Add org' : `Edit ${org.name}`}
      subtitle={mode === 'add' ? 'New org seeds with safe defaults; tune below.' : `org #${org.id}`}
      onClose={handleClose}
      wide
    >
      <form onSubmit={submit} className="flex flex-col h-full">
        {dirtySectionLabels.length > 0 && (
          <div className="px-5 py-2 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-800">
            <span className="font-semibold">Unsaved changes in:</span>{' '}
            {dirtySectionLabels.join(', ')}
          </div>
        )}

        <div className="flex-1 min-h-0 flex">
          {/* Left rail nav */}
          <nav className="w-44 shrink-0 border-r border-slate-200 bg-slate-50 overflow-auto">
            <ul className="py-2">
              {SECTIONS.map((s) => {
                if (s.isGroup) {
                  return (
                    <li
                      key={s.key}
                      className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide font-semibold text-slate-500"
                    >
                      {s.label}
                    </li>
                  );
                }
                const isActive = activeSection === s.key;
                const isDirty = dirtyBuckets.has(s.key);
                return (
                  <li key={s.key}>
                    <button
                      type="button"
                      onClick={() => setActiveSection(s.key)}
                      className={
                        'w-full text-left text-xs px-3 py-1.5 flex items-center gap-2 ' +
                        (s.parent ? 'pl-6 ' : '') +
                        (isActive
                          ? 'bg-white border-l-2 border-amber-500 text-amber-800 font-semibold'
                          : 'text-slate-700 hover:bg-white border-l-2 border-transparent')
                      }
                    >
                      <span className="flex-1 truncate">{s.label}</span>
                      {isDirty && (
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"
                          title="Unsaved changes"
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Right pane */}
          <div className="flex-1 overflow-auto p-5 min-w-0">
            {activeSection === 'overview' && (
              <OverviewSection
                form={form}
                set={(p) => setSectioned('overview', p)}
                allOrgs={orgs}
                onJumpToOrg={onJumpToOrg}
              />
            )}
            {activeSection === 'system' && (
              <SystemSection
                form={form}
                set={(p) => setSectioned('system', p)}
                eligibleParentList={eligibleParentList}
              />
            )}
            {activeSection === 'contacts' && (
              <ContactsSection
                form={form}
                set={(p) => setSectioned('contacts', p)}
              />
            )}
            {activeSection === 'opp_refinance' && (
              <RefinanceSection
                form={form}
                set={(p) => setSectioned('opp_refinance', p)}
              />
            )}
            {activeSection === 'opp_insurance' && (
              <InsuranceSection
                form={form}
                set={(p) => setSectioned('opp_insurance', p)}
                onJumpToIntegrations={() => setActiveSection('integrations')}
              />
            )}
            {activeSection === 'opp_protection' && (
              <ProtectionSection
                form={form}
                set={(p) => setSectioned('opp_protection', p)}
              />
            )}
            {activeSection === 'payments' && (
              <PaymentsSection
                form={form}
                set={(p) => setSectioned('payments', p)}
              />
            )}
            {activeSection === 'integrations' && (
              <IntegrationsSection form={form} />
            )}
            {activeSection === 'relationship_types' && mode === 'edit' && (
              <RelationshipTypesSection orgId={form.id} />
            )}
            {activeSection === 'relationship_types' && mode === 'add' && (
              <div className="text-xs text-slate-500 italic">
                Relationship types are managed per-org — save the org first,
                then re-open to manage custom types.
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center gap-2 justify-end">
          <button
            type="button"
            onClick={handleClose}
            className="text-xs font-medium px-3 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-100 text-slate-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={mode === 'edit' && dirtyBuckets.size === 0}
            className="text-xs font-semibold px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 disabled:opacity-40 disabled:hover:bg-amber-600 text-white"
            title={
              mode === 'edit' && dirtyBuckets.size === 0
                ? 'No unsaved changes'
                : 'Save all dirty sections'
            }
          >
            {mode === 'add'
              ? 'Add org'
              : dirtyBuckets.size === 0
                ? 'Save changes'
                : `Save (${dirtyBuckets.size})`}
          </button>
        </div>

        {confirmCancel && (
          <ConfirmDialog
            title="Discard unsaved changes?"
            body={`You have unsaved changes in: ${dirtySectionLabels.join(', ')}. Closing now will lose them.`}
            confirmLabel="Discard"
            tone="rose"
            onConfirm={() => {
              setConfirmCancel(false);
              onClose();
            }}
            onClose={() => setConfirmCancel(false)}
          />
        )}
      </form>
    </Drawer>
  );
}

// ─── shared primitives (kept local to OrgRegistry — Drawer + ConfirmDialog
// are also used by UserDirectory; consolidating to a shared dialog file is
// the next 3-strikes lift) ─────────────────────────────────────────────────

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
          (wide ? 'w-full max-w-4xl' : 'w-full max-w-lg')
        }
        role="dialog"
        aria-modal="true"
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-amber-600 font-semibold mb-0.5">
              Super Admin · Org registry
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
        <div className="flex-1 min-h-0">{children}</div>
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

function StatusPill({ status }) {
  const cls =
    status === 'active'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : status === 'paused'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-50 text-slate-700 border-slate-200';
  return (
    <span
      className={
        'inline-flex text-[10px] font-medium px-2 py-0.5 rounded-full border ' + cls
      }
    >
      {status || 'unknown'}
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
