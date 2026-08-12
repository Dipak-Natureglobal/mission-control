// RefiDevControls — chrome-less, embed-friendly variant of DevControls.
//
// Mission-control consolidates each portal's DEV CONTROLS into a single
// dark sidebar (its own DevPanel). Each portal exposes a section-only
// component that renders into that sidebar without its own dark wrapper.
// This is refi-portal's contribution.
//
// Compared to src/shell/DevControls.jsx, this component:
//   * Drops the outer <DevPanel> chrome (mission-control owns it).
//   * Drops the "View" Section (no view switcher when embedded inside
//     mission-control's CoPilotPane — refi only renders the agent view).
//   * Keeps every other section verbatim, including the Persona slice,
//     prefill, force-outcomes, jump-to-screen, plan/insurance toggles,
//     inspector, and the Reset button.
//
// State ownership: identical to DevControls — the parent owns
// `devOptions`, `formState`, and `wizardNav` slices and threads them
// in. The component is purely controlled.
//
// DevControls.jsx now composes <RefiDevControls /> + a leading View
// Section so the standalone shell keeps the same surface area.
import type { FC } from 'react';
import {
  ChevronRight, ClipboardPaste, RefreshCcw,
} from 'lucide-react';
import { Section, Segmented } from 'blinker-platform/components';
import { JsonPeek } from 'blinker-platform/components';
import { DISQUAL_REASONS } from '../constants/disqual-reasons';
import { DEFAULT_ORG_CONFIG } from '../constants/org-config';
import { PREFILL_PRESETS } from '../constants/prefill-presets';
import type { PrefillPayload } from '../constants/prefill-presets';
import type { WizardDevOptions, FormState, WizardNav, Persona, Partner, DisqualReason, ScreenKey } from '../types';

const PERSONAS = [
  { v: 'consumer',    l: 'Consumer' },
  { v: 'agent',       l: 'Agent' },
  { v: 'manager',     l: 'Manager' },
  { v: 'admin',       l: 'Admin' },
  { v: 'super_admin', l: 'Super' },
];

// Same screen labels as the monolith's SCREEN_LABELS; duplicated here so
// RefiDevControls doesn't have to import the full prototype at module-
// load time. Keep in sync with refinance-v2-prototype.jsx if screens are
// added.
const SCREEN_LABELS = {
  embedded_entry:        'Embedded quote card',
  vehicle_add:           'V1 Add vehicle',
  vehicle_drive:         'V2 How much do you drive?',
  s1_ownership:          'S1.1 Ownership',
  s1_auto_loan:          'S1.2 Auto loan',
  s1_credit:             'S1.3 Self-reported credit',
  s1_co_app_decision:    'Co-applicant?',
  s1_co_app_contact:     'Co-app contact',
  s1_co_app_employment:  'Co-app employment',
  s1_applicant:          'S1.4 Applicant',
  s1_housing:            'S1.5 Housing',
  s1_employment:         'S1.6 Employment',
  s1_identity_consent:   'S1.7 Identity & consent',
  decision_engine:       'Decision engine',
  stage2_result:         'Stage 2 result',
};

interface RefiDevControlsProps {
  devOptions: WizardDevOptions;
  setDevOptions: (updater: (prev: WizardDevOptions) => WizardDevOptions) => void;
  formState: FormState;
  wizardNav: WizardNav;
}

