// Super-admin Status Mapping editor.
//
// Lets the Blinker-internal operator edit, per workflow, the relationship
// between:
//   * crm_opportunity   GHL pipeline (e.g. "VSC - Prospects")
//   * crm_stage         GHL stage within the pipeline (free-text + canon autocomplete)
//   * crm_status        coarse Open / Won / Lost / Abandon bucket (dropdown)
//   * platform_status   the status / event used inside mission-control + portals
//   * description       human-readable notes
//
// Storage: localStorage at `mc.status-mapping.v1`. Phase-2 swap point lives
// in src/lib/status-mapping.js (see `saveMapping`).
//
// Downstream consumers: CoPilotPane reads this mapping at mount
// (loadMapping → availableStatusesForWorkflow) and threads each
// workflow's `platform_status` list as the `availableStatuses` prop
// into protection-portal AgentView (Wave 13-fu-1) and insurance-portal
// AgentView (Wave 14-fu). Each portal's FORCE STATUS picker uses the
// override when set + non-empty, falls back to canon otherwise. Per-
// workflow shape:
//   * vsc       → display labels  (canon has no machine_id for VSC)
//   * insurance → machine_ids     (canon's `meta.machine_id`, dotted)
//   * refi      → display labels  (canon `statuses_summary` flat array)
//   * payments  → operator-defined (no canon block today)
// The downstream picker speaks each workflow's native shape, so what
// the operator types in `platform_status` here is what `workflow.status`
// (insurance) / `opportunity.status` (protection) will hold post-pick.
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCopy,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import {
  CRM_STATUS_OPTIONS,
  WORKFLOW_KEYS,
  WORKFLOW_LABELS,
  canonReference,
  canonSuggestionsForWorkflow,
  emptyRow,
  loadMapping,
  pipelinesForWorkflow,
  resetWorkflowToCanon,
  saveMapping,
} from '../../lib/status-mapping.js';
import { track } from 'blinker-platform/telemetry';

// Wave 14-fu CLOSED — `availableStatuses` is now wired end-to-end:
// this editor → mc.status-mapping.v1 → CoPilotPane.loadMapping() →
// availableStatusesForWorkflow(mapping, 'vsc' | 'insurance') →
// {Protection,Insurance}Embed `availableStatuses` prop →
// AgentView FORCE STATUS picker. Both portals accept the prop on their
// public surface (protection: Wave 13-fu-1, insurance: Wave 14-fu) and
// fall back to canon when the override is unset / empty. PostHog
// `mission_control.copilot.available_statuses_threaded { workflow,
// source: 'mapping'|'canon' }` fires once per CoPilot mount per
// supported kind for adoption tracking.

