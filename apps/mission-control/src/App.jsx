import { Suspense, lazy, useCallback, useMemo, useState } from 'react';
import { TopBar } from './shell/TopBar.jsx';
import { Nav } from './shell/Nav.jsx';
import { DevPanel, Section, Segmented, JsonBlock } from './shared/DevPanel.jsx';
import { JsonPeek } from 'blinker-platform/components';
import { NAV_BY_PERSONA, PERSONAS, getNavForManager } from './constants/nav.js';
import { blinkerApi } from 'blinker-platform/api';
import { MY_ID } from './shell/active-org-context.jsx';
import { AgentHome } from './personas/agent/AgentHome.jsx';
import { AgentCompete } from './personas/agent/AgentCompete.jsx';
import { AgentInbox } from './personas/agent/AgentInbox.jsx';
import { AgentContacts } from './personas/agent/AgentContacts.jsx';
import { AgentReports } from './personas/agent/AgentReports.jsx';
import { ManagerHome } from './personas/manager/ManagerHome.jsx';
import { ManagerTeam } from './personas/manager/ManagerTeam.jsx';
import { ManagerInbox } from './personas/manager/ManagerInbox.jsx';
import { Assignment as ManagerAssignment } from './personas/manager/Assignment.jsx';
import { ManagerMetrics } from './personas/manager/ManagerMetrics.jsx';
import { ManagerTags } from './personas/manager/ManagerTags.jsx';
import { AdminHome } from './personas/admin/AdminHome.jsx';
import { SuperHome } from './personas/super/SuperHome.jsx';
import { ActiveOrgProvider } from './shell/active-org-context.jsx';
import { useSessionData } from './lib/session-data.js';
import {
  ActiveWorkflowContext,
  useActiveWorkflow,
} from './lib/active-workflow.js';
import { getSequence } from 'refi-portal/src/lib/refi';
import { buildPrefillPatch } from './lib/refi-initial-form.js';
import orgRegistry from './constants/canon/org-registry.json';

// TODO(Wave 18-fu): replace with real active-org selector when agent persona's
// org switcher lands. Today defaults to the first canon org with test_mode:true
// so the demo experience is on by default.
const TEST_MODE = Array.isArray(orgRegistry.orgs) && orgRegistry.orgs.some((o) => o.test_mode === true);

// Top-level shell. Mirrors the refi-prototype / protection-portal pattern:
// monolithic App.jsx with a left DEV CONTROLS sidebar in dev, the real app to its right.
//
// Phase 1: persona switcher routes between four shells. Opportunity composition,
// fixtures, contact profile, and co-pilot pane land in subsequent phases.
//
// Phase 2 DevPanel consolidation: a single DevPanel surfaces persona, force
// status, prefill, inspector, the live CoPilot payload mirror, and per-
// workflow placeholder sections. The payload mirror + per-workflow sections
// read from <ActiveWorkflowContext> so CoPilotPane can publish the inbound
// + outbound shape without prop-drilling through AgentInbox.
//
// Wave 14: per-workflow placeholders are replaced with lazy-mounted
// DevControls components from each portal's public surface
// (ProtectionDevControls / RefiDevControls / InsuranceDevControls). State
// is lifted onto ActiveWorkflowContext so the same slice drives both the
// DevControls and the AgentView embed prop. When no CoPilot is open the
// section bodies stay as a hint and the lazy chunks are NOT pulled, so
// the standalone path's bundle stays minimal.

// Lazy-imports for each portal's chrome-less DevControls. Each portal
// already publishes the component on its `views/agent` public surface
// (Wave 14 commits 146ec0d / a7318c2 / 26a4891). Splitting them out keeps
// mission-control's initial bundle off the protection / refi / insurance
// chunks until the user actually opens a CoPilot of that kind.
const ProtectionDevControls = lazy(() =>
  import('protection-portal/src/views/agent').then((m) => ({
    default: m.ProtectionDevControls,
  })),
);
const RefiDevControls = lazy(() =>
  import('refi-portal/src/views/agent').then((m) => ({
    default: m.RefiDevControls,
  })),
);
const InsuranceDevControls = lazy(() =>
  import('insurance-portal/src/views/agent').then((m) => ({
    default: m.InsuranceDevControls,
  })),
);

