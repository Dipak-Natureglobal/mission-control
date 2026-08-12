// Lightweight chrome exports for the cross-sell sub-flow — split out
// from CrossSellSubFlow.jsx so callers (CustomerView, AgentView) can
// import the breadcrumb + workflow-icon map without dragging in the
// refi-portal monolith. The heavy CrossSellSubFlow body is React.lazy'd
// at the call site; this module stays in the initial bundle.

import { ArrowLeft, ChevronRight, TrendingDown, Calculator, Loader2 } from 'lucide-react';

const WORKFLOW_LABELS = {
  insurance: 'Find insurance savings',
  refi: 'Lower your monthly with refinance',
};

/**
 * Breadcrumb — the "Coverage › Find insurance savings" header. First
 * crumb is a back-link to RecommendedCoverage; second crumb is the
 * active workflow label.
 */
export function CrossSellBreadcrumb({ workflow, onBack }) {
  const label = WORKFLOW_LABELS[workflow] || workflow;
  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-4 flex items-center gap-1.5 text-xs text-slate-600"
    >
      <button
        onClick={onBack}
        className="flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-100 text-slate-700 hover:text-slate-900 font-medium"
      >
        <ArrowLeft className="w-3 h-3" /> Coverage
      </button>
      <ChevronRight className="w-3 h-3 text-slate-400" />
      <span className="text-slate-900 font-semibold truncate">{label}</span>
    </nav>
  );
}

/**
 * Icon map for the cross-sell pane chrome (AgentView side-pane title bar).
 * Kept here next to the breadcrumb so the heavy CrossSellSubFlow module
 * stays self-contained for code-splitting.
 */
export const WORKFLOW_ICONS = { insurance: TrendingDown, refi: Calculator };

/**
 * Suspense fallback for the lazy-loaded CrossSellSubFlow body. Matches
 * the substrate's existing inline loading pattern (Loader2 + animate-spin
 * + slate-500 text — see VehicleAdd's "Decoding VIN…" treatment).
 */
export function CrossSellLoading() {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-12 flex items-center justify-center gap-2 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading…
      </div>
    </div>
  );
}
