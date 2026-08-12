// IntegrationDrawer — slide-out edit drawer for a single provider on a
// single org. Per architecture/10-admin-console.md.
//
// Tabs: test / live (only when provider.supports_test_mode === true);
// otherwise a single "Credentials" tab. Fields rendered per
// provider.fields[]. Sensitive fields show masked •••••••• with a Reveal
// button. Reveal is gated on `view_integration_credentials` badge — when
// the actor's persona doesn't carry that badge, Reveal is disabled with a
// "Super-admin reveal only" tooltip.
//
// Phase 1: reveal reads the value from the canon-fixture inline + emits
// mission_control.admin.integration_credential_revealed. Phase 2: reveal
// hits the dedicated endpoint per the architecture doc.
//
// Save is a Phase 1 stub — log + emit, no fixture mutation.

import { useMemo, useState } from 'react';
import {
  Eye,
  EyeOff,
  Save,
  Shield,
  X,
} from 'lucide-react';
import { can } from '../../lib/permissions.js';
import { track } from 'blinker-platform/telemetry';

// Phase 1 actor — a synthetic user-like object the drawer hands to
// permissions.can(). Persona alone is enough since the architecture's
// `view_integration_credentials` is preset-backed (super_admin gets it,
// admin does not). Phase 2 swap: read the real session user.
function buildActor(persona) {
  return { persona, added_badges: [], removed_badges: [] };
}