// Initial values for the per-kind dev slices. Each portal's DevControls
// applies its own defaults via `?? fallback` reads, so empty-ish seeds
// are safe — but we seed the obvious ones explicitly so the consumed
// AgentView prop reads predictable values from the start.
//
// Protection: showInsuranceCrossSell defaults to true (Confirm-step
// SavingsCard visible by default — matches AgentView's prop default).
// Insurance: flowPath default mirrors the embed wrapper's previous seed
// in CoPilotPane (which fell back to 'capture_and_quote').
const INITIAL_PROTECTION_DEV = {
  showInsuranceCrossSell: true,
  crossSellOverrides: undefined,
  seedMultiContactHousehold: false,
};
const INITIAL_REFI_DEV = {};
const INITIAL_INSURANCE_DEV = {
  flowPath: 'capture_and_quote',
  nextVerificationOutcome: 'completed',
  nextQuoteOutcome: 'completed',
};

// noop — used for the disabled-state stubs in formState / wizardNav /
// updateWorkflow when no CoPilot of the matching kind is open. Stable
// reference so memoized parents don't churn.
const noop = () => {};

// makePartialSetter — wraps a useState setter so it accepts either a
// replacement object or a functional updater AND merges into the prior
// value. This matches the patch semantics each portal's DevControls
// already uses (RefiDevControls + InsuranceDevControls call updateDev /
// setDevOptions with both shapes interchangeably).
function makePartialSetter(setter) {
  return (nextOrFn) => {
    setter((prev) => {
      const patch = typeof nextOrFn === 'function' ? nextOrFn(prev) : nextOrFn;
      // Functional updaters in RefiDevControls return a fully-merged next
      // object (via `(prev) => ({ ...prev, ...patch })`), so we don't
      // double-merge here — that would erase deletions like
      // `crossSellOverrides: undefined`. Instead, treat the result as
      // authoritative when it came from a function, and merge when it
      // came as a bare patch object.
      if (typeof nextOrFn === 'function') return patch;
      return { ...(prev || {}), ...(patch || {}) };
    });
  };
}

function readInitialPersona() {
  if (typeof window === 'undefined') return 'agent';
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('as');
  if (fromUrl && PERSONAS.some((p) => p.value === fromUrl)) return fromUrl;
  return 'agent';
}

// Resolve the active manager's preset_id from the agents fixture. Phase 1
// reads the hard-coded MY_ID; Phase 2 swaps for a real auth identity. To
// demo `manager_assign_only` gating, swap MY_ID in active-org-context.jsx
// to an assign-only mgr id (e.g. seed `mgr_assign_demo` in agents.json
// when that fixture row lands — out of scope for Wave 28e).
function getManagerPresetId() {
  const me = blinkerApi.agents.get(MY_ID);
  return me?.preset_id || 'manager_standard';
}

// Default landing per persona. Manager defaults to 'team' (primary
// workbench per ADR 19); the `manager_assign_only` preset overrides to
// 'assignment' (the only screen visible). The rest fall through to the
// first nav item.
function defaultLandingKey(persona) {
  if (persona === 'manager') {
    if (getManagerPresetId() === 'manager_assign_only') return 'assignment';
    return 'team';
  }
  return NAV_BY_PERSONA[persona]?.[0]?.key;
}

