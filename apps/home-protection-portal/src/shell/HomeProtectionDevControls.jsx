// HomeProtectionDevControls — the CHROME-LESS dev-controls body.
//
// Two hosts render this exact component:
//   1. src/shell/DevControls.jsx  (standalone, wraps it in <DevPanel>)
//   2. mission-control's consolidated DevPanel, when CoPilot is open on a
//      home_protection opportunity (Phase C).
//
// Per the parallel-dev-panels lesson (feedback_parallel_dev_panels): when a
// standalone shell and an embed fragment both need the same knobs, the knobs
// live in ONE component and the hosts own only the chrome. Adding a toggle
// here reaches both surfaces; adding it to DevControls.jsx reaches only one.
//
// Contract — purely controlled, owns no state of its own:
//   devOptions     parent-owned object. Reads `seedMultiContactHousehold`.
//   setDevOptions  functional updater (prev) => next.
//   form?          the wizard form threaded into AgentView. When present
//                  alongside updateForm, the Force-state + Form-state
//                  sections render; when absent they are skipped.
//   updateForm?    (patch) => void — same shallow-merge setter as useForm.
//   persona?       tagged onto the telemetry the force buttons fire.
import { Section, Segmented, JsonPeek } from 'blinker-platform/components';
import { track } from 'blinker-platform/telemetry';
import { resolveSigningMode } from 'blinker-platform/integrations/signing';

// Two ready-made homes for smoke-testing the eligibility gate on HomeAdd
// without re-typing the form. The ineligible one is a 9,000 sq ft
// condominium — over the condo bucket's 4,999 ceiling, so classifyDwelling
// returns null and the quote must be blocked (ADR 30 R2).
const SEED_HOMES = {
  eligible: {
    home_type: 'single_family',
    address: { address1: '17547 Murray Hill Street', address2: '', city: 'Detroit', state: 'MI', zip: '48235', zip4: '', country: 'US' },
    year_built: 1998,
    square_feet: 2400,
    purchase_price: 285000,
  },
  ineligible: {
    home_type: 'condominium',
    address: { address1: '900 Lakeshore Dr', address2: 'PH 2', city: 'Chicago', state: 'IL', zip: '60611', zip4: '', country: 'US' },
    year_built: 2012,
    square_feet: 9000,
    purchase_price: 1450000,
  },
};

export function HomeProtectionDevControls({
  devOptions,
  setDevOptions,
  form,
  updateForm,
  persona = 'agent',
}) {
  const seedMultiContactHousehold = devOptions?.seedMultiContactHousehold ?? false;
  const showFormSections = !!form && typeof updateForm === 'function';

  function seedHome(kind) {
    updateForm({
      home: { ...(form.home || {}), ...SEED_HOMES[kind] },
      // A different home means a different quote — never carry rates or a
      // plan across (the selection's option ids and prices are plan+term
      // scoped, ADR 30 D7).
      rates: null,
      selectedPlan: null,
      selectedAddOns: [],
      coverageTerm: null,
      paymentSchedule: null,
      payment: null,
    });
    track('home_protection.dev.seed_home', { kind, persona });
  }

  return (
    <>
      <Section label="Contacts">
        <Segmented
          value={seedMultiContactHousehold ? 'on' : 'off'}
          onChange={(v) =>
            setDevOptions((prev) => ({ ...prev, seedMultiContactHousehold: v === 'on' }))
          }
          options={[{ v: 'off', l: 'Off' }, { v: 'on', l: 'Seed household' }]}
        />
        <p className="text-xs text-slate-500 mt-2 leading-snug">
          Seeds a mock multi-contact household so the BillingPayment contact /
          address switchers and the second agreement holder slot (ADR 30 D2)
          are testable end-to-end.
        </p>
      </Section>

      <Section label="Signing">
        <p className="text-xs text-slate-500 leading-snug">
          DocuSeal mode: <span className="font-mono text-slate-300">{resolveSigningMode()}</span>.
          In <span className="font-mono">fixture</span> mode the sign step renders the
          resolved template id and the full 37-field payload in an inspector
          panel instead of mounting a live iframe.
        </p>
      </Section>

      {showFormSections && (
        <>
          <Section label="Force state">
            <div className="grid grid-cols-2 gap-2">
              <DevButton onClick={() => seedHome('eligible')}>Seed eligible home</DevButton>
              <DevButton onClick={() => seedHome('ineligible')}>Seed ineligible home</DevButton>
              <DevButton
                onClick={() => {
                  updateForm({ selectedAddOns: [] });
                  track('home_protection.dev.addons_cleared', { persona });
                }}
              >
                Clear add-ons
              </DevButton>
              <DevButton
                onClick={() => {
                  updateForm({ homeFeatures: {} });
                  track('home_protection.dev.features_cleared', { persona });
                }}
              >
                Clear features
              </DevButton>
            </div>
            <p className="text-xs text-slate-500 mt-2 leading-snug">
              Seeding a home clears rates, plan, term, and add-on selections —
              a stale selection carried across a re-quote would mischarge a
              signed agreement (ADR 30 D7).
            </p>
          </Section>

          <Section label="Form state">
            <JsonPeek label="home" data={form.home} />
            <JsonPeek label="homeFeatures" data={form.homeFeatures} />
            <JsonPeek label="selectedPlan · coverageTerm" data={{ selectedPlan: form.selectedPlan, coverageTerm: form.coverageTerm }} />
            <JsonPeek label="selectedAddOns" data={form.selectedAddOns} />
            <JsonPeek label="paymentSchedule" data={form.paymentSchedule} />
          </Section>
        </>
      )}
    </>
  );
}

function DevButton({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[11px] px-2 py-1.5 rounded-md border border-slate-600 text-slate-200 hover:bg-slate-700 text-left"
    >
      {children}
    </button>
  );
}