export function IntegrationDrawer({ provider, orgBlock, orgId, actorPersona = 'admin', onClose }) {
  const supportsEnv = provider.supports_test_mode === true;
  const [activeEnv, setActiveEnv] = useState(supportsEnv ? 'test' : 'flat');
  const [revealed, setRevealed] = useState({}); // { "test:api_key": true }
  // Local-only edits (Phase 1 stub). Keys: env:fieldKey.
  const [edits, setEdits] = useState({});

  const actor = useMemo(() => buildActor(actorPersona), [actorPersona]);
  const canReveal = can(actor, 'view_integration_credentials');

  const credentials = useMemo(() => {
    if (!orgBlock?.credentials) return {};
    if (supportsEnv) return orgBlock.credentials; // { test:{}, live:{} }
    return { flat: orgBlock.credentials };
  }, [orgBlock, supportsEnv]);

  function valueFor(env, fieldKey) {
    const editKey = `${env}:${fieldKey}`;
    if (edits[editKey] !== undefined) return edits[editKey];
    const envBlock = credentials[env] || {};
    return envBlock[fieldKey];
  }

  function setValueFor(env, fieldKey, next) {
    setEdits((prev) => ({ ...prev, [`${env}:${fieldKey}`]: next }));
  }

  function reveal(env, fieldKey) {
    if (!canReveal) return;
    const key = `${env}:${fieldKey}`;
    setRevealed((prev) => ({ ...prev, [key]: !prev[key] }));
    if (!revealed[key]) {
      track('mission_control.admin.integration_credential_revealed', {
        org_id: orgId,
        provider: provider.id,
        field: fieldKey,
        env: env === 'flat' ? null : env,
      });
    }
  }

  function onSave() {
    track('mission_control.admin.integration_credentials_updated', {
      org_id: orgId,
      provider: provider.id,
      changed_count: Object.keys(edits).length,
    });
    if (typeof console !== 'undefined') {
      console.log('[IntegrationDrawer] save (Phase 1 stub):', {
        org_id: orgId,
        provider: provider.id,
        edits,
      });
    }
    if (onClose) onClose();
  }

  const fieldsForEnv = (env) => {
    if (env === 'flat') {
      return provider.fields || [];
    }
    return (provider.fields || []).filter((f) => !f.env || f.env.includes(env));
  };

  const dirty = Object.keys(edits).length > 0;

  return (
    <div className="fixed inset-0 z-30 flex">
      <button
        type="button"
        aria-label="Close drawer"
        onClick={onClose}
        className="flex-1 bg-slate-900/40"
      />
      <div className="w-full max-w-xl bg-white shadow-2xl flex flex-col h-full" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-violet-600 font-semibold mb-0.5">
              Admin · Integration
            </div>
            <div className="text-lg font-semibold text-slate-900 leading-tight">
              {provider.label}
            </div>
            <div className="text-xs text-slate-500">
              {provider.category} · org #{orgId}
            </div>
            {provider.purpose && (
              <div className="text-[11px] text-slate-500 mt-1 leading-snug max-w-md">
                {provider.purpose}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        {supportsEnv ? (
          <div className="flex items-center border-b border-slate-200">
            <EnvTab env="test" active={activeEnv === 'test'} onClick={() => setActiveEnv('test')} />
            <EnvTab env="live" active={activeEnv === 'live'} onClick={() => setActiveEnv('live')} />
          </div>
        ) : (
          <div className="px-6 py-2 border-b border-slate-200 text-[10px] uppercase tracking-wide font-semibold text-slate-500">
            Credentials (env-agnostic)
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-auto">
          <div className="p-6 space-y-3">
            {fieldsForEnv(activeEnv).map((field) => (
              <FieldRow
                key={field.key}
                field={field}
                value={valueFor(activeEnv, field.key)}
                onChange={(next) => setValueFor(activeEnv, field.key, next)}
                revealed={!!revealed[`${activeEnv}:${field.key}`]}
                canReveal={canReveal}
                onReveal={() => reveal(activeEnv, field.key)}
              />
            ))}
            {!canReveal && provider.fields?.some((f) => f.sensitive) && (
              <div className="text-[11px] text-slate-500 italic flex items-start gap-2 mt-3 p-3 rounded bg-slate-50 border border-slate-200">
                <Shield className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" />
                <span>
                  Sensitive fields are masked. Reveal requires the{' '}
                  <code className="font-mono bg-white px-1 rounded">view_integration_credentials</code>{' '}
                  badge (super-admin only). Editing is allowed — your input replaces
                  the masked value without exposing the prior secret.
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center gap-2">
          <div className="text-[11px] text-slate-500 mr-auto">
            actor: {actorPersona} · {dirty ? `${Object.keys(edits).length} unsaved` : 'no changes'}
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

function EnvTab({ env, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={
        'px-4 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors uppercase tracking-wide ' +
        (active
          ? env === 'test'
            ? 'border-amber-500 text-amber-700'
            : 'border-violet-600 text-violet-700'
          : 'border-transparent text-slate-500 hover:text-slate-800')
      }
    >
      {env}
    </button>
  );
}

function FieldRow({ field, value, onChange, revealed, canReveal, onReveal }) {
  if (field.type === 'enum-array') {
    const arr = Array.isArray(value) ? value : [];
    const options = Array.isArray(field.options) ? field.options : [];
    const toggle = (optValue) => {
      if (arr.includes(optValue)) {
        onChange(arr.filter((v) => v !== optValue));
      } else {
        onChange([...arr, optValue]);
      }
    };
    return (
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-semibold text-slate-700">
            {field.label}
            {field.required && <span className="text-rose-600 ml-0.5">*</span>}
          </label>
          <span className="text-[9px] uppercase tracking-wide text-slate-400 font-mono">
            {field.type}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {options.map((opt) => {
            const selected = arr.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                className={
                  'text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors ' +
                  (selected
                    ? 'bg-violet-600 text-white border-violet-600'
                    : 'bg-white text-slate-700 border-slate-200 hover:border-violet-500 hover:text-violet-700')
                }
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <div className="text-[10px] text-slate-400 mt-1">
          {arr.length === 0
            ? 'All codes enabled (empty filter)'
            : `${arr.length} of ${options.length} selected`}
        </div>
        {field.help && (
          <div className="text-[11px] text-slate-500 mt-1 leading-snug">{field.help}</div>
        )}
      </div>
    );
  }

  const sensitive = field.sensitive === true;
  const display = sensitive && !revealed && value
    ? '••••••••'
    : Array.isArray(value)
    ? JSON.stringify(value)
    : (value ?? '');

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-semibold text-slate-700">
          {field.label}
          {field.required && <span className="text-rose-600 ml-0.5">*</span>}
        </label>
        <span className="text-[9px] uppercase tracking-wide text-slate-400 font-mono">
          {field.type}
          {sensitive && ' · sensitive'}
        </span>
      </div>
      <div className="flex items-stretch gap-1">
        <input
          type="text"
          value={display}
          onChange={(e) => {
            // If sensitive + masked: typing replaces the value (write-only).
            // Strip the mask before forwarding.
            if (sensitive && !revealed && e.target.value.startsWith('••')) {
              onChange(e.target.value.replace(/[•]+/g, ''));
            } else {
              onChange(e.target.value);
            }
          }}
          placeholder={field.help || ''}
          className="flex-1 text-xs border border-slate-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:border-violet-500 font-mono"
        />
        {sensitive && (
          <button
            type="button"
            onClick={onReveal}
            disabled={!canReveal}
            title={canReveal ? (revealed ? 'Hide' : 'Reveal') : 'Super-admin reveal only'}
            className={
              'inline-flex items-center justify-center w-8 rounded border ' +
              (canReveal
                ? 'border-slate-200 bg-white hover:border-violet-500 text-slate-600 hover:text-violet-700'
                : 'border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed')
            }
          >
            {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
      {field.help && (
        <div className="text-[11px] text-slate-500 mt-1 leading-snug">{field.help}</div>
      )}
    </div>
  );
}