export default function App() {
  const [persona, setPersona] = useState(readInitialPersona);
  const [activeKey, setActiveKey] = useState(() => defaultLandingKey(readInitialPersona()));
  const [devOpen, setDevOpen] = useState(true);
  const [showJson, setShowJson] = useState(false);
  // Single session-data bag, shared across AgentHome and AgentInbox so
  // adds in either surface stay in sync. Phase 2 swap point: the hook's
  // appenders become async API calls; the prop signature stays the same.
  const session = useSessionData();
  const [inboxDeepLinkOppId, setInboxDeepLinkOppId] = useState(null);
  // Inbox filter set by AgentHome type-tiles + status pills; shape: { type?, status?, stage? }
  // Wave 26a Phase 2: extended with `stage` (Open/Won/Lost/Abandoned) so Home's
  // funnel-header counts (Task 3F) and Lost Opportunities KPI (Task 3E) can deep-link
  // into Inbox filtered by CRM stage rather than a single canon status string.
  const [inboxFilter, setInboxFilter] = useState(null);
  // Contacts deep-link selector set by GlobalSearch (Task 2). When set,
  // AgentContacts opens the ContactProfile for that id on mount; the
  // consume callback clears it so re-navigating away + back doesn't auto-
  // reopen.
  const [contactsDeepLinkContactId, setContactsDeepLinkContactId] = useState(null);
  // Active CoPilot payload — owned here so the consolidated DevPanel can
  // mirror inbound (opportunity / contact / vehicle) and outbound (live
  // form/workflow) state. CoPilotPane writes via setActive(...) on mount,
  // setActive(prev => ...) on every embed onFormChange, and setActive(null)
  // on unmount. See src/lib/active-workflow.js.
  const [active, setActive] = useState(null);

  // Per-kind DEV CONTROLS slices (Wave 14). Lifted here so the DevControls
  // mounted inside ConsolidatedDevPanel and the AgentView embed mounted
  // inside CoPilotPane both read/write the same source of truth. Each
  // setter is wrapped with makePartialSetter so DevControls' patch-style
  // calls (`updateDev({ flowPath: v })`) and full-replace calls both work.
  const [protectionDev, setProtectionDevRaw] = useState(INITIAL_PROTECTION_DEV);
  const [refiDev, setRefiDevRaw] = useState(INITIAL_REFI_DEV);
  const [insuranceDev, setInsuranceDevRaw] = useState(INITIAL_INSURANCE_DEV);
  const setProtectionDev = makePartialSetter(setProtectionDevRaw);
  const setRefiDev = makePartialSetter(setRefiDevRaw);
  const setInsuranceDev = makePartialSetter(setInsuranceDevRaw);

  // Wave 14 follow-up — refi wizard form + step + insurance workflow are
  // also lifted onto context. CoPilotPane's RefiAgentEmbedInner /
  // InsuranceEmbed wrappers seed these on mount and clear them on
  // unmount; RefiDevControls (formState/wizardNav) and
  // InsuranceDevControls (workflow/updateWorkflow) read them via the
  // consolidated DevPanel below. The reset callbacks are registered by
  // the embed wrappers so RefiDevControls' "Reset prototype" button can
  // re-seed via the same code path the mount uses.
  //
  // Wave 14 follow-up (protection) — protection wizard form + step are
  // lifted onto context too so ProtectionDevControls' Force-complete +
  // Form state JsonPeek sections (which require `form` + `updateForm`
  // props) function in embedded mode. CoPilotPane's ProtectionEmbed
  // wrapper seeds protectionForm via buildProtectionInitialForm on
  // mount and clears on unmount, mirroring refi's pattern.
  const [protectionForm, setProtectionForm] = useState(null);
  const [protectionStepIdx, setProtectionStepIdx] = useState(0);
  const [resetProtectionForm, setResetProtectionForm] = useState(null);
  const [refiForm, setRefiForm] = useState(null);
  const [refiStepIdx, setRefiStepIdx] = useState(0);
  const [resetRefiForm, setResetRefiForm] = useState(null);
  const [insuranceWorkflow, setInsuranceWorkflow] = useState(null);
  const [resetInsuranceWorkflow, setResetInsuranceWorkflow] = useState(null);

  function handlePersonaChange(next) {
    setPersona(next);
    setActiveKey(defaultLandingKey(next));
    // PostHog: fire `persona_switched` here once posthog.js lib is wired.
  }

  function handleJumpToInbox(oppId) {
    setActiveKey('inbox');
    if (oppId) setInboxDeepLinkOppId(oppId);
  }

  // handleHomeFilter — called by AgentHome type-tile + status-pill +
  // funnel-header + Lost-Opps-KPI clicks. payload shapes:
  //   'by_type:<type>'                     — set type filter
  //   'by_status:<type>:<status>'          — set type + status
  //   'by_stage:<stage>'                   — set crm-stage filter
  //                                          (open | won | lost | abandoned)
  function handleHomeFilter(payload) {
    setActiveKey('inbox');
    if (!payload) {
      setInboxFilter(null);
      return;
    }
    if (payload.startsWith('by_type:')) {
      const type = payload.slice('by_type:'.length);
      setInboxFilter({ type });
    } else if (payload.startsWith('by_status:')) {
      const parts = payload.slice('by_status:'.length).split(':');
      const [type, ...rest] = parts;
      const status = rest.join(':');
      setInboxFilter({ type, status });
    } else if (payload.startsWith('by_stage:')) {
      const stage = payload.slice('by_stage:'.length);
      setInboxFilter({ stage });
    }
  }

  const handleOpenOppInCoPilot = useCallback((oppId) => {
    setInboxDeepLinkOppId(oppId);
    setActiveKey('inbox');
  }, []);

  // GlobalSearch result click → jump to Contacts view with that contact's
  // ContactProfile open. AgentContacts consumes the deep-link on mount.
  const handleGlobalSearchContactClick = useCallback((contactId) => {
    setPersona((p) => (p === 'agent' ? p : 'agent'));
    setActiveKey('contacts');
    setContactsDeepLinkContactId(contactId);
  }, []);

  return (
    <ActiveOrgProvider>
    <ActiveWorkflowContext.Provider
      value={{
        active,
        setActive,
        protectionDev,
        setProtectionDev,
        refiDev,
        setRefiDev,
        insuranceDev,
        setInsuranceDev,
        protectionForm,
        setProtectionForm,
        protectionStepIdx,
        setProtectionStepIdx,
        resetProtectionForm,
        setResetProtectionForm,
        refiForm,
        setRefiForm,
        refiStepIdx,
        setRefiStepIdx,
        resetRefiForm,
        setResetRefiForm,
        insuranceWorkflow,
        setInsuranceWorkflow,
        resetInsuranceWorkflow,
        setResetInsuranceWorkflow,
      }}
    >
      <div className="h-screen w-screen flex bg-slate-50 text-slate-900">
        {devOpen && (
          <ConsolidatedDevPanel
            persona={persona}
            onPersonaChange={handlePersonaChange}
            showJson={showJson}
            onShowJsonChange={setShowJson}
            onHide={() => setDevOpen(false)}
          />
        )}

        <div className="flex-1 flex flex-col min-w-0">
          <TopBar
            persona={persona}
            onPersonaChange={handlePersonaChange}
            session={session}
            onGlobalSearchContactClick={handleGlobalSearchContactClick}
          />
          <div className="flex-1 flex min-h-0">
            <Nav
              persona={persona}
              activeKey={activeKey}
              onSelect={setActiveKey}
              items={persona === 'manager' ? getNavForManager(getManagerPresetId()) : undefined}
            />
            <PersonaShell
              persona={persona}
              activeKey={activeKey}
              setActiveKey={setActiveKey}
              session={session}
              inboxDeepLinkOppId={inboxDeepLinkOppId}
              onConsumeInboxDeepLink={() => setInboxDeepLinkOppId(null)}
              onJumpToInbox={handleJumpToInbox}
              onHomeFilter={handleHomeFilter}
              onOpenOppInCoPilot={handleOpenOppInCoPilot}
              inboxFilter={inboxFilter}
              onClearInboxFilter={() => setInboxFilter(null)}
              testMode={TEST_MODE}
              contactsDeepLinkContactId={contactsDeepLinkContactId}
              onConsumeContactsDeepLink={() => setContactsDeepLinkContactId(null)}
            />
          </div>
          {showJson && (
            <JsonPeek
              data={{ persona, activeKey, devOpen }}
            />
          )}
          {!devOpen && (
            <button
              onClick={() => setDevOpen(true)}
              className="fixed bottom-4 left-4 text-xs px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-100 rounded shadow-lg"
            >
              Show dev controls
            </button>
          )}
        </div>
      </div>
    </ActiveWorkflowContext.Provider>
    </ActiveOrgProvider>
  );
}

