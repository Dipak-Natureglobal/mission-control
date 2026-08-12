// Phase 1 prototype persistence. Phase 2: replace with blinkerApi.statusMapping.upsert().
//
// Canonical status-mapping editor model. The super-admin Status Mapping
// editor reads canon/ghl-status.json as a seed, lets the operator edit
// rows per workflow (vsc / refi / insurance / payments), and writes the
// result to localStorage at key `mc.status-mapping.v1` for demo / paste-
// back-to-canon purposes.
//
// Why this lives in src/lib (not src/personas/super):
//   The shape returned by `loadMapping()` is the same one a future Phase 2
//   read of `blinkerApi.statusMapping.get()` will return; co-locating with
//   contact-storage.js keeps all "Phase 1 localStorage compromise" code in
//   one folder. A future canonization swap touches this file + DevPanel.
//
// Shape on disk:
//   {
//     _version: <ISO timestamp from canon._version when seeded>,
//     _modified_at: <ISO timestamp of last save>,
//     vsc: [{ crm_opportunity, crm_stage, crm_status, platform_status, description }],
//     refi: [...],
//     insurance: [...],
//     payments: []
//   }
//
// Notes:
//   * REFI canon section is structured as `statuses_summary` (a flat array
//     of label strings) rather than an object map of {crm_stage, role, ...}
//     like vsc + insurance. The seeder handles this asymmetry by emitting
//     one row per label with empty crm_stage / crm_status / description so
//     the operator can fill in the gaps. This is the documented canon gap.
//   * VSC canon entries don't carry a `crm_status` field today; we infer
//     Open / Won / Lost / Abandon from `crm_stage` for the seed, then let
//     the operator override.
//   * Payments has no canon block today (Phase 1 stub) — seeded as an
//     empty array.
//   * `crm_opportunity` is seeded by mapping the canon `pipeline` short
//     name (e.g. "Prospects") onto the workflow's `_pipelines` array
//     (e.g. ["VSC - Prospects", "VSC - Onboarding", "VSC - Clients"]).
//     Match is by suffix; unknowns fall back to the first pipeline.

import canonStatus from '../constants/canon/ghl-status.json';

const STORAGE_KEY = 'mc.status-mapping.v1';

export const WORKFLOW_KEYS = ['vsc', 'refi', 'insurance', 'payments'];

export const WORKFLOW_LABELS = {
  vsc: 'VSC / Protection',
  refi: 'Refi',
  insurance: 'Insurance',
  payments: 'Payments',
};

export const CRM_STATUS_OPTIONS = ['Open', 'Won', 'Lost', 'Abandon'];

// Best-effort mapping of canon's coarse `crm_stage` value into the four
// canonical CRM status buckets (Open / Won / Lost / Abandon). Won = closed
// successful, Lost = closed unsuccessful, Abandon = consumer abandonment,
// Open = anything in flight. Default Open keeps the seed conservative;
// operator edits override per row.
function inferCrmStatus(crmStage) {
  if (!crmStage) return 'Open';
  const s = String(crmStage).toLowerCase();
  if (/won|paid in full|payment success|active|funded/.test(s)) return 'Won';
  if (/lost|cancelled|declined/.test(s)) return 'Lost';
  if (/abandon/.test(s)) return 'Abandon';
  return 'Open';
}

// Map canon's short pipeline name (e.g. "Prospects") onto the workflow's
// _pipelines array (e.g. "VSC - Prospects"). Suffix-match is intentional —
// canon writes "Prospects" inside a vsc-rooted entry; the displayed label
// is the full "VSC - Prospects" form from the same workflow's _pipelines.
function resolveCrmOpportunity(pipelineShort, pipelinesArray) {
  if (!pipelinesArray || pipelinesArray.length === 0) return '';
  if (!pipelineShort) return pipelinesArray[0];
  const match = pipelinesArray.find((p) =>
    p.toLowerCase().endsWith(String(pipelineShort).toLowerCase()),
  );
  return match || pipelinesArray[0];
}

// Build the seed rows from canon for a given workflow. Returns an array
// of { crm_opportunity, crm_stage, crm_status, platform_status, description }.
function seedRowsForWorkflow(workflow) {
  const block = canonStatus?.[workflow];
  if (!block) return [];
  const pipelines = Array.isArray(block._pipelines) ? block._pipelines : [];

  // VSC + Insurance: structured `statuses` map
  if (block.statuses && typeof block.statuses === 'object') {
    return Object.entries(block.statuses).map(([label, meta]) => {
      const crmStage = meta?.crm_stage ?? '';
      // Insurance carries machine_id; vsc does not (canon TODO). Editor
      // shows machine_id for insurance, label for vsc — matches what the
      // FORCE STATUS picker would expect downstream.
      const platformStatus = meta?.machine_id || label;
      return {
        crm_opportunity: resolveCrmOpportunity(meta?.pipeline, pipelines),
        crm_stage: crmStage || '',
        crm_status: inferCrmStatus(crmStage),
        platform_status: platformStatus,
        description: meta?.description || '',
      };
    });
  }

  // REFI: flat `statuses_summary` array (canon gap — no per-status meta)
  if (Array.isArray(block.statuses_summary)) {
    return block.statuses_summary.map((label) => ({
      crm_opportunity: pipelines[0] || '',
      crm_stage: '',
      crm_status: 'Open',
      platform_status: label,
      description: '',
    }));
  }

  return [];
}

