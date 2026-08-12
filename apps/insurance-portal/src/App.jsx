// Top-level shell. Per CLAUDE.md this is the canonical Insurance Portal
// app — substrate matches protection-portal (Vite + React 19 + JS, no TS,
// monolithic App.jsx with a DEV CONTROLS sidebar pattern).
//
// Workflow shape reflects the real EI contract (see
// architecture/06-embedded-insurance-contract.md). Notable changes
// from earlier prototype iterations:
//   - flowPath stored on the workflow (set when a lead is created via
//     the agent view; selected via DEV CONTROLS toggle in the dev shape).
//   - consumer_link replaces capture_link — single URL field is
//     semantically the same regardless of flow path; status taxonomy
//     (capture_link.* vs quote_link.*) discriminates path for analytics.
//   - capture / quote / policy each hold the relevant `summary` slice
//     from EI's lead_summary webhook envelope.
//   - dev shape carries flowPath + outcome selectors used at lead
//     creation time.
import { useState, useEffect, useCallback } from 'react';
import { TopBar } from './shell/TopBar.jsx';
import { DevControls } from './shell/DevControls.jsx';
import { ViewSwitcher, readViewFromUrl, VIEW_KEYS } from './shell/ViewSwitcher.jsx';
import { STATUS } from './constants/status-map.js';

const INITIAL_WORKFLOW = {
  flowPath: null,         // 'capture_and_quote' | 'quote_only' — stamped on lead create
  consumer_link: null,    // { url, token, generatedAt, sentAt } — same field for both paths
  lead: null,             // { leadId, partnerExternalId } from createLead
  capture: null,          // { eventId, eventTime, verification } — only Capture+Quote
  quote: null,            // { eventId, eventTime, payload } — quote summary
  policy: null,           // { eventId, eventTime, payload } — policy summary
  status: STATUS.NOT_STARTED,
  // Wave 31 v3.0.11 — vehicle slot. Populated by CustomerView's VehicleDrive
  // step (mileage, condition, purchase_date, annual_miles_estimate) and the
  // VehicleAdd pre-step in AgentView (vin, year, make, model, trim). Phase-1
  // ephemeral — Phase-2 wires through blinkerApi.vehicles.* per
  // architecture/07-data-layer.md.
  vehicle: null,          // { vin, year, make, model, trim, mileage, condition,
                          //   purchase_date, annual_miles_estimate }
  // Agent notes + tags (Wave 12c). Parent-owned; consumed by the
  // shared NotesPanel in views/agent/AgentView. Phase-1 ephemeral —
  // Phase-2 wires through blinkerApi.{notes,tags}.* per
  // architecture/07-data-layer.md.
  notes: '',              // string — single agent-notes blob
  tags: [],               // string[] — tag IDs applied to the contact
  tagsCreated: [],        // Tag[]  — manager+ session-created tags
};

const INITIAL_DEV = {
  // Default flow path the agent's LeadOriginationForm offers.
  flowPath: 'capture_and_quote',
  // Verification webhook outcome (capture_and_quote only):
  // 'completed' | 'error'.
  nextVerificationOutcome: 'completed',
  // Quote webhook outcome (both paths): 'completed' | 'error'.
  nextQuoteOutcome: 'completed',
  // Quote savings outcome (Wave 31b-fu): 'savings' | 'no_savings'.
  // Controls whether quote.completed fires with a positive
  // savingsAmountCents (savings) or 0 (no_savings) so the agent can
  // demo both InsuranceSavingsCard states in isolation.
  quoteSavingsOutcome: 'savings',
};

export default function App() {
  const [panelOpen, setPanelOpen] = useState(true);
  const [view, setView] = useState(() => readViewFromUrl('customer'));
  const [workflow, setWorkflow] = useState(INITIAL_WORKFLOW);
  const [dev, setDev] = useState(INITIAL_DEV);

  const updateWorkflow = useCallback((patch) => {
    setWorkflow((prev) => ({ ...prev, ...patch }));
  }, []);
  const resetWorkflow = useCallback(() => {
    setWorkflow(INITIAL_WORKFLOW);
  }, []);
  const updateDev = useCallback((patch) => {
    setDev((prev) => ({ ...prev, ...patch }));
  }, []);

  // Keep ?view= in sync when DEV CONTROLS flips the view.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('view') !== view) {
      url.searchParams.set('view', view);
      window.history.replaceState({}, '', url.toString());
    }
  }, [view]);

  const workflowState = {
    view,
    phase: '1 · ei-real-contract',
    workflow,
    dev,
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
          workflowState={workflowState}
          resetWorkflow={resetWorkflow}
          dev={dev}
          updateDev={updateDev}
          workflow={workflow}
          updateWorkflow={updateWorkflow}
        />
        <main className="flex-1 p-8">
          <div className="max-w-3xl mx-auto">
            <ViewSwitcher
              view={view}
              workflow={workflow}
              updateWorkflow={updateWorkflow}
              dev={dev}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
