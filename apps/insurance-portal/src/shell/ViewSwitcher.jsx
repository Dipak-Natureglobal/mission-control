// Per CLAUDE.md "Three views in one app":
//   ?view=customer | agent | partner  -> renders the right view.
// DEV CONTROLS lets you flip without changing the URL (handled in App.jsx).
//
// Phase 1: customer + agent views are real; partner is still a
// placeholder card.
import { CustomerView } from '../views/customer/CustomerView.jsx';
import { AgentView } from '../views/agent/index.js';

const PLACEHOLDERS = {
  partner: {
    title: 'Partner view',
    blurb: 'Partner-embedded capture form with tighter chrome and partner co-branding. Hosted inside customer-portal/workflows/insurance/.',
  },
};

export const VIEW_KEYS = ['customer', 'agent', 'partner'];

export function readViewFromUrl(defaultView = 'customer') {
  if (typeof window === 'undefined') return defaultView;
  const v = new URLSearchParams(window.location.search).get('view');
  return VIEW_KEYS.includes(v) ? v : defaultView;
}

export function ViewSwitcher({ view, workflow, updateWorkflow, dev }) {
  if (view === 'customer') {
    return (
      <CustomerView
        workflow={workflow}
        updateWorkflow={updateWorkflow}
        dev={dev}
      />
    );
  }
  if (view === 'agent') {
    return (
      <AgentView
        workflow={workflow}
        updateWorkflow={updateWorkflow}
        dev={dev}
      />
    );
  }
  const meta = PLACEHOLDERS[view] || PLACEHOLDERS.partner;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8">
      <div className="text-xs uppercase tracking-wide text-blue-600 font-semibold mb-2">
        Hello — Insurance Portal
      </div>
      <h1 className="text-2xl font-semibold tracking-tight mb-2">{meta.title}</h1>
      <p className="text-sm text-slate-600 mb-6 leading-relaxed">{meta.blurb}</p>
      <div className="text-xs text-slate-500 border-t border-slate-100 pt-4">
        Phase 1 scaffolding — partner view content lands later. Use the DEV CONTROLS
        sidebar (Eye toggle in top bar) to switch between customer / agent / partner.
      </div>
    </div>
  );
}