export const RefiDevControls: FC<RefiDevControlsProps> = ({
  devOptions, setDevOptions,
  formState,
  wizardNav,
}) => {
  const persona = devOptions?.persona ?? 'consumer';
  const personaLocked = devOptions?.personaLocked ?? false;
  const forcePartner = devOptions?.forcePartner ?? 'auto';
  const forceResult = devOptions?.forceResult ?? 'auto';
  const disqualReason = devOptions?.disqualReason ?? 'credit_out_of_range';
  const includeSsn = devOptions?.includeSsn ?? true;
  const coAppOverride = devOptions?.coAppOverride ?? 'auto';
  const showJson = devOptions?.showJson ?? true;
  const prefillJson = devOptions?.prefillJson ?? JSON.stringify(PREFILL_PRESETS[0].payload, null, 2);
  const orgConfigJson = devOptions?.orgConfigJson ?? JSON.stringify(DEFAULT_ORG_CONFIG, null, 2);
  const orgConfigError = devOptions?.orgConfigError;
  const embeddedState = devOptions?.embeddedState ?? 'pre';

  const form = formState?.form ?? {};
  const updateForm = formState?.update ?? (() => {});
  const applyPrefill = formState?.applyPrefill ?? (() => {});
  const resetAll = formState?.resetAll ?? (() => {});

  const screen = wizardNav?.screen ?? 'embedded_entry';
  const goToScreen = wizardNav?.goToScreen ?? (() => {});
  const sequence = wizardNav?.sequence ?? [];

  function setOpt(patch: Partial<WizardDevOptions>): void {
    setDevOptions((prev) => ({ ...prev, ...patch }));
  }

  function tryPrefill(): void {
    try {
      const p = JSON.parse(prefillJson) as PrefillPayload;
      applyPrefill(p);
    } catch (e) {
      alert("Couldn't parse JSON: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  function pickPreset(preset: typeof PREFILL_PRESETS[number]): void {
    const json = JSON.stringify(preset.payload, null, 2);
    setOpt({ prefillJson: json });
    applyPrefill(preset.payload);
  }

  function applyOrgConfig(): void {
    try {
      const parsed = JSON.parse(orgConfigJson) as WizardDevOptions['orgConfig'];
      setOpt({ orgConfig: parsed, orgConfigError: undefined });
    } catch (e) {
      setOpt({ orgConfigError: e instanceof Error ? e.message : String(e) });
    }
  }

  function resetOrgConfig(): void {
    setOpt({
      orgConfig: DEFAULT_ORG_CONFIG,
      orgConfigJson: JSON.stringify(DEFAULT_ORG_CONFIG, null, 2),
      orgConfigError: undefined,
    });
  }

  return (
    <>
      {/* Platform-substrate persona slice — kept in the embedded variant
          because mission-control's PersonaSwitcher hasn't fully replaced
          the per-portal persona yet. When that lands, mission-control
          can stop threading persona through devOptions and this Section
          becomes inert. */}
      <Section label="Persona">
        <select
          value={persona}
          onChange={(e) => setOpt({ persona: e.target.value as Persona })}
          className="w-full bg-slate-800 text-slate-100 text-xs rounded-md px-2 py-1.5 border border-slate-700 focus:outline-none focus:border-blue-500"
        >
          {PERSONAS.map((p) => (
            <option key={p.v} value={p.v}>{p.l}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-xs text-slate-300 mt-2 cursor-pointer">
          <input
            type="checkbox"
            checked={personaLocked}
            onChange={(e) => setOpt({ personaLocked: e.target.checked })}
            className="rounded"
          />
          <span>persona-locked</span>
        </label>
      </Section>

      {/* Refi-prototype port-forward — 14 sections, in the order the prototype shipped them. */}

      {/* 1. Prefill payload (JSON) */}
      <Section label="Prefill payload (JSON)">
        <div className="text-xs text-slate-500 mb-1 leading-snug">
          Keys: <span className="font-mono">applicant</span>, <span className="font-mono">coApplicant</span>, <span className="font-mono">vehicle</span> (vehicle may include <span className="font-mono">vin</span>).
        </div>
        <textarea
          value={prefillJson}
          onChange={(e) => setOpt({ prefillJson: e.target.value })}
          className="w-full text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono h-40"
        />
        <button
          onClick={tryPrefill}
          className="w-full mt-2 flex items-center justify-center gap-1 text-xs px-2 py-1.5 bg-blue-600 hover:bg-blue-500 rounded font-semibold"
        >
          <ClipboardPaste className="w-3 h-3" /> Apply prefill
        </button>
        <div className="text-xs text-slate-500 mt-2 mb-1">Presets:</div>
        <div className="grid grid-cols-2 gap-1">
          {PREFILL_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => pickPreset(p)}
              className="text-xs px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-left"
            >
              {p.label}
            </button>
          ))}
        </div>
      </Section>

      {/* 1b. RefiSubFlow demo prefill — exercises the public RefiSubFlow
              embed contract (applicant + vehicle, optional co-applicant).
              The standalone refi-portal customer view doesn't render
              RefiSubFlow itself, but these buttons mutate the same form
              the wizard reads — so DEV CONTROLS reviewers can see how a
              cross-sell host's prefill payload would land at s1_ownership
              with hasCoApplicant pre-selected. */}
      <Section label="RefiSubFlow demo prefill">
        <div className="text-xs text-slate-500 mb-2 leading-snug">
          Mirrors the public <span className="font-mono">RefiSubFlow</span> embed:
          applicant + vehicle pre-filled, optional co-applicant. Verify
          that s1_ownership lands with the answer pre-populated.
        </div>
        <div className="grid grid-cols-1 gap-1">
          <button
            onClick={() =>
              applyPrefill({
                applicant: {
                  firstName: 'Maria',
                  lastName: 'Alvarez',
                  email: 'maria.alvarez@example.com',
                  phone: '5552041188',
                },
                coApplicant: {
                  firstName: 'Tasha',
                  lastName: 'Brooks',
                  email: 'tasha@example.com',
                  phone: '5125551234',
                  relationship: 'Spouse',
                },
                vehicle: {
                  vin: 'JTMP1RFV9ND123456',
                  year: 2022,
                  make: 'Toyota',
                  model: 'RAV4',
                  trim: 'XLE',
                  mileage: 38420,
                  condition: 'Used',
                },
              })
            }
            className="text-xs px-2 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-left"
          >
            Apply applicant + co-app prefill
          </button>
          <button
            onClick={() => {
              applyPrefill({
                applicant: {
                  firstName: 'Maria',
                  lastName: 'Alvarez',
                  email: 'maria.alvarez@example.com',
                  phone: '5552041188',
                },
                vehicle: {
                  vin: 'JTMP1RFV9ND123456',
                  year: 2022,
                  make: 'Toyota',
                  model: 'RAV4',
                  trim: 'XLE',
                  mileage: 38420,
                  condition: 'Used',
                },
              });
              // Clear any prior co-applicant fields so the demo lands
              // with hasCoApplicant=false.
              updateForm({
                hasCoApplicant: null,
                coAppFirst: '',
                coAppLast: '',
                coAppPhone: '',
                coAppEmail: '',
                coAppRelationship: '',
                coAppRelationshipOther: '',
              });
            }}
            className="text-xs px-2 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-left"
          >
            Apply applicant only
          </button>
        </div>
      </Section>

      {/* 2. Org config (disqualification rules) */}
      <Section label="Org config (disqualification rules)">
        <div className="text-xs text-slate-500 mb-1 leading-snug">
          Emulates per-org / per-partner thresholds. These values drive the decision engine's disqualification checks.
        </div>
        <textarea
          value={orgConfigJson}
          onChange={(e) => setOpt({ orgConfigJson: e.target.value })}
          className="w-full text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono h-56"
        />
        {orgConfigError && (
          <div className="text-xs text-rose-400 mt-1">{orgConfigError}</div>
        )}
        <div className="flex gap-1 mt-2">
          <button
            onClick={applyOrgConfig}
            className="flex-1 text-xs px-2 py-1.5 bg-blue-600 hover:bg-blue-500 rounded font-semibold"
          >
            Apply config
          </button>
          <button
            onClick={resetOrgConfig}
            className="text-xs px-2 py-1.5 bg-slate-800 hover:bg-slate-700 rounded"
          >
            Reset
          </button>
        </div>
      </Section>

      {/* 3. Force partner routing */}
      <Section label="Force partner routing">
        <Segmented
          value={forcePartner}
          onChange={(v) => setOpt({ forcePartner: v as Partner | 'auto' })}
          options={[
            { v: 'auto', l: 'Auto' },
            { v: 'gravity', l: 'Gravity' },
            { v: 'savings_group', l: 'SG' },
            { v: 'none', l: 'None' },
          ]}
        />
      </Section>

      {/* 4. Force Stage 2 result */}
      <Section label="Force Stage 2 result">
        <div className="flex flex-col gap-1">
          {[
            { v: 'auto', l: 'Auto (from rules)' },
            { v: 'pre_approved', l: 'Pre-approved' },
            { v: 'offers_returned', l: 'Offers returned' },
            { v: 'disqualified', l: 'Disqualified' },
            { v: 'pending', l: 'Pending / async' },
          ].map((o) => (
            <button
              key={o.v}
              onClick={() => setOpt({ forceResult: o.v })}
              className={
                'text-left text-xs px-2 py-1 rounded ' +
                (forceResult === o.v
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200')
              }
            >
              {o.l}
            </button>
          ))}
        </div>
      </Section>

      {/* 5. Disqualification reason — conditional on forceResult === 'disqualified' */}
      {forceResult === 'disqualified' && (
        <Section label="Disqualification reason">
          <select
            value={disqualReason}
            onChange={(e) => setOpt({ disqualReason: e.target.value as DisqualReason })}
            className="w-full text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-100"
          >
            {Object.entries(DISQUAL_REASONS).map(([k, v]) => (
              <option key={k} value={k}>{v.title}</option>
            ))}
          </select>
        </Section>
      )}

      {/* 6. SSN provided */}
      <Section label="SSN provided">
        <Segmented
          value={includeSsn ? 'yes' : 'no'}
          onChange={(v) => setOpt({ includeSsn: v === 'yes' })}
          options={[{ v: 'yes', l: 'Yes' }, { v: 'no', l: 'No' }]}
        />
      </Section>

      {/* 7. Co-applicant */}
      <Section label="Co-applicant">
        <Segmented
          value={coAppOverride}
          onChange={(v) => setOpt({ coAppOverride: v as 'auto' | 'yes' | 'no' })}
          options={[
            { v: 'auto', l: 'Auto' },
            { v: 'yes', l: 'Yes' },
            { v: 'no', l: 'No' },
          ]}
        />
        <div className="text-xs text-slate-500 mt-1">Auto follows the in-flow answer</div>
      </Section>

      {/* 8. Protection plan sold */}
      <Section label="Protection plan sold">
        <Segmented
          value={form.planSold ? 'yes' : 'no'}
          onChange={(v) => updateForm({ planSold: v === 'yes', smsSent: false, selectedPlanId: undefined })}
          options={[{ v: 'yes', l: 'Yes' }, { v: 'no', l: 'No' }]}
        />
        <div className="text-xs text-slate-500 mt-1">No → shows coverage teaser on result</div>
      </Section>

      {/* 9. Insurance reviewed */}
      <Section label="Insurance reviewed">
        <Segmented
          value={form.insuranceReviewed ? 'yes' : 'no'}
          onChange={(v) => updateForm({
            insuranceReviewed: v === 'yes',
            insuranceSmsSent: false,
            insuranceSavingsFound: v === 'yes' ? form.insuranceSavingsFound : false,
            insuranceMonthlySavings: v === 'yes' ? form.insuranceMonthlySavings : 0,
          })}
          options={[{ v: 'yes', l: 'Yes' }, { v: 'no', l: 'No' }]}
        />
        <div className="text-xs text-slate-500 mt-1">No → shows insurance teaser on result</div>
      </Section>

      {/* 10. Insurance savings found — conditional on insuranceReviewed */}
      {form.insuranceReviewed && (
        <Section label="Insurance savings found">
          <Segmented
            value={form.insuranceSavingsFound ? 'yes' : 'no'}
            onChange={(v) => updateForm({
              insuranceSavingsFound: v === 'yes',
              // Default $25/mo savings (matches the monolith's MOCK_INSURANCE_SAVINGS).
              insuranceMonthlySavings: v === 'yes' ? 25 : 0,
            })}
            options={[{ v: 'yes', l: 'Yes' }, { v: 'no', l: 'No' }]}
          />
          {form.insuranceSavingsFound && (
            <div className="text-xs text-orange-400 mt-1">${form.insuranceMonthlySavings}/mo → offsets refi + protection</div>
          )}
        </Section>
      )}

      {/* 11. Jump to screen */}
      <Section label="Jump to screen">
        <div className="flex flex-col gap-1 max-h-64 overflow-auto pr-1">
          {(['embedded_entry', ...sequence] as ScreenKey[]).map((s) => {
            const isActive = screen === s;
            return (
              <button
                key={s}
                onClick={() => goToScreen(s as ScreenKey)}
                className={
                  'text-left text-xs px-2 py-1 rounded flex items-center justify-between ' +
                  (isActive ? 'bg-blue-600 text-white' : 'bg-slate-800 hover:bg-slate-700')
                }
              >
                <span>{SCREEN_LABELS[s as ScreenKey] || s}</span>
                {isActive && <ChevronRight className="w-3 h-3" />}
              </button>
            );
          })}
        </div>
      </Section>

      {/* 12. Embedded card state */}
      <Section label="Embedded card state">
        <Segmented
          value={String(embeddedState)}
          onChange={(v) => setOpt({ embeddedState: v })}
          options={[
            { v: 'pre', l: 'Pre-apply' },
            { v: 'post', l: 'Post-result' },
          ]}
        />
      </Section>

      {/* 13. Inspector → Show JSON peek */}
      <Section label="Inspector">
        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={showJson}
            onChange={(e) => setOpt({ showJson: e.target.checked })}
            className="rounded"
          />
          <span>Show JSON peek</span>
        </label>
        {showJson && (
          <div className="space-y-2 mt-2">
            <JsonPeek label="form · current slice" data={form} />
            <JsonPeek label="dev · DEV CONTROLS slice" data={devOptions ?? {}} />
          </div>
        )}
      </Section>

      {/* 14. Reset prototype */}
      <button
        onClick={resetAll}
        className="w-full mt-2 flex items-center justify-center gap-2 text-xs px-3 py-2 bg-red-600 hover:bg-red-500 rounded font-semibold"
      >
        <RefreshCcw className="w-3 h-3" /> Reset prototype
      </button>
    </>
  );
}
