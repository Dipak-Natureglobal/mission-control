// Insurance.jsx — research Section 4.3.2.
// Thin: enabled toggle + display mode + read-only partner_id surfaced from
// integrations. Most insurance behavior lives on the Embedded Insurance
// integration credentials block (Integrations section).

import { Field, FormCard, CheckboxLabel, Select, Chip } from './_shared.jsx';

const QUOTE_DISPLAY_MODES = [
  { value: 'summary', label: 'Summary — single-line savings pill' },
  { value: 'detailed', label: 'Detailed — full quote card with carrier list' },
];

export function InsuranceSection({ form, set, onJumpToIntegrations }) {
  const ins = form.opportunities?.insurance || {};
  const eiCreds = form.integrations?.embedded_insurance?.credentials;
  const partnerId = eiCreds?.live?.partner_id || eiCreds?.test?.partner_id || null;

  function setIns(patch) {
    set({
      opportunities: {
        ...(form.opportunities || {}),
        insurance: { ...ins, ...patch },
      },
    });
  }

  return (
    <div className="space-y-4">
      <FormCard title="Workflow toggle">
        <CheckboxLabel
          checked={ins.enabled}
          onChange={(e) => setIns({ enabled: e.target.checked })}
        >
          Insurance enabled — shows the &ldquo;Find insurance savings&rdquo; CTA
        </CheckboxLabel>
      </FormCard>

      {ins.enabled && (
        <FormCard title="Display">
          <Field label="Quote display mode">
            <Select
              value={ins.quote_display_mode || 'summary'}
              onChange={(v) => setIns({ quote_display_mode: v })}
              options={QUOTE_DISPLAY_MODES}
            />
          </Field>
        </FormCard>
      )}

      <FormCard title="Embedded Insurance partner">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
            Partner id
          </span>
          {partnerId ? (
            <Chip tone="emerald">{partnerId}</Chip>
          ) : (
            <Chip tone="rose">not configured</Chip>
          )}
          <button
            type="button"
            onClick={onJumpToIntegrations}
            className="ml-auto text-[10px] font-semibold text-amber-700 hover:underline"
          >
            Edit in Integrations →
          </button>
        </div>
        <div className="text-[10px] text-slate-500 mt-2 italic">
          Per-org insurance behavior is mostly driven by the Embedded Insurance
          integration credentials. Edit them in the Integrations section.
        </div>
      </FormCard>
    </div>
  );
}
