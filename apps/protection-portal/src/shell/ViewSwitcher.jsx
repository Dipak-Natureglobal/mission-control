// Per CLAUDE.md "Three views in one app":
//   ?view=customer | agent | partner  -> renders the right view.
// DEV CONTROLS lets you flip without changing the URL (handled in App.jsx).
//
// Phase 1A: customer + agent views are wired. Partner view remains a
// placeholder; it's a re-skin of the same wizard with partner chrome
// and pre-fill from partner-supplied lead data, owned by customer-portal.
import { CustomerView } from '../views/customer/CustomerView.jsx';
import { AgentView } from '../views/agent/index.js';

const PLACEHOLDERS = {
  partner: {
    title: 'Partner view',
    blurb: 'Partner-embedded surface with tighter chrome and partner co-branding. Hosted inside customer-portal/workflows/protection/.',
  },
};

export const VIEW_KEYS = ['customer', 'agent', 'partner'];

export function readViewFromUrl(defaultView = 'customer') {
  if (typeof window === 'undefined') return defaultView;
  const v = new URLSearchParams(window.location.search).get('view');
  return VIEW_KEYS.includes(v) ? v : defaultView;
}

export function ViewSwitcher({
  view,
  devOptions,
  // Optional — App.jsx owns the agent wizard form state in the post-1.5
  // dev-controls lift so the left DevPanel can read + drive it. When
  // these props are absent (e.g. partner placeholder), AgentView falls
  // back to internal state. CustomerView keeps its own internal state.
  agentForm,
  agentUpdate,
  agentStepIdx,
  agentSetStepIdx,
}) {
  const showInsuranceCrossSell = devOptions?.showInsuranceCrossSell ?? true;
  const crossSellOverrides = devOptions?.crossSellOverrides;
  const seedMultiContactHousehold = devOptions?.seedMultiContactHousehold ?? false;
  if (view === 'customer')
    return (
      <CustomerView
        showInsuranceCrossSell={showInsuranceCrossSell}
        crossSellOverrides={crossSellOverrides}
        seedMultiContactHousehold={seedMultiContactHousehold}
      />
    );
  if (view === 'agent')
    return (
      <AgentView
        seedMultiContactHousehold={seedMultiContactHousehold}
        showInsuranceCrossSell={showInsuranceCrossSell}
        crossSellOverrides={crossSellOverrides}
        form={agentForm}
        update={agentUpdate}
        stepIdx={agentStepIdx}
        setStepIdx={agentSetStepIdx}
      />
    );

  const meta = PLACEHOLDERS[view] || PLACEHOLDERS.partner;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8">
      <div className="text-xs uppercase tracking-wide text-blue-600 font-semibold mb-2">
        Hello — Protection Portal
      </div>
      <h1 className="text-2xl font-semibold tracking-tight mb-2">{meta.title}</h1>
      <p className="text-sm text-slate-600 mb-6 leading-relaxed">{meta.blurb}</p>
      <div className="text-xs text-slate-500 border-t border-slate-100 pt-4">
        Phase 1A scaffolding — partner view lands when customer-portal wires its public chrome.
      </div>
    </div>
  );
}