export function StatusMappingEditor({ onExit }) {
  const [mapping, setMapping] = useState(() => loadMapping());
  const [activeWorkflow, setActiveWorkflow] = useState('vsc');
  const [savedAt, setSavedAt] = useState(null);
  const [copyState, setCopyState] = useState('idle'); // idle | copied | error

  useEffect(() => {
    track('mission_control.status_mapping.opened', {
      version: mapping?._version || null,
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const canonDoc = canonReference();
  const rows = mapping[activeWorkflow] || [];
  const pipelines = pipelinesForWorkflow(activeWorkflow);
  const suggestions = useMemo(
    () => canonSuggestionsForWorkflow(activeWorkflow),
    [activeWorkflow],
  );

  function updateRow(idx, patch) {
    const next = rows.map((row, i) => (i === idx ? { ...row, ...patch } : row));
    setMapping((prev) => ({ ...prev, [activeWorkflow]: next }));
  }

  function addRow() {
    const next = [...rows, emptyRow(activeWorkflow)];
    setMapping((prev) => ({ ...prev, [activeWorkflow]: next }));
    track('mission_control.status_mapping.row_added', {
      workflow: activeWorkflow,
    });
  }

  function deleteRow(idx) {
    const next = rows.filter((_, i) => i !== idx);
    setMapping((prev) => ({ ...prev, [activeWorkflow]: next }));
    track('mission_control.status_mapping.row_deleted', {
      workflow: activeWorkflow,
    });
  }

  function onSave() {
    const stamped = saveMapping(mapping);
    setMapping(stamped);
    setSavedAt(stamped._modified_at);
    track('mission_control.status_mapping.saved', {
      workflow: activeWorkflow,
      vsc_count: stamped.vsc.length,
      refi_count: stamped.refi.length,
      insurance_count: stamped.insurance.length,
      payments_count: stamped.payments.length,
    });
  }

  function onResetWorkflow() {
    const next = resetWorkflowToCanon(mapping, activeWorkflow);
    setMapping(next);
    track('mission_control.status_mapping.reset_to_canon', {
      workflow: activeWorkflow,
    });
  }

  async function onCopyJson() {
    try {
      const text = JSON.stringify(mapping, null, 2);
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
      track('mission_control.status_mapping.exported', {
        size_bytes: text.length,
      });
      setTimeout(() => setCopyState('idle'), 1500);
    } catch (err) {
      console.warn('[status-mapping] clipboard copy failed:', err);
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 2000);
    }
  }

  const refiIsCanonGap =
    activeWorkflow === 'refi' && Array.isArray(canonDoc?.refi?.statuses_summary);
  const paymentsIsTbd = activeWorkflow === 'payments';

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="text-[10px] uppercase tracking-wide font-semibold text-amber-600 mb-1">
              Super Admin · Status Mapping
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Status mapping editor
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Map GHL pipelines + stages to platform statuses per workflow. Saves to
              browser localStorage; copy JSON to paste into{' '}
              <code className="font-mono text-[11px] bg-slate-100 px-1 py-0.5 rounded">
                canon/ghl-status.json
              </code>{' '}
              when you&apos;re ready to canonize.
            </p>
            <div className="text-[10px] text-slate-400 mt-1.5 font-mono">
              canon._version: {canonDoc?._version || 'unknown'} ·
              {mapping?._modified_at
                ? ` last saved: ${new Date(mapping._modified_at).toLocaleString()}`
                : ' not saved yet'}
            </div>
          </div>
          {onExit && (
            <button
              onClick={onExit}
              className="text-xs text-slate-500 hover:text-slate-800 px-2 py-1 rounded hover:bg-slate-100"
            >
              Back to Super Admin
            </button>
          )}
        </div>

        <WorkflowTabs
          activeWorkflow={activeWorkflow}
          onChange={(next) => {
            setActiveWorkflow(next);
            track('mission_control.status_mapping.workflow_switched', {
              workflow: next,
            });
          }}
          mapping={mapping}
        />

        {refiIsCanonGap && (
          <CanonGapNotice>
            Canon&apos;s <code className="font-mono">refi</code> block is a flat{' '}
            <code className="font-mono">statuses_summary</code> array (no{' '}
            <code className="font-mono">crm_stage</code> /{' '}
            <code className="font-mono">role</code> /{' '}
            <code className="font-mono">description</code> meta). Rows are seeded
            with empty crm_stage / crm_status / description — fill them in here
            and export to canon when ready. Tracked in canon{' '}
            <code className="font-mono">_TODO</code> as &quot;Resolve REFI ** TBD ** rows&quot;.
          </CanonGapNotice>
        )}

        {paymentsIsTbd && (
          <CanonGapNotice>
            Payments has no canon block today (Phase 1 stub — payment-processing-platform
            not yet folded in). Add rows here as the workflow takes shape.
          </CanonGapNotice>
        )}

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden mt-4">
          <MappingTable
            workflow={activeWorkflow}
            rows={rows}
            pipelines={pipelines}
            suggestions={suggestions}
            onChange={updateRow}
            onDelete={deleteRow}
          />

          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50">
            <button
              onClick={addRow}
              className="text-xs font-medium px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:border-blue-500 hover:text-blue-700 inline-flex items-center gap-1.5"
            >
              <Plus className="w-3 h-3" />
              Add row
            </button>
            <button
              onClick={onResetWorkflow}
              className="text-xs font-medium px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:border-slate-400 inline-flex items-center gap-1.5"
              title={`Replace ${WORKFLOW_LABELS[activeWorkflow]} rows with the canon seed`}
            >
              <RotateCcw className="w-3 h-3" />
              Reset to canon
            </button>

            <div className="ml-auto flex items-center gap-2">
              {savedAt && (
                <span className="text-[11px] text-emerald-600 inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  Saved at {new Date(savedAt).toTimeString().slice(0, 8)}
                </span>
              )}
              <button
                onClick={onCopyJson}
                className="text-xs font-medium px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:border-blue-500 hover:text-blue-700 inline-flex items-center gap-1.5"
                title="Copy the full mapping JSON to clipboard for paste into canon/ghl-status.json"
              >
                <ClipboardCopy className="w-3 h-3" />
                {copyState === 'copied'
                  ? 'Copied'
                  : copyState === 'error'
                    ? 'Copy failed'
                    : 'Export JSON'}
              </button>
              <button
                onClick={onSave}
                className="text-xs font-semibold px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1.5"
              >
                <Save className="w-3 h-3" />
                Save mapping
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 text-[11px] text-slate-500 leading-relaxed">
          Phase 2 swap: replace{' '}
          <code className="font-mono">localStorage</code> with{' '}
          <code className="font-mono">blinkerApi.statusMapping.upsert()</code>.
          See <code className="font-mono">src/lib/status-mapping.js</code>.
        </div>
      </div>
    </div>
  );
}

function WorkflowTabs({ activeWorkflow, onChange, mapping }) {
  return (
    <div className="flex items-center border-b border-slate-200">
      {WORKFLOW_KEYS.map((key) => {
        const active = key === activeWorkflow;
        const count = mapping[key]?.length ?? 0;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={
              'px-4 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ' +
              (active
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-800')
            }
          >
            {WORKFLOW_LABELS[key]}
            <span
              className={
                'ml-1.5 inline-flex items-center px-1.5 py-0 rounded text-[10px] ' +
                (active ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500')
              }
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function MappingTable({ workflow, rows, pipelines, suggestions, onChange, onDelete }) {
  if (rows.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <div className="text-sm text-slate-500 mb-2">
          No rows for {WORKFLOW_LABELS[workflow]}.
        </div>
        <div className="text-xs text-slate-400">
          Click <span className="font-medium text-slate-600">Add row</span> below to
          start mapping, or <span className="font-medium text-slate-600">Reset to canon</span>{' '}
          to seed from <code className="font-mono">canon/ghl-status.json</code>.
        </div>
      </div>
    );
  }

  // Stable IDs for the canon-suggestion datalists. Datalist IDs must be
  // unique within the document; scoping by workflow + column is enough.
  const stageListId = `mc-stage-suggest-${workflow}`;
  const platformListId = `mc-platform-suggest-${workflow}`;

  return (
    <div className="overflow-x-auto">
      <datalist id={stageListId}>
        {suggestions.crm_stages.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <datalist id={platformListId}>
        {suggestions.platform_statuses.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <table className="w-full text-xs">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <Th>crm_opportunity</Th>
            <Th>crm_stage</Th>
            <Th>crm_status</Th>
            <Th>platform_status</Th>
            <Th>description</Th>
            <Th className="w-10"> </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx} className="border-b border-slate-100 last:border-b-0 align-top">
              <Td>
                {pipelines.length > 0 ? (
                  <select
                    value={row.crm_opportunity || ''}
                    onChange={(e) =>
                      onChange(idx, { crm_opportunity: e.target.value })
                    }
                    className="w-full text-xs border border-slate-200 rounded px-2 py-1 bg-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="">— select pipeline —</option>
                    {pipelines.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                    {/* Allow legacy values not in canon to round-trip */}
                    {row.crm_opportunity && !pipelines.includes(row.crm_opportunity) && (
                      <option value={row.crm_opportunity}>{row.crm_opportunity}</option>
                    )}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={row.crm_opportunity || ''}
                    onChange={(e) =>
                      onChange(idx, { crm_opportunity: e.target.value })
                    }
                    placeholder="No canon pipelines — type one"
                    className="w-full text-xs border border-slate-200 rounded px-2 py-1 bg-white focus:outline-none focus:border-blue-500"
                  />
                )}
              </Td>
              <Td>
                <input
                  type="text"
                  list={stageListId}
                  value={row.crm_stage || ''}
                  onChange={(e) => onChange(idx, { crm_stage: e.target.value })}
                  className="w-full text-xs border border-slate-200 rounded px-2 py-1 bg-white focus:outline-none focus:border-blue-500"
                />
              </Td>
              <Td>
                <select
                  value={row.crm_status || 'Open'}
                  onChange={(e) => onChange(idx, { crm_status: e.target.value })}
                  className="w-full text-xs border border-slate-200 rounded px-2 py-1 bg-white focus:outline-none focus:border-blue-500"
                >
                  {CRM_STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Td>
              <Td>
                <input
                  type="text"
                  list={platformListId}
                  value={row.platform_status || ''}
                  onChange={(e) =>
                    onChange(idx, { platform_status: e.target.value })
                  }
                  className="w-full text-xs border border-slate-200 rounded px-2 py-1 bg-white focus:outline-none focus:border-blue-500 font-mono"
                />
              </Td>
              <Td>
                <textarea
                  value={row.description || ''}
                  onChange={(e) => onChange(idx, { description: e.target.value })}
                  rows={2}
                  className="w-full text-xs border border-slate-200 rounded px-2 py-1 bg-white focus:outline-none focus:border-blue-500 leading-snug"
                />
              </Td>
              <Td>
                <button
                  onClick={() => onDelete(idx)}
                  className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                  title="Delete row"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className }) {
  return (
    <th
      className={
        'text-left text-[10px] uppercase tracking-wider font-semibold text-slate-500 px-3 py-2 ' +
        (className || '')
      }
    >
      {children}
    </th>
  );
}

function Td({ children, className }) {
  return (
    <td className={'px-3 py-2 align-top ' + (className || '')}>{children}</td>
  );
}

function CanonGapNotice({ children }) {
  return (
    <div className="mt-4 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 flex items-start gap-2">
      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <div>
        <span className="font-semibold">Canon gap:</span> {children}
      </div>
    </div>
  );
}
