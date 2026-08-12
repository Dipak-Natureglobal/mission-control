// TestModeToggleConfirm — modal opened when an admin toggles test_mode at
// org level. Per architecture/10-admin-console.md test_mode preservation
// rules: list every provider that supports_test_mode AND is enabled, with
// test ↔ live credential previews side-by-side. Two buttons: Confirm
// (audit-logged + flips org.test_mode in local state for Phase 1) and
// Cancel.
//
// Confirm requires the `toggle_test_mode` badge — admin and super_admin
// get it via canon presets.

import { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  TestTube2,
  X,
} from 'lucide-react';
import integrationsCanon from '../constants/canon/integrations.json';
import { track } from 'blinker-platform/telemetry';

export function TestModeToggleConfirm({ org, currentValue, onConfirm, onCancel }) {
  const nextValue = !currentValue;
  const providers = integrationsCanon.providers || {};

  const affected = useMemo(() => {
    const list = [];
    if (!org?.integrations) return list;
    for (const [providerId, block] of Object.entries(org.integrations)) {
      const provider = providers[providerId];
      if (!provider) continue;
      if (!provider.supports_test_mode) continue;
      if (!block?.enabled) continue;
      list.push({ provider, block });
    }
    return list;
  }, [org, providers]);

  function handleConfirm() {
    track('mission_control.admin.test_mode_toggled', {
      org_id: org?.id,
      from: currentValue,
      to: nextValue,
      affected_count: affected.length,
    });
    if (onConfirm) onConfirm(nextValue);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cancel"
        onClick={onCancel}
        className="absolute inset-0 bg-slate-900/50"
      />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
              <TestTube2 className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-amber-600 font-semibold mb-0.5">
                Confirm test-mode toggle
              </div>
              <div className="text-base font-semibold text-slate-900">
                {nextValue ? 'Enable' : 'Disable'} test mode on {org?.name || 'this org'}?
              </div>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Banner */}
        <div className="px-6 py-3 bg-amber-50 border-b border-amber-200 text-xs text-amber-900 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-700" />
          <div className="leading-relaxed">
            {nextValue ? (
              <>
                Every integration listed below will route to its <span className="font-semibold">sandbox</span> credentials.
                No real money will move and no real contracts will be booked while
                test mode is on.
              </>
            ) : (
              <>
                Every integration below will switch back to its <span className="font-semibold">live</span> credentials.
                Real money + real contracts resume immediately.
              </>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-6 py-4">
          {affected.length === 0 ? (
            <div className="text-xs text-slate-500 italic p-4 text-center bg-slate-50 rounded">
              No enabled providers on this org support test mode. Toggle is a
              no-op for routing — the org-level flag still flips for any
              provider you enable later.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-xs text-slate-500">
                {affected.length} provider{affected.length === 1 ? '' : 's'} will flip:
              </div>
              {affected.map(({ provider, block }) => (
                <ProviderDiff
                  key={provider.id}
                  provider={provider}
                  block={block}
                  fromEnv={currentValue ? 'test' : 'live'}
                  toEnv={nextValue ? 'test' : 'live'}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="text-xs font-medium px-3 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-100 text-slate-700"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className={
              'text-xs font-semibold px-3 py-1.5 rounded inline-flex items-center gap-1.5 text-white ' +
              (nextValue
                ? 'bg-amber-600 hover:bg-amber-700'
                : 'bg-emerald-600 hover:bg-emerald-700')
            }
          >
            <TestTube2 className="w-3 h-3" />
            Confirm — {nextValue ? 'enable test mode' : 'return to live'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProviderDiff({ provider, block, fromEnv, toEnv }) {
  const fromCreds = block?.credentials?.[fromEnv];
  const toCreds = block?.credentials?.[toEnv];
  const sampleField = (provider.fields || []).find(
    (f) => f.env && f.env.includes(toEnv) && !f.sensitive,
  );
  const sampleKey = sampleField?.key;
  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-white">
      <div className="text-xs font-semibold text-slate-900 mb-1">{provider.label}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-2">
        {provider.category}
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-[11px]">
        <EnvBlock env={fromEnv} creds={fromCreds} sampleKey={sampleKey} />
        <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
        <EnvBlock env={toEnv} creds={toCreds} sampleKey={sampleKey} highlighted />
      </div>
    </div>
  );
}

function EnvBlock({ env, creds, sampleKey, highlighted }) {
  const cls = highlighted
    ? 'border-violet-300 bg-violet-50'
    : 'border-slate-200 bg-slate-50';
  const sample = creds && sampleKey ? creds[sampleKey] : null;
  return (
    <div className={'border rounded p-2 ' + cls}>
      <div className="text-[9px] uppercase tracking-wide font-semibold text-slate-500 mb-0.5">
        {env}
      </div>
      {creds ? (
        <div className="text-[11px] font-mono text-slate-800 truncate">
          {sample || `${Object.keys(creds).length} fields`}
        </div>
      ) : (
        <div className="text-[11px] text-slate-400 italic">no {env} credentials configured</div>
      )}
    </div>
  );
}
