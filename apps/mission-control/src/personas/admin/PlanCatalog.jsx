// PlanCatalog — admin tab for managing plan presentation defaults + per-org
// plan overrides. Wave 27 v3.0.8 Tasks 1 + 2.
//
// Two sub-tabs:
//   1. Defaults — super-admin-only edit of plan_level_defaults (tagline +
//      coverage HTML) for Good / Better / Best.
//   2. Plans — table view of all global catalog entries UNION'd with this
//      org's plan_overrides. Includes the DocuSeal per-plan default editor.
//
// Phase 1: edits are session-only (same pattern as IntegrationDrawer + OrgConfiguration).
// No canon JSON mutation. Phase 2 will hit server endpoints.

import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import planMappings from '../../constants/canon/plan-mappings.json';
import { listPlanCatalog } from 'blinker-platform/utils';
import { track } from 'blinker-platform/telemetry';
import { Tooltip } from '../../shared/Tooltip.jsx';

// ─── Sub-tab control ────────────────────────────────────────────────────────

const SUB_TABS = [
  { key: 'defaults', label: 'Defaults' },
  { key: 'plans',    label: 'Plans' },
];

// ─── Shared helpers ──────────────────────────────────────────────────────────

const LEVEL_LABELS = { good: 'Good', better: 'Better', best: 'Best' };
const LEVEL_ORDER  = ['good', 'better', 'best'];

const LEVEL_BADGE = {
  good:   'bg-sky-50 text-sky-700 border-sky-200',
  better: 'bg-violet-50 text-violet-700 border-violet-200',
  best:   'bg-emerald-50 text-emerald-700 border-emerald-200',
};

function LevelBadge({ level }) {
  if (!level) return null;
  return (
    <span className={'inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border ' + (LEVEL_BADGE[level] || 'bg-slate-50 text-slate-700 border-slate-200')}>
      {LEVEL_LABELS[level] || level}
    </span>
  );
}

function Phase1Banner() {
  return (
    <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4">
      Phase 1: edits are session-only. Phase 2 will persist to the server.
    </div>
  );
}

// ─── Defaults sub-tab ────────────────────────────────────────────────────────