export function seedFromCanon() {
  return {
    _version: canonStatus?._version || null,
    _modified_at: new Date().toISOString(),
    vsc: seedRowsForWorkflow('vsc'),
    refi: seedRowsForWorkflow('refi'),
    insurance: seedRowsForWorkflow('insurance'),
    payments: [],
  };
}

// Pipelines for each workflow, drawn from canon. Missing → empty array
// (Payments has no canon block; the editor surfaces it as a TBD placeholder).
export function pipelinesForWorkflow(workflow) {
  const block = canonStatus?.[workflow];
  if (block && Array.isArray(block._pipelines)) return block._pipelines;
  return [];
}

// Autocomplete sources per workflow — canon-seen values for crm_stage and
// platform_status. Operator can free-type; these populate <datalist>.
export function canonSuggestionsForWorkflow(workflow) {
  const block = canonStatus?.[workflow];
  if (!block) return { crm_stages: [], platform_statuses: [] };

  if (block.statuses && typeof block.statuses === 'object') {
    const entries = Object.entries(block.statuses);
    const stages = Array.from(
      new Set(entries.map(([, meta]) => meta?.crm_stage).filter(Boolean)),
    );
    // Insurance: machine_id is the platform_status; vsc: label.
    const platformStatuses = Array.from(
      new Set(
        entries.map(([label, meta]) => meta?.machine_id || label).filter(Boolean),
      ),
    );
    return { crm_stages: stages, platform_statuses: platformStatuses };
  }

  if (Array.isArray(block.statuses_summary)) {
    return { crm_stages: [], platform_statuses: block.statuses_summary.slice() };
  }

  return { crm_stages: [], platform_statuses: [] };
}

export function loadMapping() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return seedFromCanon();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return seedFromCanon();
    // Defensive: ensure all four workflow keys exist so the UI doesn't
    // need to null-guard each tab. Missing keys fall back to the seed.
    const seed = seedFromCanon();
    return {
      _version: parsed._version || seed._version,
      _modified_at: parsed._modified_at || seed._modified_at,
      vsc: Array.isArray(parsed.vsc) ? parsed.vsc : seed.vsc,
      refi: Array.isArray(parsed.refi) ? parsed.refi : seed.refi,
      insurance: Array.isArray(parsed.insurance) ? parsed.insurance : seed.insurance,
      payments: Array.isArray(parsed.payments) ? parsed.payments : [],
    };
  } catch (err) {
    console.warn('[status-mapping] loadMapping failed, using canon seed:', err);
    return seedFromCanon();
  }
}

export function saveMapping(mapping) {
  // Phase 1 prototype persistence. Phase 2: replace with blinkerApi.statusMapping.upsert().
  try {
    const stamped = { ...mapping, _modified_at: new Date().toISOString() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stamped));
    return stamped;
  } catch (err) {
    console.warn('[status-mapping] saveMapping failed (in-memory only):', err);
    return mapping;
  }
}

// Reset a single workflow's rows to the canon seed; leaves the other
// workflows untouched. Returns the new mapping but does NOT persist —
// caller must invoke saveMapping(next) to commit.
export function resetWorkflowToCanon(mapping, workflow) {
  return {
    ...mapping,
    [workflow]: seedRowsForWorkflow(workflow),
    _modified_at: new Date().toISOString(),
  };
}

export function emptyRow(workflow) {
  const pipelines = pipelinesForWorkflow(workflow);
  return {
    crm_opportunity: pipelines[0] || '',
    crm_stage: '',
    crm_status: 'Open',
    platform_status: '',
    description: '',
  };
}

// Read-only canon reference for the editor — exposes the canon doc so the
// UI can surface the canon `_TODO` array, structural gaps (refi has
// `statuses_summary` instead of `statuses`), and the canon `_version`
// stamp inline.
export function canonReference() {
  return canonStatus;
}

// Extract the per-workflow `platform_status` list from a loaded mapping
// — this is the shape the embed AgentView's FORCE STATUS picker accepts
// as its `availableStatuses` prop. Empty platform_status values are
// filtered out (the editor allows blank rows for in-progress edits);
// duplicates are deduped while preserving first-seen order.
//
// Per-workflow semantics (matches what seedRowsForWorkflow above writes):
//   * vsc       → display labels  (canon has no machine_id for VSC)
//   * insurance → machine_ids     (canon's `meta.machine_id`, dotted)
//   * refi      → display labels  (canon `statuses_summary` flat array)
//   * payments  → operator-defined (no canon block today)
// The downstream AgentView consumes whatever shape the operator's
// mapping uses — protection-portal AgentTopBar writes display labels
// straight to `opportunity.status`; insurance-portal AgentForceStatusBar
// writes machine_ids straight to `workflow.status`. Both the picker
// and the underlying state already speak the workflow's native shape.
//
// Returns:
//   string[]   — the override list (zero-length is meaningful: operator
//                explicitly cleared the mapping, suppress the picker)
//   undefined  — no mapping rows for this workflow (caller should fall
//                back to canon)
export function availableStatusesForWorkflow(mapping, workflow) {
  if (!mapping || !workflow) return undefined;
  const rows = mapping[workflow];
  if (!Array.isArray(rows)) return undefined;
  const seen = new Set();
  const list = [];
  for (const row of rows) {
    const v = row?.platform_status;
    if (!v || typeof v !== 'string') continue;
    if (seen.has(v)) continue;
    seen.add(v);
    list.push(v);
  }
  return list;
}
