// ?view=customer | agent | partner -> renders the right view.
// DEV CONTROLS lets you flip without changing the URL (handled in App.jsx).
//
// Mirrors protection-portal/src/shell/ViewSwitcher.jsx. The partner view is
// a placeholder: it is a re-skin of the same wizard with partner chrome,
// owned by customer-portal.
import { CustomerView } from '../views/customer/CustomerView.jsx';
import { AgentView } from '../views/agent/index.js';

const PLACEHOLDERS = {
  partner: {
    title: 'Partner view',
    blurb:
      'Partner-embedded surface with tighter chrome and partner co-branding. Hosted inside customer-portal/workflows/home-protection/.',
  },
};

// eslint-disable-next-line react-refresh/only-export-components
export const VIEW_KEYS = ['customer', 'agent', 'partner'];

// eslint-disable-next-line react-refresh/only-export-components
export function readViewFromUrl(defaultView = 'customer') {
  if (typeof window === 'undefined') return defaultView;
  const v = new URLSearchParams(window.location.search).get('view');
  return VIEW_KEYS.includes(v) ? v : defaultView;
}

export function ViewSwitcher({
  view,
  devOptions,
  // App.jsx owns the agent wizard form state so the left DevPanel can read
  // and drive it. CustomerView keeps its own internal state.
  agentForm,
  agentUpdate,
  agentStepIdx,
  agentSetStepIdx,
}) {
  const seedMultiContactHousehold = devOptions?.seedMultiContactHousehold ?? false;

  if (view === 'customer') {
    return (
      <CustomerView
        seedMultiContactHousehold={seedMultiContactHousehold}
        form={agentForm}
        update={agentUpdate}
      />
    );
  }
  if (view === 'agent') {
    return (
      <AgentView
        seedMultiContactHousehold={seedMultiContactHousehold}
        form={agentForm}
        update={agentUpdate}
        stepIdx={agentStepIdx}
        setStepIdx={agentSetStepIdx}
      />
    );
  }

  const meta = PLACEHOLDERS[view] || PLACEHOLDERS.partner;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8">
      <div className="text-xs uppercase tracking-wide text-teal-600 font-semibold mb-2">
        Hello — Home Protection Portal
      </div>
      <h1 className="text-2xl font-semibold tracking-tight mb-2">{meta.title}</h1>
      <p className="text-sm text-slate-600 mb-6 leading-relaxed">{meta.blurb}</p>
      <div className="text-xs text-slate-500 border-t border-slate-100 pt-4">
        Wave 39 scaffolding — partner view lands when customer-portal wires its public chrome.
      </div>
    </div>
  );
}