// Accordion for a single PlanLevel (Good / Better / Best).
function LevelAccordion({ level, defaults, localOverride, onChange, onReset }) {
  const [open, setOpen] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const tagline = localOverride?.tagline_default ?? defaults?.tagline_default ?? '';
  const html    = localOverride?.plan_coverage_default_html ?? defaults?.plan_coverage_default_html ?? '';
  const previewSrc = html.replace(/{{SAMPLE_AGREEMENT_URL}}/g, '#preview');

  function setTagline(val) {
    onChange(level, { ...localOverride, tagline_default: val });
    track('mc.admin.plan_catalog.default_updated', { level, field: 'tagline_default' });
  }

  function setHtml(val) {
    onChange(level, { ...localOverride, plan_coverage_default_html: val });
    track('mc.admin.plan_catalog.default_updated', { level, field: 'plan_coverage_default_html' });
  }

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <LevelBadge level={level} />
          <span className="text-sm font-semibold text-slate-800">{LEVEL_LABELS[level]}</span>
          {localOverride && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
              modified
            </span>
          )}
        </div>
        {open
          ? <ChevronDown className="w-4 h-4 text-slate-400" />
          : <ChevronRight className="w-4 h-4 text-slate-400" />}
      </button>

      {open && (
        <div className="border-t border-slate-200 p-4 space-y-4">
          {/* Tagline */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Tagline (card subtitle)
            </label>
            <input
              type="text"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              onBlur={() => track('mc.admin.plan_catalog.default_updated', { level, field: 'tagline_default' })}
              className="w-full text-xs border border-slate-200 rounded px-2.5 py-1.5 bg-white focus:outline-none focus:border-violet-500"
              placeholder="Inline card subtitle shown below the plan level badge"
            />
          </div>

          {/* Coverage HTML */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-slate-700">Coverage HTML</label>
              <button
                type="button"
                onClick={() => setShowPreview((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-600 hover:text-violet-800"
              >
                {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                {showPreview ? 'Edit' : 'Preview'}
              </button>
            </div>
            {showPreview ? (
              <iframe
                srcDoc={previewSrc}
                sandbox="allow-same-origin"
                className="w-full border border-slate-200 rounded bg-white"
                style={{ height: 600 }}
                title={`${LEVEL_LABELS[level]} coverage preview`}
              />
            ) : (
              <textarea
                rows={20}
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                className="w-full text-xs font-mono border border-slate-200 rounded px-2.5 py-1.5 bg-white focus:outline-none focus:border-violet-500 resize-y"
                spellCheck={false}
                placeholder="<div>...HTML content for the 'See what&apos;s covered' modal...</div>"
              />
            )}
            <div className="text-[10px] text-slate-400 mt-1">
              Use <code className="font-mono bg-slate-100 px-1 rounded">{'{{SAMPLE_AGREEMENT_URL}}'}</code> as a placeholder — replaced with the plan's sample agreement URL at render time.
            </div>
          </div>

          {/* Reset + save row */}
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => onReset(level)}
              className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800"
            >
              <RotateCcw className="w-3 h-3" />
              Reset to canon
            </button>
            <div className="text-[10px] text-slate-400 italic">
              Changes are session-only (Phase 1)
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DefaultsTab({ org, persona }) {
  const isSuper = persona === 'super_admin';
  // localDefaults: { good: {tagline_default, plan_coverage_default_html} | null, ... }
  const [localDefaults, setLocalDefaults] = useState({});

  function handleChange(level, overrideBlock) {
    setLocalDefaults((prev) => ({ ...prev, [level]: overrideBlock }));
  }

  function handleReset(level) {
    setLocalDefaults((prev) => {
      const next = { ...prev };
      delete next[level];
      return next;
    });
  }

  if (!isSuper) {
    return (
      <div>
        <div className="text-[12px] text-slate-600 bg-slate-100 border border-slate-200 rounded px-3 py-2 mb-4">
          Defaults are managed by super-admins. Contact a super-admin to update the default tagline or coverage HTML for each plan level.
        </div>
        {LEVEL_ORDER.map((level) => {
          const d = planMappings.plan_level_defaults?.[level] || {};
          return (
            <div key={level} className="border border-slate-200 rounded-xl overflow-hidden mb-3">
              <div className="flex items-center gap-2 px-4 py-3 bg-slate-50">
                <LevelBadge level={level} />
                <span className="text-sm font-semibold text-slate-800">{LEVEL_LABELS[level]}</span>
              </div>
              <div className="border-t border-slate-200 p-4 space-y-3">
                <div>
                  <div className="text-xs font-semibold text-slate-500 mb-1">Tagline</div>
                  <div className="text-xs text-slate-700 bg-white border border-slate-200 rounded px-2.5 py-1.5">
                    {d.tagline_default || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-500 mb-1">Coverage HTML (read-only)</div>
                  <textarea
                    rows={6}
                    readOnly
                    value={d.plan_coverage_default_html || ''}
                    className="w-full text-xs font-mono border border-slate-200 rounded px-2.5 py-1.5 bg-slate-50 text-slate-500 resize-none"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div>
      <Phase1Banner />
      {LEVEL_ORDER.map((level) => (
        <LevelAccordion
          key={level}
          level={level}
          defaults={planMappings.plan_level_defaults?.[level] || {}}
          localOverride={localDefaults[level] || null}
          onChange={handleChange}
          onReset={handleReset}
          orgId={org?.id}
        />
      ))}
    </div>
  );
}

// ─── Plans sub-tab ───────────────────────────────────────────────────────────

// Coverage HTML drawer (side panel) for a single plan.
function CoverageDrawer({ planKey, html, onClose, onSave }) {
  const [localHtml, setLocalHtml] = useState(html || '');
  const [showPreview, setShowPreview] = useState(false);
  const previewSrc = localHtml.replace(/{{SAMPLE_AGREEMENT_URL}}/g, '#preview');

  return (
    <div className="fixed inset-0 z-40 flex">
      <button
        type="button"
        aria-label="Close coverage drawer"
        onClick={onClose}
        className="flex-1 bg-slate-900/40"
      />
      <div className="w-full max-w-2xl bg-white shadow-2xl flex flex-col h-full" role="dialog" aria-modal="true">
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-violet-600 font-semibold mb-0.5">
              Admin · Plan Catalog
            </div>
            <div className="text-lg font-semibold text-slate-900 leading-tight">Coverage HTML</div>
            <div className="text-xs text-slate-500 font-mono">{planKey}</div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-3 border-b border-slate-100 flex items-center justify-between">
          <div className="text-[11px] text-slate-500">
            Use <code className="font-mono bg-slate-100 px-1 rounded">{'{{SAMPLE_AGREEMENT_URL}}'}</code> as a placeholder.
          </div>
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-600 hover:text-violet-800"
          >
            {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {showPreview ? 'Edit' : 'Preview'}
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {showPreview ? (
            <iframe
              srcDoc={previewSrc}
              sandbox="allow-same-origin"
              className="w-full border border-slate-200 rounded bg-white"
              style={{ height: 600 }}
              title="Coverage HTML preview"
            />
          ) : (
            <textarea
              rows={24}
              value={localHtml}
              onChange={(e) => setLocalHtml(e.target.value)}
              className="w-full text-xs font-mono border border-slate-200 rounded px-2.5 py-1.5 bg-white focus:outline-none focus:border-violet-500 resize-y"
              spellCheck={false}
              placeholder="<div>...coverage HTML for this specific plan...</div>"
            />
          )}
        </div>

        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="text-xs font-medium px-3 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-100 text-slate-700"
          >
            Cancel
          </button>
          <button
            onClick={() => { onSave(localHtml); onClose(); }}
            className="text-xs font-semibold px-3 py-1.5 rounded inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
          >
            <Save className="w-3 h-3" />
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

// "Add plan" modal.
function AddPlanModal({ onClose, onSubmit }) {
  const [tpa, setTpa] = useState('');
  const [ptc, setPtc] = useState('VSC');
  const [plan, setPlan] = useState('');

  function submit(e) {
    e.preventDefault();
    if (!tpa.trim() || !plan.trim()) return;
    const key = `${tpa.trim()}::${ptc.trim() || 'VSC'}::${plan.trim()}`;
    onSubmit(key, { tpa_code: tpa.trim(), product_type_code: ptc.trim() || 'VSC', plan_code: plan.trim() });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-slate-900/40" />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-sm p-6" role="dialog" aria-modal="true">
        <div className="text-sm font-semibold text-slate-900 mb-1">Add plan override</div>
        <div className="text-[11px] text-slate-500 mb-4">
          Use the values returned by the rater (StoneEagle GetRates or equivalent).
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">TpaCode</label>
            <input
              type="text"
              value={tpa}
              onChange={(e) => setTpa(e.target.value)}
              placeholder="e.g. OMGA"
              required
              className="w-full text-xs border border-slate-200 rounded px-2.5 py-1.5 bg-white focus:outline-none focus:border-violet-500 font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">ProductTypeCode</label>
            <input
              type="text"
              value={ptc}
              onChange={(e) => setPtc(e.target.value)}
              placeholder="e.g. VSC, GAP, MNT"
              className="w-full text-xs border border-slate-200 rounded px-2.5 py-1.5 bg-white focus:outline-none focus:border-violet-500 font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">PlanCode</label>
            <input
              type="text"
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              placeholder="e.g. 51"
              required
              className="w-full text-xs border border-slate-200 rounded px-2.5 py-1.5 bg-white focus:outline-none focus:border-violet-500 font-mono"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-medium px-3 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-100 text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="text-xs font-semibold px-3 py-1.5 rounded bg-violet-600 hover:bg-violet-700 text-white"
            >
              Add
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// DocuSeal per-org fallback key-value editor.
function DocusealDefaultEditor({ initialMap, onChange }) {
  const [open, setOpen] = useState(false);
  // rows: [ { key: string, templateId: string } ]
  const [rows, setRows] = useState(() =>
    Object.entries(initialMap || {})
      .filter(([k]) => !k.startsWith('_'))
      .map(([k, v]) => ({ key: k, templateId: v || '' }))
  );

  function updateRow(idx, field, val) {
    setRows((prev) => {
      const next = prev.map((r, i) => i === idx ? { ...r, [field]: val } : r);
      const map = Object.fromEntries(next.map((r) => [r.key, r.templateId]));
      onChange(map);
      track('mc.admin.plan_catalog.docuseal_default_updated', { key: next[idx]?.key });
      return next;
    });
  }

  function removeRow(idx) {
    setRows((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      const map = Object.fromEntries(next.map((r) => [r.key, r.templateId]));
      onChange(map);
      return next;
    });
  }

  function addRow() {
    setRows((prev) => [...prev, { key: '', templateId: '' }]);
  }

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden mb-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors"
      >
        <div className="text-xs font-semibold text-slate-700">
          Per-org DocuSeal defaults
          <span className="ml-2 text-[10px] text-slate-500 font-normal">
            ({rows.length} {rows.length === 1 ? 'entry' : 'entries'})
          </span>
        </div>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
      </button>

      {open && (
        <div className="border-t border-slate-200 p-4">
          <div className="text-[11px] text-slate-500 mb-3">
            When a plan doesn&apos;t have a specific DocuSeal template ID in the catalog, fall back to this map for this org. Key = plan key (e.g. <code className="font-mono bg-slate-100 px-1 rounded">OMGA::VSC::51</code>).
          </div>
          {rows.length === 0 && (
            <div className="text-[11px] text-slate-400 italic mb-3">No entries. Click &quot;Add row&quot; to set a fallback template.</div>
          )}
          <div className="space-y-2">
            {rows.map((row, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  value={row.key}
                  onChange={(e) => updateRow(idx, 'key', e.target.value)}
                  placeholder="PlanKey (e.g. OMGA::VSC::51)"
                  className="flex-1 text-xs font-mono border border-slate-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:border-violet-500"
                />
                <input
                  type="text"
                  value={row.templateId}
                  onChange={(e) => updateRow(idx, 'templateId', e.target.value)}
                  placeholder="DocuSeal Template ID"
                  className="flex-1 text-xs font-mono border border-slate-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:border-violet-500"
                />
                <button
                  type="button"
                  onClick={() => removeRow(idx)}
                  className="p-1.5 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addRow}
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-800"
          >
            <Plus className="w-3.5 h-3.5" />
            Add row
          </button>
        </div>
      )}
    </div>
  );
}

// Plan codes known to be monthly-membership products (secondary signal — telemetry only).
const MONTHLY_PLAN_CODE_ALLOWLIST = new Set(
  planMappings.monthly_membership?.secondary_signals?.plan_code_allowlist || []
);

// Single row in the Plans table.
function PlanRow({ rowKey, entry, orgOverride, isSuper, onUpdateOverride, onResetOverride, onDeleteOverride, onOpenHtml }) {
  const hasOverride = !!orgOverride;
  const base = entry || {};
  const ovr  = orgOverride || {};

  // Merged display values (override wins)
  const displayLevel = ovr.plan_level       || base.plan_level       || '';
  const displayTitle = ovr.plan_title       || base.plan_title       || '';
  const displayUrl   = ovr.sample_agreement_url || base.sample_agreement_url || '';
  const displayTpl   = ovr.docuseal_template_id || base.docuseal_template_id || '';

  const badgeType = !entry
    ? 'org-only'
    : hasOverride
    ? 'override'
    : 'default';

  const BADGE = {
    'org-only': 'bg-amber-50 text-amber-700 border-amber-200',
    'override': 'bg-violet-50 text-violet-700 border-violet-200',
    'default':  'bg-slate-50 text-slate-600 border-slate-200',
  };
  const BADGE_LABEL = { 'org-only': 'Org-only', 'override': 'Override', 'default': 'Default' };

  // Local edit state for inline cells
  const [localLevel, setLocalLevel] = useState(displayLevel);
  const [localTitle, setLocalTitle] = useState(displayTitle);
  const [localUrl,   setLocalUrl]   = useState(displayUrl);
  const [localTpl,   setLocalTpl]   = useState(displayTpl);

  function flush(field, value) {
    const next = {
      ...(orgOverride || base),
      plan_level:            localLevel,
      plan_title:            localTitle,
      sample_agreement_url:  localUrl,
      docuseal_template_id:  localTpl,
      [field]: value,
    };
    onUpdateOverride(rowKey, next);
    track('mc.admin.plan_catalog.plan_override_updated', { key: rowKey, field });
  }

  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50 group">
      <td className="px-3 py-2 text-xs font-mono text-slate-700 whitespace-nowrap">
        {rowKey}
        <span className={'ml-1.5 inline-flex text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ' + BADGE[badgeType]}>
          {BADGE_LABEL[badgeType]}
        </span>
      </td>
      <td className="px-3 py-2 text-xs text-slate-600 font-mono">{base.tpa_code || ovr.tpa_code || '—'}</td>
      <td className="px-3 py-2 text-xs text-slate-600 font-mono">{base.product_type_code || ovr.product_type_code || '—'}</td>
      <td className="px-3 py-2 text-xs text-slate-600 font-mono">
        {base.plan_code || ovr.plan_code || '—'}
        {MONTHLY_PLAN_CODE_ALLOWLIST.has(base.plan_code || ovr.plan_code || '') && (
          <span className="ml-1.5 inline-flex text-[9px] font-semibold px-1.5 py-0.5 rounded-full border bg-cyan-50 text-cyan-700 border-cyan-200 whitespace-nowrap">
            Monthly
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        <select
          value={localLevel}
          onChange={(e) => setLocalLevel(e.target.value)}
          onBlur={(e) => flush('plan_level', e.target.value)}
          className="text-xs border border-slate-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:border-violet-500"
        >
          <option value="">— use default</option>
          <option value="good">Good</option>
          <option value="better">Better</option>
          <option value="best">Best</option>
        </select>
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          value={localTitle}
          onChange={(e) => setLocalTitle(e.target.value)}
          onBlur={(e) => flush('plan_title', e.target.value)}
          placeholder={base.plan_title || '—'}
          className="text-xs border border-slate-200 rounded px-2 py-1 bg-white focus:outline-none focus:border-violet-500 w-36"
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          value={localUrl}
          onChange={(e) => setLocalUrl(e.target.value)}
          onBlur={(e) => flush('sample_agreement_url', e.target.value)}
          placeholder="https://…"
          className="text-xs border border-slate-200 rounded px-2 py-1 bg-white focus:outline-none focus:border-violet-500 w-40"
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          value={localTpl}
          onChange={(e) => setLocalTpl(e.target.value)}
          onBlur={(e) => flush('docuseal_template_id', e.target.value)}
          placeholder="tpl_…"
          className="text-xs border border-slate-200 rounded px-2 py-1 bg-white focus:outline-none focus:border-violet-500 w-28"
        />
      </td>
      <td className="px-3 py-2">
        <button
          type="button"
          onClick={() => onOpenHtml(rowKey, ovr.plan_coverage_html || base.plan_coverage_html || '')}
          className="text-xs font-medium text-violet-600 hover:text-violet-800 whitespace-nowrap"
        >
          Edit HTML…
        </button>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          {hasOverride && (
            <Tooltip content="Remove override (restore catalog value)" placement="top-right">
              <button
                type="button"
                onClick={() => onResetOverride(rowKey)}
                className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </Tooltip>
          )}
          {hasOverride && badgeType === 'org-only' && (
            <Tooltip content="Delete org-only plan" placement="top-right">
              <button
                type="button"
                onClick={() => onDeleteOverride(rowKey)}
                className="p-1 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </Tooltip>
          )}
          {isSuper && (
            <Tooltip content="Save to global catalog (Phase 2)" placement="top-right">
              <button
                type="button"
                disabled
                className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"
              >
                Global…
              </button>
            </Tooltip>
          )}
        </div>
      </td>
    </tr>
  );
}

function PlansTab({ org, persona }) {
  const isSuper = persona === 'super_admin';

  // Session-only org object to mutate overrides against.
  const [localOrg, setLocalOrg] = useState(() => org || {});

  // Keep localOrg in sync when prop changes (persona switch etc.)
  // Intentionally not adding org to deps — this is a Phase 1 local edit model.

  const catalogEntries = useMemo(() => listPlanCatalog(), []);
  const orgOverrides   = useMemo(
    () => Object.fromEntries(
      Object.entries(localOrg?.plan_overrides || {}).filter(([k]) => !k.startsWith('_'))
    ),
    [localOrg]
  );

  // Merge catalog + org_overrides into unified row set
  const allKeys = useMemo(() => {
    const set = new Set([
      ...catalogEntries.map((e) => e.key),
      ...Object.keys(orgOverrides),
    ]);
    return [...set].sort();
  }, [catalogEntries, orgOverrides]);

  const catalogMap = useMemo(
    () => Object.fromEntries(catalogEntries.map((e) => [e.key, e])),
    [catalogEntries]
  );

  // DocuSeal per-org map
  const [docusealMap, setDocusealMap] = useState(
    () => localOrg?.integrations?.docuseal?.credentials?.template_id_by_plan || {}
  );

  // Coverage HTML drawer
  const [htmlDrawer, setHtmlDrawer] = useState(null); // { key, html }
  // Add plan modal
  const [showAddModal, setShowAddModal] = useState(false);

  function updateOverride(key, newEntry) {
    setLocalOrg((prev) => ({
      ...prev,
      plan_overrides: { ...(prev.plan_overrides || {}), [key]: newEntry },
    }));
  }

  function resetOverride(key) {
    setLocalOrg((prev) => {
      const next = { ...(prev.plan_overrides || {}) };
      delete next[key];
      return { ...prev, plan_overrides: next };
    });
  }

  function deleteOverride(key) {
    resetOverride(key);
  }

  function saveHtml(key, html) {
    const existing = orgOverrides[key] || catalogMap[key] || {};
    updateOverride(key, { ...existing, plan_coverage_html: html });
    track('mc.admin.plan_catalog.plan_override_updated', { key, field: 'plan_coverage_html' });
  }

  function handleAddPlan(key, baseData) {
    if (!orgOverrides[key] && !catalogMap[key]) {
      updateOverride(key, { ...baseData, plan_level: 'good', plan_title: '' });
    }
  }

  const overrideCount = Object.keys(orgOverrides).length;

  if (allKeys.length === 0) {
    return (
      <div>
        <Phase1Banner />
        <DocusealDefaultEditor initialMap={docusealMap} onChange={setDocusealMap} />
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
          <ShieldCheck className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <div className="text-sm font-semibold text-slate-700 mb-1">No plans catalogued yet</div>
          <div className="text-xs text-slate-500 max-w-md mx-auto mb-4">
            When a rater returns a plan that isn&apos;t catalogued, it shows up in the customer-facing flow as <em>Good</em> with the rater&apos;s PlanDescription as the title. Catalog plans here to customize their level, title, and coverage description.
          </div>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded bg-violet-600 hover:bg-violet-700 text-white"
          >
            <Plus className="w-3.5 h-3.5" />
            Add first plan
          </button>
        </div>
        {showAddModal && <AddPlanModal onClose={() => setShowAddModal(false)} onSubmit={handleAddPlan} />}
      </div>
    );
  }

  return (
    <div>
      <Phase1Banner />
      <DocusealDefaultEditor orgId={org?.id} initialMap={docusealMap} onChange={setDocusealMap} />

      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] text-slate-500">
          {catalogEntries.length} catalogued · {overrideCount} this-org override{overrideCount !== 1 ? 's' : ''}
        </div>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded border border-violet-300 bg-violet-50 hover:bg-violet-100 text-violet-700"
        >
          <Plus className="w-3.5 h-3.5" />
          Add plan
        </button>
      </div>

      <div className="overflow-x-auto bg-white border border-slate-200 rounded-xl shadow-sm">
        <table className="min-w-full text-left">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              {['Plan Key', 'TpaCode', 'PTC', 'Plan Code', 'Level', 'Title', 'Sample Agreement URL', 'DocuSeal Tpl', 'Coverage', 'Actions'].map((h) => (
                <th key={h} className="px-3 py-2 text-[10px] uppercase tracking-wide font-semibold text-slate-500 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allKeys.map((key) => (
              <PlanRow
                key={key}
                rowKey={key}
                entry={catalogMap[key] || null}
                orgOverride={orgOverrides[key] || null}
                isSuper={isSuper}
                onUpdateOverride={updateOverride}
                onResetOverride={resetOverride}
                onDeleteOverride={deleteOverride}
                onOpenHtml={(k, html) => setHtmlDrawer({ key: k, html })}
              />
            ))}
          </tbody>
        </table>
      </div>

      {htmlDrawer && (
        <CoverageDrawer
          planKey={htmlDrawer.key}
          html={htmlDrawer.html}
          onClose={() => setHtmlDrawer(null)}
          onSave={(html) => saveHtml(htmlDrawer.key, html)}
        />
      )}
      {showAddModal && <AddPlanModal onClose={() => setShowAddModal(false)} onSubmit={handleAddPlan} />}
    </div>
  );
}

// ─── Top-level export ────────────────────────────────────────────────────────

export function PlanCatalog({ org, persona = 'admin' }) {
  const [activeTab, setActiveTab] = useState('defaults');

  return (
    <div>
      {/* Sub-tab bar */}
      <div className="flex items-center gap-1 mb-6 border-b border-slate-200">
        {SUB_TABS.map((t) => {
          const active = t.key === activeTab;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={
                'px-4 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors ' +
                (active
                  ? 'border-violet-600 text-violet-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800')
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'defaults' && <DefaultsTab org={org} persona={persona} />}
      {activeTab === 'plans'    && <PlansTab    org={org} persona={persona} />}
    </div>
  );
}
