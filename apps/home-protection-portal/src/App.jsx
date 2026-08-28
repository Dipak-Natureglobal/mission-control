// Top-level shell for home-protection-portal — the Home Protection Plan
// consumer wizard (ADR 30 D3). Substrate matches protection-portal: Vite +
// React 19 + JS (no TS) + lucide-react, a monolithic App.jsx with a DEV
// CONTROLS sidebar, and a URL-driven view switcher.
//
// Form ownership mirrors protection-portal: when ?view=agent, App.jsx owns
// the wizard's form + stepIdx and threads them into BOTH AgentView (so the
// wizard renders against shared state) and DevControls (so the lifted
// Force-state + JsonPeek sections drive the same wizard). CustomerView keeps
// its own internal state.
import { useState, useEffect } from 'react';
import { TopBar } from './shell/TopBar.jsx';
import { DevControls } from './shell/DevControls.jsx';
import { ViewSwitcher, readViewFromUrl, VIEW_KEYS } from './shell/ViewSwitcher.jsx';
import { useForm } from './hooks/useForm.js';
import { INITIAL_FORM } from './views/customer/CustomerView.jsx';

export default function App() {
  const [panelOpen, setPanelOpen] = useState(true);
  const [view, setView] = useState(() => readViewFromUrl('customer'));

  const [devOptions, setDevOptions] = useState({
    seedMultiContactHousehold: false,
  });

  const [agentForm, agentUpdate] = useForm(INITIAL_FORM);
  const [agentStepIdx, agentSetStepIdx] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('view') !== view) {
      url.searchParams.set('view', view);
      window.history.replaceState({}, '', url.toString());
    }
  }, [view]);

  const packageState = {
    view,
    devOptions,
    package: {
      home: agentForm.home,
      dwelling_class: agentForm.home?.dwelling_class ?? null,
      plan: agentForm.selectedPlan,
      coverage_term: agentForm.coverageTerm,
      add_ons: agentForm.selectedAddOns,
      payment: agentForm.paymentSchedule,
      status: agentForm.status,
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
