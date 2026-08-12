// DEV CONTROLS sidebar — refi-portal port-forward of the prototype's
// DevPanel (refinance-v2-prototype.jsx ~L1278). 14 sections of force-
// outcomes, prefill, and screen-jump controls, plus the platform's
// persona / persona-locked / form-state JsonPeek slice at the top.
//
// This file owns ONLY the panel contents. Sidebar chrome (dark wrapper,
// Section, Segmented) lives in src/shared/DevPanel.jsx — same primitives
// every app uses, lifted from protection-portal.
//
// Wave 14 (2026-05-04): the section bodies were extracted into
// src/shell/RefiDevControls.jsx so mission-control can render them inside
// its consolidated DevPanel without refi-portal's outer chrome. This file
// now just adds the standalone "View" Section + DevPanel wrapper around
// the shared body. Standalone DEV CONTROLS surface is byte-identical to
// pre-Wave-14.
//
// State ownership: the panel reads + mutates THREE slices owned by App.jsx:
//   * devOptions  — persona, personaLocked, forcePartner, forceResult,
//                   disqualReason, includeSsn, coAppOverride, showJson,
//                   prefillJson, orgConfig, orgConfigJson, orgConfigError,
//                   embeddedState
//   * formState   — passed down as { form, update } so the protection-plan
//                   / insurance-reviewed / insurance-savings toggles can
//                   write to the wizard's form
//   * wizardNav   — { screen, goToScreen, sequence } so the "Jump to
//                   screen" section can read the active step and jump
import type { FC } from 'react';
import { DevPanel, Section, Segmented } from 'blinker-platform/components';
import { RefiDevControls } from './RefiDevControls';
import { VIEW_KEYS } from './ViewSwitcher';
import type { ViewType, WizardDevOptions, FormState, WizardNav } from '../types';

interface DevControlsProps {
  open: boolean;
  view: ViewType;
  setView: (view: ViewType) => void;
  devOptions: WizardDevOptions;
  setDevOptions: (updater: (prev: WizardDevOptions) => WizardDevOptions) => void;
  formState: FormState;
  wizardNav: WizardNav;
}

export const DevControls: FC<DevControlsProps> = ({
  open, view, setView,
  devOptions, setDevOptions,
  formState,
  wizardNav,
}) => {
  return (
    <DevPanel open={open}>
      {/* Platform-substrate sections — present in every app. */}
      <Section label="View">
        <Segmented
          value={view}
          onChange={setView as (v: string) => void}
          options={VIEW_KEYS.map((v) => ({ v, l: v[0].toUpperCase() + v.slice(1) }))}
        />
        <p className="text-xs text-slate-500 mt-2 leading-snug">
          Mirrors <span className="font-mono">?view=</span> in the URL. Customer
          + agent are wired in § 1.5c; partner lands in § 1.5d/e.
        </p>
      </Section>

      <RefiDevControls
        devOptions={devOptions}
        setDevOptions={setDevOptions}
        formState={formState}
        wizardNav={wizardNav}
      />
    </DevPanel>
  );
}
