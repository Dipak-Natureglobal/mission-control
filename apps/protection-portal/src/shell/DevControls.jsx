// DEV CONTROLS sidebar contents — the standalone (App.jsx) variant.
// The chrome (dark sidebar, Section, Segmented) lives in
// src/shared/DevPanel.jsx; the portal-specific cross-sell + form-state
// sections live in ProtectionDevControls.jsx so the embed-friendly
// variant stays in sync. This file only owns the chrome + the
// View switcher + the Package state JsonPeek (the two sections that
// don't make sense when AgentView is embedded inside CoPilotPane,
// because mission-control owns the View switching and its own payload
// mirror).
//
// Confirm-step cross-sell vs RecommendedCoverage cross-sell:
//   `showInsuranceCrossSell` is the older toggle from § 1.5b; it gates
//   the SavingsCard on the Confirm step where the insurance cross-sell
//   first landed. The newer `crossSellOverrides.{insurance,refi}_enabled`
//   gates the RecommendedCoverage-step CTAs from § 1.5d. They're
//   independent — keep them separate so a demo can flip one without
//   the other (e.g. "consumer sees the savings card on Confirm but
//   the agent CTA upstream was disabled").
import { DevPanel, Section, Segmented } from 'blinker-platform/components';
import { JsonPeek } from 'blinker-platform/components';
import { VIEW_KEYS } from './ViewSwitcher.jsx';
import { ProtectionDevControls } from './ProtectionDevControls.jsx';

export function DevControls({
  open,
  view,
  setView,
  packageState,
  devOptions,
  setDevOptions,
  // Optional — App.jsx threads the lifted agent form state through so
  // the Force-complete + Form state sections (rendered by the embedded
  // ProtectionDevControls body) drive AgentView's wizard. Standalone
  // customer/partner views ignore these.
  form,
  updateForm,
  persona = 'agent',
}) {
  return (
    <DevPanel open={open}>
      <Section label="View">
        <Segmented
          value={view}
          onChange={setView}
          options={VIEW_KEYS.map((v) => ({ v, l: v[0].toUpperCase() + v.slice(1) }))}
        />
        <p className="text-xs text-slate-500 mt-2 leading-snug">
          Mirrors <span className="font-mono">?view=</span> in the URL. Customer
          view ships first per the consumer self-serve PDF mockup.
        </p>
      </Section>

      <ProtectionDevControls
        devOptions={devOptions}
        setDevOptions={setDevOptions}
        form={form}
        updateForm={updateForm}
        persona={persona}
      />

      <Section label="Package state">
        <JsonPeek label="package · phase 1 skeleton" data={packageState} />
        <p className="text-xs text-slate-500 mt-2 leading-snug">
          Status transitions surface here as the workflow takes shape — this is
          the JsonPeek the Phase 1 acceptance check is asking for.
        </p>
      </Section>
    </DevPanel>
  );
}
