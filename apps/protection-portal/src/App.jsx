// Top-level shell. Per CLAUDE.md this is the canonical Protection Portal
// app — substrate matches the refi prototype (Vite + React 19 + JS, no TS,
// monolithic App.jsx with a DEV CONTROLS sidebar pattern).
//
// Phase 1A scope: dev sidebar + top bar + URL-driven view switcher +
// placeholder views. Workflow screens land next.
//
// Form ownership: Wave 14 (post-1.5 dev-controls lift) — when ?view=agent,
// App.jsx owns the wizard's form + stepIdx and threads them into both
// AgentView (so the wizard renders against shared state) and DevControls
// (so the lifted Force-complete + JsonPeek sections in the left panel
// drive AgentView's wizard). CustomerView keeps its own internal state
// for now — its self-serve flow has too much internal logic to lift in
// this pass.
import { useState, useEffect } from 'react';
import { TopBar } from './shell/TopBar.jsx';
import { DevControls } from './shell/DevControls.jsx';
import { ViewSwitcher, readViewFromUrl, VIEW_KEYS } from './shell/ViewSwitcher.jsx';
import { useForm } from './hooks/useForm.js';
import { INITIAL_FORM } from './views/customer/CustomerView.jsx';

export default function App() {
  const [panelOpen, setPanelOpen] = useState(true);
  const [view, setView] = useState(() => readViewFromUrl('customer'));

  // Per-view DEV CONTROLS knobs. Default values are the production-leaning
  // ones (cross-sell on) so the first paint matches what a real consumer
  // would see; the panel lets us flip them to demo edge cases.
  const [devOptions, setDevOptions] = useState({
    showInsuranceCrossSell: true,
    // BillingPayment household switcher seed (Phase 1, real data wiring
    // deferred). When ON, CustomerView/AgentView seed
    // form.contact.household_members with three mock members + an
    // alternate address so the multi-contact + multi-address dropdowns
    // on BillingPayment are testable end-to-end.
    seedMultiContactHousehold: false,
  });

  // Agent wizard state — owned here so DevControls can drive Force-
  // complete + read live form state for the JsonPeek panel. Mirrors the
  // refi-portal AgentView contract where App owns shared form state and
  // threads it through ViewSwitcher → AgentView. The customer view
  // continues to own its own form state internally.
  const [agentForm, agentUpdate] = useForm(INITIAL_FORM);
  const [agentStepIdx, agentSetStepIdx] = useState(0);

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

  // Phase 1A skeleton of the protection-package state. Real shape gets
  // pulled from the StoneEagle GetRates fixture once the workflow lands.
  const packageState = {
    view,
    phase: '1A · scaffolding',
    devOptions,
    package: {
      vehicle: null,
      coverage: null,
      contact: null,
      payment: null,
      agreements: null,
      status: 'not_started',
    },
    available_views: VIEW_KEYS,
  };

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
          packageState={packageState}
          devOptions={devOptions}
          setDevOptions={setDevOptions}
          form={agentForm}
          updateForm={agentUpdate}
          persona="agent"
        />
        <main className="flex-1 p-8">
          <div className="max-w-3xl mx-auto">
            <ViewSwitcher
              view={view}
              devOptions={devOptions}
              agentForm={agentForm}
              agentUpdate={agentUpdate}
              agentStepIdx={agentStepIdx}
              agentSetStepIdx={agentSetStepIdx}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
