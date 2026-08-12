// Customer view container — renders RefiWizard with state owned by
// App.jsx (Phase 1.5e — lifted up from local state so DEV CONTROLS
// can drive prefill / jump-to-screen / force outcomes).
//
// Embed-contract props { persona, personaLocked } are accepted per
// architecture/02-integration-boundaries.md. Today they're surfaced in
// JSON for sanity-checking; copy-variant gating lands in a later
// session.
//
// State props (from App.jsx via ViewSwitcher):
//   form, update, stepIdx, setStepIdx — the shared refi form state.
//   dev — the full devOptions slice. Threaded through to RefiWizard so
//         the decision engine screen can read forcePartner /
//         forceResult / disqualReason / includeSsn / coAppOverride /
//         orgConfig and route via runDecision().
import type { FC } from 'react';
import { RefiWizard } from './RefiWizard';
import type { RefiForm, WizardDevOptions, Persona } from '../../types';

interface CustomerViewProps {
  persona?: Persona;
  personaLocked?: boolean;
  form: RefiForm;
  update: (updates: Partial<RefiForm>) => void;
  stepIdx: number;
  setStepIdx: (idx: number) => void;
  dev?: Partial<WizardDevOptions>;
}

export const CustomerView: FC<CustomerViewProps> = ({
  persona = 'consumer',
  personaLocked = false,
  form,
  update,
  stepIdx,
  setStepIdx,
  dev,
}) => {
  return (
    <div>
      <RefiWizard
        form={form}
        update={update}
        stepIdx={stepIdx}
        setStepIdx={setStepIdx}
        dev={dev}
      />
      {/*
        Persona props are accepted but not yet surfaced in the wizard
        chrome — copy variants and affordance gating land in a later
        session. Render them as a small JSON tag so we can confirm
        DEV CONTROLS is threading them through.
      */}
      <div className="mt-4 text-xs font-mono text-slate-400 text-right">
        {`{ persona: "${persona}", personaLocked: ${personaLocked} }`}
      </div>
    </div>
  );
}