// ConsolidatedDevPanel — renamed inline so the layout decisions for the
// new sectioning live in one place. Reads `active` from context to drive
// the DEV · Payload section visibility + per-workflow forceOpen.
function ConsolidatedDevPanel({
  persona,
  onPersonaChange,
  showJson,
  onShowJsonChange,
  onHide,
}) {
  const {
    active,
    protectionDev,
    setProtectionDev,
    refiDev,
    setRefiDev,
    insuranceDev,
    setInsuranceDev,
    protectionForm,
    setProtectionForm,
    refiForm,
    setRefiForm,
    refiStepIdx,
    setRefiStepIdx,
    resetRefiForm,
    insuranceWorkflow,
    setInsuranceWorkflow,
  } = useActiveWorkflow();
  const liveLabel =
    active?.kind === 'insurance' ? 'live workflow' : 'live form';
  const vehicleHint =
    active && !active.vehicle && active.opportunity?.vehicle && !active.opportunity?.vehicle_id
      ? 'Legacy fixture opp — no vehicle_id; label-match fallback found nothing.'
      : null;

  // DEV · Payload "live form/workflow" block — Option (b): each kind
  // reads its lifted state directly. Protection now also reads from
  // protectionForm (Wave 14 follow-up) — previously it fell back to
  // active.embedState (populated by AgentView's onFormChange callback).
  // With protection's form lifted, that callback path is redundant and
  // the live mirror has a single source of truth per kind.
  const liveValue =
    active?.kind === 'protection'
      ? protectionForm
      : active?.kind === 'refi'
        ? refiForm
        : active?.kind === 'insurance'
          ? insuranceWorkflow
          : null;

  // Wave 14 follow-up — refi formState + wizardNav now wired to lifted
  // state. RefiDevControls' applyPrefill (Section 1 + presets) merges
  // patch into refiForm; resetAll calls the resetRefiForm callback the
  // RefiAgentEmbedInner registered (which closes over INITIAL_FORM +
  // the current orgId/contact/vehicle). wizardNav.sequence is computed
  // from refiForm + form.hasCoApplicant, matching refi-portal's
  // standalone App.jsx (lines ~173-193). Null-safe defaults render the
  // disabled branches in RefiDevControls when no refi opp is open.
  const refiFormState = useMemo(() => {
    if (active?.kind !== 'refi' || !refiForm) {
      return {
        form: {},
        update: noop,
        applyPrefill: noop,
        resetAll: noop,
      };
    }
    return {
      form: refiForm,
      update: (patch) =>
        setRefiForm((prev) => ({
          ...(prev || {}),
          ...(typeof patch === 'function' ? patch(prev || {}) : patch),
        })),
      applyPrefill: (prefill) => {
        // RefiDevControls passes BOTH wrapped payloads
        // ({applicant, coApplicant, vehicle} from preset buttons inside
        // Section 1) AND flat patches (textarea JSON when keyed
        // already-flat). buildPrefillPatch handles both: returns the
        // input as-is if already flat, or unwraps + key-translates if
        // wrapped. Without this, the wrapped presets would land as
        // junk top-level keys (form.applicant) and the wizard's
        // form.firstName lookups wouldn't see them.
        const patch = buildPrefillPatch(prefill);
        if (!patch) return;
        setRefiForm((prev) => ({ ...(prev || {}), ...patch }));
      },
      resetAll: () => {
        if (typeof resetRefiForm === 'function') resetRefiForm();
      },
    };
  }, [active?.kind, refiForm, setRefiForm, resetRefiForm]);

  const refiWizardNav = useMemo(() => {
    if (active?.kind !== 'refi' || !refiForm) {
      return { screen: 'vehicle_add', goToScreen: noop, sequence: [] };
    }
    const sequence = getSequence(refiForm, refiForm.hasCoApplicant === true);
    const screen = sequence[Math.min(refiStepIdx, sequence.length - 1)] || 'vehicle_add';
    return {
      screen,
      goToScreen: (key) => {
        if (key === 'embedded_entry') {
          setRefiStepIdx(0);
          return;
        }
        const idx = sequence.indexOf(key);
        if (idx >= 0) setRefiStepIdx(idx);
      },
      sequence,
    };
  }, [active?.kind, refiForm, refiStepIdx, setRefiStepIdx]);

  // Insurance workflow + updateWorkflow now wired to lifted state.
  // InsuranceDevControls' AgentSimulators reads workflow.status /
  // workflow.consumer_link.url / workflow.lead.leadId at click-time, so
  // the simulator buttons enable/disable correctly as the agent
  // progresses through the lead flow.
  const insuranceUpdateWorkflow = useMemo(() => {
    if (active?.kind !== 'insurance') return noop;
    return (patch) =>
      setInsuranceWorkflow((prev) => ({
        ...(prev || {}),
        ...(typeof patch === 'function' ? patch(prev || {}) : patch),
      }));
  }, [active?.kind, setInsuranceWorkflow]);
  const insuranceWorkflowSafe =
    active?.kind === 'insurance' && insuranceWorkflow ? insuranceWorkflow : {};

  return (
    <DevPanel
      title="Dev controls"
      subtitle="Switch persona, force opportunity status, and prefill contact data without re-logging in."
    >
      <Section label="Persona" collapsible defaultOpen={true}>
        <div className="flex flex-col gap-1">
          {PERSONAS.map((p) => (
            <button
              key={p.value}
              onClick={() => onPersonaChange(p.value)}
              className={
                'text-left text-xs px-2 py-1.5 rounded ' +
                (persona === p.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200')
              }
            >
              {p.label}
            </button>
          ))}
        </div>
      </Section>

      <Section label="Force opportunity status" collapsible defaultOpen={false}>
        <Segmented
          value="auto"
          onChange={() => {}}
          options={[
            { v: 'auto', l: 'Auto' },
            { v: 'open', l: 'Open' },
            { v: 'won', l: 'Won' },
            { v: 'lost', l: 'Lost' },
          ]}
        />
        <div className="text-xs text-slate-500 mt-1">Wired in Phase 1A inbox pass</div>
      </Section>

      <Section label="Prefill contact data" collapsible defaultOpen={false}>
        <button className="w-full text-xs px-2 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-slate-200">
          Apply demo contact
        </button>
        <div className="text-xs text-slate-500 mt-1">Wired with fixtures in Phase 1A</div>
      </Section>

      <Section label="Inspector" collapsible defaultOpen={false}>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={showJson}
            onChange={(e) => onShowJsonChange(e.target.checked)}
          />
          Show JSON peek
        </label>
      </Section>

      {/* DEV · Payload — only renders when a CoPilot is open. Auto-expands
          on mount because the user just navigated here, the kind-matched
          per-workflow section also auto-opens just below. */}
      {active && (
        <Section label="DEV · Payload" collapsible defaultOpen={true}>
          <JsonBlock
            label="opportunity"
            value={active.opportunity}
            defaultOpen={true}
          />
          <JsonBlock label="contact" value={active.contact} defaultOpen={false} />
          <JsonBlock
            label="vehicle"
            value={active.vehicle}
            defaultOpen={false}
            hint={vehicleHint}
          />
          <JsonBlock label={liveLabel} value={liveValue} defaultOpen={true} />
        </Section>
      )}

      <Section
        label="Protection"
        collapsible
        defaultOpen={false}
        forceOpen={active?.kind === 'protection'}
      >
        {active?.kind === 'protection' ? (
          <Suspense fallback={<DevControlsLoading />}>
            <ProtectionDevControls
              devOptions={protectionDev}
              setDevOptions={setProtectionDev}
              // Wave 14 follow-up — thread the lifted protection form +
              // updater so ProtectionDevControls' Force-complete (skip
              // embed) and Form state (JsonPeek) sections render with
              // live values. CoPilotPane's ProtectionEmbed seeds
              // protectionForm via buildProtectionInitialForm before
              // AgentView mounts, so by the time the user is interacting
              // with this panel, `form` is a fully-shaped object.
              // Defensive `|| {}` so JsonPeeks render null fields rather
              // than crashing if the seed effect hasn't committed yet.
              form={protectionForm || {}}
              updateForm={(patch) =>
                setProtectionForm((prev) => ({
                  ...(prev || {}),
                  ...(typeof patch === 'function' ? patch(prev || {}) : patch),
                }))
              }
              persona={persona}
            />
          </Suspense>
        ) : (
          <InactiveHint workflow="protection" />
        )}
      </Section>

      <Section
        label="Refi"
        collapsible
        defaultOpen={false}
        forceOpen={active?.kind === 'refi'}
      >
        {active?.kind === 'refi' ? (
          <Suspense fallback={<DevControlsLoading />}>
            <RefiDevControls
              devOptions={refiDev}
              setDevOptions={setRefiDev}
              formState={refiFormState}
              wizardNav={refiWizardNav}
            />
          </Suspense>
        ) : (
          <InactiveHint workflow="refi" />
        )}
      </Section>

      <Section
        label="Insurance"
        collapsible
        defaultOpen={false}
        forceOpen={active?.kind === 'insurance'}
      >
        {active?.kind === 'insurance' ? (
          <Suspense fallback={<DevControlsLoading />}>
            <InsuranceDevControls
              dev={insuranceDev}
              updateDev={setInsuranceDev}
              workflow={insuranceWorkflowSafe}
              updateWorkflow={insuranceUpdateWorkflow}
            />
          </Suspense>
        ) : (
          <InactiveHint workflow="insurance" />
        )}
      </Section>

      <Section label="Payments" collapsible defaultOpen={false}>
        <div className="text-xs text-slate-400 leading-relaxed">
          Payments workflow not built yet — DEV CONTROLS land when the workflow ships.
        </div>
      </Section>

      <Section label="Dev panel">
        <button
          onClick={onHide}
          className="w-full text-xs px-2 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-slate-200"
        >
          Hide
        </button>
      </Section>
    </DevPanel>
  );
}

// Inactive hint — rendered inside per-workflow sections when CoPilot is
// closed (or open on a different kind). Keeps the section body short
// and consistent so the panel layout stays stable as the user opens /
// closes opportunities.
function InactiveHint({ workflow }) {
  return (
    <div className="text-xs text-slate-500 italic leading-relaxed">
      Open a {workflow} opportunity in CoPilot to enable controls.
    </div>
  );
}

// Suspense fallback for the lazy DevControls chunks. Single-line sliver
// so the section height stays roughly comparable to the loaded body and
// the user gets a clear "loading" affordance without a layout pop.
function DevControlsLoading() {
  return (
    <div className="text-xs text-slate-500 italic">Loading dev controls…</div>
  );
}

function PersonaShell({
  persona,
  activeKey,
  setActiveKey,
  session,
  inboxDeepLinkOppId,
  onConsumeInboxDeepLink,
  onJumpToInbox,
  onHomeFilter,
  onOpenOppInCoPilot,
  inboxFilter,
  onClearInboxFilter,
  testMode,
  contactsDeepLinkContactId,
  onConsumeContactsDeepLink,
}) {
  // AgentInbox needs `persona` so its CoPilotPane can pass it through to
  // protection-portal AgentView for the View API Responses gate. The other
  // shells don't compose third-party views yet.
  //
  // Agent persona has multiple pages: Home (default landing), Inbox, and
  // Contacts. Calendar falls through to AgentInbox today (stub). AgentHome
  // creates new opportunities, then jumps the user to Inbox with a deep-link
  // opp id so CoPilotPane opens. testMode is derived from org-registry at the
  // App level and threaded here to gate the _test_case tooltip.
  if (persona === 'agent') {
    if (activeKey === 'home') {
      return (
        <AgentHome
          activeKey={activeKey}
          session={session}
          onJumpToInbox={onJumpToInbox}
          onHomeFilter={onHomeFilter}
        />
      );
    }
    if (activeKey === 'compete') {
      return <AgentCompete session={session} />;
    }
    if (activeKey === 'contacts') {
      return (
        <AgentContacts
          activeKey={activeKey}
          persona={persona}
          session={session}
          testMode={testMode}
          onOpenOppInCoPilot={onOpenOppInCoPilot}
          deepLinkContactId={contactsDeepLinkContactId}
          onConsumeDeepLink={onConsumeContactsDeepLink}
        />
      );
    }
    if (activeKey === 'reports') {
      return <AgentReports session={session} />;
    }
    return (
      <AgentInbox
        activeKey={activeKey}
        persona={persona}
        session={session}
        deepLinkOppId={inboxDeepLinkOppId}
        onConsumeDeepLink={onConsumeInboxDeepLink}
        inboxFilter={inboxFilter}
        onClearInboxFilter={onClearInboxFilter}
        testMode={testMode}
      />
    );
  }
  if (persona === 'manager') {
    if (activeKey === 'team') return (
      <ManagerTeam
        persona={persona}
        onNavigate={setActiveKey}
        onOpenOppInCoPilot={onOpenOppInCoPilot}
      />
    );
    if (activeKey === 'inbox') return <ManagerInbox persona={persona} session={session} testMode={testMode} />;
    if (activeKey === 'assignment') return <ManagerAssignment />;
    if (activeKey === 'metrics') return <ManagerMetrics />;
    if (activeKey === 'tags') return <ManagerTags />;
    return (
      <ManagerHome
        session={session}
        onJumpToInbox={onJumpToInbox}
        onHomeFilter={onHomeFilter}
        onNavigate={setActiveKey}
      />
    );
  }
  if (persona === 'admin') return <AdminHome activeKey={activeKey} persona={persona} onNavigate={setActiveKey} />;
  if (persona === 'super_admin') return <SuperHome activeKey={activeKey} onNavigate={setActiveKey} />;
  return null;
}
