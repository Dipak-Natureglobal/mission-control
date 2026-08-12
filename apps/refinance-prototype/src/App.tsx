// Top-level shell. Mirrors protection-portal's substrate — Vite + React 19
// + JS, monolithic App.jsx with a DEV CONTROLS sidebar pattern. Workflow
// content lives under src/views/customer/ and src/views/agent/.
//
// State ownership (Phase 1.5e — lifted up from RefiWizard so DEV
// CONTROLS can mutate the wizard live):
//
//   form        — the shared refi form state (INITIAL_FORM shape from
//                 RefiWizard). Both customer and agent views read +
//                 write the same form so DEV CONTROLS prefill applies
//                 uniformly. AgentView additionally owns its own
//                 `opportunity` state (capture link, status,
//                 sentSummary) because that's agent-only metadata that
//                 doesn't belong in the consumer's form.
//   stepIdx     — current wizard step index. Lifted up so DEV CONTROLS
//                 "Jump to screen" (Section 11) can drive it directly.
//   devOptions  — DEV CONTROLS's full state slice. Per DevControls.jsx
//                 keys: persona, personaLocked, forcePartner, forceResult,
//                 disqualReason, includeSsn, coAppOverride, showJson,
//                 prefillJson, orgConfig, orgConfigJson, orgConfigError,
//                 embeddedState. We seed orgConfig from
//                 src/constants/org-config.js so the JSON peek + Apply
//                 button start from the canonical default.
//
// Wired DEV CONTROLS sections (after Chunk E):
//   §1  Prefill payload (JSON) → applyPrefill() mutates form
//   §3  Force partner routing  → drives runDecision via useRefiPrequal
//   §4  Force Stage 2 result   → drives runDecision via useRefiPrequal
//   §5  Disqualification reason → drives runDecision (when forceResult=disqualified)
//   §6  SSN provided           → drives runDecision (Gravity vs Savings Group routing)
//   §7  Co-applicant override  → drives runDecision (auto reads form.hasCoApplicant)
//   §8/9/10 Plan / Insurance toggles → mutate form directly
//   §11 Jump to screen         → drives setStepIdx
//   §14 Reset prototype        → clears form + dev to defaults
//
// Sections that drive runDecision are read by useRefiPrequal inside the
// wizard's terminal screen (RefiWizard wires them through to its own
// runDecision call). The customer wizard's mockDecision() placeholder
// is replaced with a real runDecision call in this same chunk.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FC } from 'react';
import { TopBar } from './shell/TopBar';
import { DevControls } from './shell/DevControls';
import { ViewSwitcher, readViewFromUrl } from './shell/ViewSwitcher';
import { useForm } from './hooks/useForm';
import { INITIAL_FORM } from './views/customer/RefiWizard';
import { DEFAULT_ORG_CONFIG } from './constants/org-config';
import { PREFILL_PRESETS } from './constants/prefill-presets';
import type { PrefillPayload } from './constants/prefill-presets';
import { RELATIONSHIP_OPTIONS } from './refinance-v2-prototype';
import { getSequence } from './lib/refi';
import type { RefiForm, ViewType, ScreenKey, WizardDevOptions } from './types';

const INITIAL_DEV_OPTIONS: WizardDevOptions = {
  // Substrate (persona + lock).
  persona: 'consumer',
  personaLocked: false,
  // Refi force-outcomes (read by useRefiPrequal in the wizard).
  forcePartner: 'auto',
  forceResult: 'auto',
  disqualReason: 'credit_out_of_range',
  includeSsn: true,
  coAppOverride: 'auto',
  // DEV CONTROLS chrome.
  showJson: true,
  prefillJson: JSON.stringify(PREFILL_PRESETS[0].payload, null, 2),
  orgConfig: DEFAULT_ORG_CONFIG,
  orgConfigJson: JSON.stringify(DEFAULT_ORG_CONFIG, null, 2),
  embeddedState: 'pre',
};

