import type { FC } from 'react';
import { CustomerView } from '../views/customer/CustomerView';
import { AgentView } from '../views/agent/AgentView';
import type { ViewType, RefiForm, WizardDevOptions } from '../types';

const PLACEHOLDERS = {
  partner: {
    title: 'Partner view',
    blurb: 'Partner-embedded surface with tighter chrome and partner co-branding. Hosted inside customer-portal/workflows/refi/ once that app comes online.',
  },
};

export const VIEW_KEYS: ViewType[] = ['customer', 'agent', 'partner'];

export function readViewFromUrl(defaultView: ViewType = 'customer'): ViewType {
  if (typeof window === 'undefined') return defaultView;
  const v = new URLSearchParams(window.location.search).get('view');
  return VIEW_KEYS.includes(v as ViewType) ? (v as ViewType) : defaultView;
}

interface ViewSwitcherProps {
  view: ViewType;
  devOptions?: Partial<WizardDevOptions>;
  form: RefiForm;
  updateForm: (updates: Partial<RefiForm>) => void;
  stepIdx: number;
  setStepIdx: (idx: number) => void;
}

const ViewSwitcher: FC<ViewSwitcherProps> = ({
  view,
  devOptions,
  form,
  updateForm,
  stepIdx,
  setStepIdx,
}) => {
  if (view === 'customer') {
    return (
      <CustomerView
        persona={devOptions?.persona ?? 'consumer'}
        personaLocked={devOptions?.personaLocked ?? false}
        form={form}
        update={updateForm}
        stepIdx={stepIdx}
        setStepIdx={setStepIdx}
        dev={devOptions}
      />
    );
  }

  if (view === 'agent') {
    return (
      <AgentView
        persona={devOptions?.persona ?? 'agent'}
        personaLocked={devOptions?.personaLocked ?? false}
        form={form}
        update={updateForm}
        stepIdx={stepIdx}
        setStepIdx={setStepIdx}
        dev={devOptions}
      />
    );
  }

  const meta = PLACEHOLDERS[view as keyof typeof PLACEHOLDERS] ?? PLACEHOLDERS.partner;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8">
      <div className="text-xs uppercase tracking-wide text-blue-600 font-semibold mb-2">
        Hello — Refi Portal
      </div>
      <h1 className="text-2xl font-semibold tracking-tight mb-2">{meta.title}</h1>
      <p className="text-sm text-slate-600 mb-6 leading-relaxed">{meta.blurb}</p>
      <div className="text-xs text-slate-500 border-t border-slate-100 pt-4">
        Phase 1.5b scaffolding — this view lands in a later session.
      </div>
    </div>
  );
};

export { ViewSwitcher };
export default ViewSwitcher;