// applyPrefill — port of refinance-v2-prototype.tsx applyPrefill (~L902).
// Accepts a wrapped payload `{ vehicle, applicant, coApplicant }` (the
// shape every PREFILL_PRESETS entry uses), returns the patch object so
// the caller can pass it straight to update().
function buildPrefillPatch(payload: PrefillPayload): Partial<RefiForm> | null {
  if (!payload) return null;
  const vehicle     = payload.vehicle    ?? {};
  const applicant   = payload.applicant  ?? {};
  const coApplicant = payload.coApplicant ?? {};

  const patch: Partial<RefiForm> = {};
  if (vehicle.vin       !== undefined) patch.vin       = vehicle.vin.toUpperCase();
  if (vehicle.year      !== undefined) patch.year      = vehicle.year || null;
  if (vehicle.make      !== undefined) patch.make      = vehicle.make;
  if (vehicle.model     !== undefined) patch.model     = vehicle.model;
  if (vehicle.trim      !== undefined) patch.trim      = vehicle.trim;
  if (vehicle.mileage   !== undefined) patch.mileage   = vehicle.mileage;
  if (vehicle.condition !== undefined) patch.condition = vehicle.condition;

  if (applicant.firstName !== undefined) patch.firstName = applicant.firstName;
  if (applicant.lastName  !== undefined) patch.lastName  = applicant.lastName;
  if (applicant.phone     !== undefined)
    patch.phone = applicant.phone.replace(/\D/g, '').slice(0, 10);
  if (applicant.email !== undefined) patch.email = applicant.email;

  if (coApplicant.firstName !== undefined) patch.coAppFirst = coApplicant.firstName;
  if (coApplicant.lastName  !== undefined) patch.coAppLast  = coApplicant.lastName;
  if (coApplicant.phone     !== undefined)
    patch.coAppPhone = coApplicant.phone.replace(/\D/g, '').slice(0, 10);
  if (coApplicant.email !== undefined) patch.coAppEmail = coApplicant.email;
  if (coApplicant.relationship !== undefined) {
    const rel = coApplicant.relationship;
    if ((RELATIONSHIP_OPTIONS as string[]).includes(rel)) {
      patch.coAppRelationship = rel;
      patch.coAppRelationshipOther = '';
    } else if (rel) {
      patch.coAppRelationship = 'Other';
      patch.coAppRelationshipOther = rel;
    }
  }
  return patch;
}

const App: FC = () => {
  const [panelOpen, setPanelOpen] = useState(true);
  const [view, setView] = useState(() => readViewFromUrl('customer'));

  // Shared refi form + step. Lifted from RefiWizard (was local) so
  // DEV CONTROLS prefill / jump-to-screen can drive them directly. Both
  // customer and agent views read the same form per the embed contract;
  // agent layers its own opportunity slice on top.
  const [form, updateForm, resetForm] = useForm(INITIAL_FORM);
  const [stepIdx, setStepIdx] = useState(0);

  const [devOptions, setDevOptions] = useState<WizardDevOptions>(INITIAL_DEV_OPTIONS);

  // Keep ?view= in sync when DEV CONTROLS flips the view, so reloading
  // and sharing URLs both work.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('view') !== view) {
      url.searchParams.set('view', view);
      window.history.replaceState({}, '', url.toString());
    }
  }, [view]);

  // applyPrefill — DEV CONTROLS Section 1 (Prefill payload + presets).
  // Wired through to formState.applyPrefill in the panel.
  const applyPrefill = useCallback(
    (payload: PrefillPayload): void => {
      const patch = buildPrefillPatch(payload);
      if (patch) updateForm(patch);
    },
    [updateForm]
  );

  // resetAll — DEV CONTROLS Section 14 (Reset prototype). Clears form
  // back to INITIAL_FORM, resets stepIdx, restores DEV CONTROLS to its
  // initial slice (preserving the current view + persona since the
  // user usually wants to keep their orientation).
  const resetAll = useCallback(() => {
    resetForm();
    setStepIdx(0);
    setDevOptions((prev) => ({
      ...(INITIAL_DEV_OPTIONS),
      // Preserve persona / personaLocked so a super_admin doesn't get
      // dropped back to consumer mid-debug.
      persona: prev.persona,
      personaLocked: prev.personaLocked,
    }));
  }, [resetForm]);

  // wizardNav — DEV CONTROLS Section 11 (Jump to screen). The panel
  // expects `screen` (a step name) and `goToScreen(stepKey)`. We map
  // step names to indices via getSequence() so the panel and the
  // wizard agree on the active step.
  const sequence = useMemo(
    () => getSequence(form, form.hasCoApplicant === true),
    [form]
  );
  const screen = sequence[Math.min(stepIdx, sequence.length - 1)] || sequence[0];

  const goToScreen = useCallback(
    (stepKey: ScreenKey): void => {
      // 'embedded_entry' is a pseudo-step the prototype's screen list
      // included for the standalone shell entry card. We don't have a
      // distinct embedded_entry surface in refi-portal yet, so jump to
      // step 0 (vehicle_add) as the closest neighbor.
      if (stepKey === 'embedded_entry') {
        setStepIdx(0);
        return;
      }
      const idx = sequence.indexOf(stepKey);
      if (idx >= 0) setStepIdx(idx);
    },
    [sequence]
  );

  const formState = useMemo(
    () => ({ form, update: updateForm, applyPrefill, resetAll }),
    [form, updateForm, applyPrefill, resetAll]
  );
  const wizardNav = useMemo(
    () => ({ screen, goToScreen, sequence }),
    [screen, goToScreen, sequence]
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <TopBar
        panelOpen={panelOpen}
        togglePanel={() => setPanelOpen((o) => !o)}
        view={view}
      />
      <div className="flex">
        <DevControls
          open={panelOpen}
          view={view}
          setView={setView}
          devOptions={devOptions}
          setDevOptions={setDevOptions}
          formState={formState}
          wizardNav={wizardNav}
        />
        <main className="flex-1 p-8">
          <div className="max-w-3xl mx-auto">
            <ViewSwitcher
              view={view}
              devOptions={devOptions}
              form={form}
              updateForm={updateForm}
              stepIdx={stepIdx}
              setStepIdx={setStepIdx}
            />
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;
