// Top-level shell. Mirrors protection-portal's substrate — Vite + React 19
// + JS, monolithic App.jsx with a DEV CONTROLS sidebar pattern. Workflow
// content lives under src/views/customer/ and src/views/agent/.
//
// State ownership (Phase 1.5e — lifted up from RefiWizard so DEV
// CONTROLS can mutate the wizard live):
//
//   form        — the shared refi form state (INITIAL_FORM shape from
//                 RefiWizard). Both customer and agent views read +
//                 write the same form so DEV CONTROLS prefill applies
//                 uniformly. AgentView additionally owns its own
//                 `opportunity` state (capture link, status,
//                 sentSummary) because that's agent-only metadata that
//                 doesn't belong in the consumer's form.
//   stepIdx     — current wizard step index. Lifted up so DEV CONTROLS
//                 "Jump to screen" (Section 11) can drive it directly.
//   devOptions  — DEV CONTROLS's full state slice. Per DevControls.jsx
//                 keys: persona, personaLocked, forcePartner, forceResult,
//                 disqualReason, includeSsn, coAppOverride, showJson,
//                 prefillJson, orgConfig, orgConfigJson, orgConfigError,
//                 embeddedState. We seed orgConfig from
//                 src/constants/org-config.js so the JSON peek + Apply
//                 button start from the canonical default.
//
// Wired DEV CONTROLS sections (after Chunk E):
//   §1  Prefill payload (JSON) → applyPrefill() mutates form
//   §3  Force partner routing  → drives runDecision via useRefiPrequal
//   §4  Force Stage 2 result   → drives runDecision via useRefiPrequal
//   §5  Disqualification reason → drives runDecision (when forceResult=disqualified)
//   §6  SSN provided           → drives runDecision (Gravity vs Savings Group routing)
//   §7  Co-applicant override  → drives runDecision (auto reads form.hasCoApplicant)
//   §8/9/10 Plan / Insurance toggles → mutate form directly
//   §11 Jump to screen         → drives setStepIdx
//   §14 Reset prototype        → clears form + dev to defaults
//
// Sections that drive runDecision are read by useRefiPrequal inside the
// wizard's terminal screen (RefiWizard wires them through to its own
// runDecision call). The customer wizard's mockDecision() placeholder
// is replaced with a real runDecision call in this same chunk.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FC } from 'react';
import { TopBar } from './shell/TopBar';
import { DevControls } from './shell/DevControls';
import { ViewSwitcher, readViewFromUrl } from './shell/ViewSwitcher';
import { useForm } from './hooks/useForm';
import { INITIAL_FORM } from './views/customer/RefiWizard';
import { DEFAULT_ORG_CONFIG } from './constants/org-config';
import { PREFILL_PRESETS } from './constants/prefill-presets';
import type { PrefillPayload } from './constants/prefill-presets';
import { RELATIONSHIP_OPTIONS } from './refinance-v2-prototype';
import { getSequence } from './lib/refi';
import { resolveWriteContext, syncForStep, hydrateFromDb, notesList, notesCreate, notesEnabled } from './lib/blinkerWrite';
import { loadDraft, saveDraft, loadStep, saveStep } from './lib/draftStore';
import type { RefiForm, ViewType, ScreenKey, WizardDevOptions, StepChangeContext } from './types';

const INITIAL_DEV_OPTIONS: WizardDevOptions = {
  // Substrate (persona + lock).
  persona: 'consumer',
  personaLocked: false,
  // Refi force-outcomes (read by useRefiPrequal in the wizard).
  forcePartner: 'auto',
  forceResult: 'auto',
  disqualReason: 'credit_out_of_range',
  includeSsn: true,
  coAppOverride: 'auto',
  // DEV CONTROLS chrome.
  showJson: true,
  prefillJson: JSON.stringify(PREFILL_PRESETS[0].payload, null, 2),
  orgConfig: DEFAULT_ORG_CONFIG,
  orgConfigJson: JSON.stringify(DEFAULT_ORG_CONFIG, null, 2),
  embeddedState: 'pre',
};

// applyPrefill — port of refinance-v2-prototype.tsx applyPrefill (~L902).
// Accepts a wrapped payload `{ vehicle, applicant, coApplicant }` (the
// shape every PREFILL_PRESETS entry uses), returns the patch object so
// the caller can pass it straight to update().
function buildPrefillPatch(payload: PrefillPayload): Partial<RefiForm> | null {
  if (!payload) return null;
  const vehicle     = payload.vehicle    ?? {};
  const applicant   = payload.applicant  ?? {};
  const coApplicant = payload.coApplicant ?? {};

  const patch: Partial<RefiForm> = {};
  if (vehicle.vin       !== undefined) patch.vin       = vehicle.vin.toUpperCase();
  if (vehicle.year      !== undefined) patch.year      = vehicle.year || null;
  if (vehicle.make      !== undefined) patch.make      = vehicle.make;
  if (vehicle.model     !== undefined) patch.model     = vehicle.model;
  if (vehicle.trim      !== undefined) patch.trim      = vehicle.trim;
  if (vehicle.mileage   !== undefined) patch.mileage   = vehicle.mileage;
  if (vehicle.condition !== undefined) patch.condition = vehicle.condition;

  if (applicant.firstName !== undefined) patch.firstName = applicant.firstName;
  if (applicant.lastName  !== undefined) patch.lastName  = applicant.lastName;
  if (applicant.phone     !== undefined)
    patch.phone = applicant.phone.replace(/\D/g, '').slice(0, 10);
  if (applicant.email !== undefined) patch.email = applicant.email;

  if (coApplicant.firstName !== undefined) patch.coAppFirst = coApplicant.firstName;
  if (coApplicant.lastName  !== undefined) patch.coAppLast  = coApplicant.lastName;
  if (coApplicant.phone     !== undefined)
    patch.coAppPhone = coApplicant.phone.replace(/\D/g, '').slice(0, 10);
  if (coApplicant.email !== undefined) patch.coAppEmail = coApplicant.email;
  if (coApplicant.relationship !== undefined) {
    const rel = coApplicant.relationship;
    if ((RELATIONSHIP_OPTIONS as string[]).includes(rel)) {
      patch.coAppRelationship = rel;
      patch.coAppRelationshipOther = '';
    } else if (rel) {
      patch.coAppRelationship = 'Other';
      patch.coAppRelationshipOther = rel;
    }
  }
  return patch;
}

// MissionControl prefill — when an agent clicks "Apply for Financing" in
// MissionControl (ApplyForFinancingBtn.tsx), the user is redirected to
//   /?view=agent&vin=…&mileage=…&year=…&make=…&model=…&trim=…
//   &first_name=…&last_name=…&phone=…&email=…
//   &zip_code=…&city=…&state=…&organization_id=…&customer_token=…
// We read those query params once on mount and seed the shared RefiForm so
// the agent flow starts pre-filled. Param names match MissionControl's
// URLSearchParams keys exactly — keep both sides in sync.
interface McContact {
  id?: string;
  emails?: Array<{ address: string; is_primary: boolean }>;
  phones?: Array<{ number: string; is_primary: boolean }>;
  // Index signature so the contact satisfies AgentView's
  // Record<string, unknown> contact prop (canonical Contact shape).
  [key: string]: unknown;
}

function readMcPrefillFromUrl(): { patch: Partial<RefiForm>; contact: McContact | null } {
  if (typeof window === 'undefined') return { patch: {}, contact: null };
  const q = new URLSearchParams(window.location.search);
  const get = (k: string): string => (q.get(k) ?? '').trim();
  const tenDigits = (v: string): string => v.replace(/\D/g, '').slice(0, 10);

  const patch: Partial<RefiForm> = {};

  // Vehicle
  const vin = get('vin');
  if (vin) patch.vin = vin.toUpperCase();
  const mileage = get('mileage').replace(/\D/g, '');
  if (mileage) patch.mileage = Number(mileage);
  // YMMT snapshot from MissionControl. The VIN decode on VehicleAdd still wins
  // where VinAudit / blinker actually return a value — these are the baseline
  // (shown immediately, before any decode) and the fallback for fields a decode
  // leaves blank, so year/make/model/trim stay on screen throughout.
  const year = get('year').replace(/\D/g, '');
  if (year) patch.year = Number(year);
  const make = get('make');
  if (make) patch.make = make;
  const model = get('model');
  if (model) patch.model = model;
  const trim = get('trim');
  if (trim) patch.trim = trim;
  // Condition feeds VehicleDrive's "I purchased this vehicle" toggle, which
  // only accepts "New" / "Used". MissionControl has no new/used field — the
  // blinker schema's VehicleConditionEnum is a wear grade (XCLEAN / CLEAN /
  // AVERAGE / ROUGH). Per product decision, map the top grade (xclean) to
  // New and every other grade to Used. ("new"/"excellent" also accepted in
  // case the upstream field ever changes to a true purchase/grade type.)
  const condition = get('condition').toLowerCase();
  if (condition) {
    const isNew = condition === 'xclean' || condition === 'new' || condition === 'excellent';
    patch.condition = isNew ? 'New' : 'Used';
  }

  // Customer / user details
  const firstName = get('first_name');
  if (firstName) patch.firstName = firstName;
  const lastName = get('last_name');
  if (lastName) patch.lastName = lastName;
  const phone = tenDigits(get('phone'));
  if (phone) patch.phone = phone;
  const email = get('email');
  if (email) patch.email = email;

  // Address details. MissionControl sends zip_code/city/state plus the two
  // street lines (address_line_1 / address_line_2). Refi's form stores line 1
  // as `address` and line 2 as `apt_suite` (AddressBlock's second-line slot).
  const zip = get('zip_code');
  if (zip) patch.zip = zip;
  const city = get('city');
  if (city) patch.city = city;
  const state = get('state');
  if (state) patch.state = state;
  const line1 = get('address_line_1');
  if (line1) patch.address = line1;
  const line2 = get('address_line_2');
  if (line2) patch.apt_suite = line2;

  // CoPilot org scope
  const orgId = get('organization_id');
  if (orgId) patch.org_id = orgId;

  // Build a canonical-ish contact for the agent capture-link gate so it
  // seeds the real consumer's email/phone instead of the Jordan mock.
  let contact: McContact | null = null;
  if (email || phone) {
    contact = {
      id: get('customer_token') || get('package_id') || 'mc_prefill',
      emails: email ? [{ address: email, is_primary: true }] : [],
      phones: phone ? [{ number: '+1' + phone, is_primary: true }] : [],
    };
  }

  return { patch, contact };
}

const App: FC = () => {
  const [panelOpen, setPanelOpen] = useState(true);
  const [view, setView] = useState(() => readViewFromUrl('agent'));

  // MissionControl redirect prefill — parsed once from the URL on mount.
  const [mcPrefill] = useState(() => readMcPrefillFromUrl());
  // Write-back context (ids + access token) for pushing the agent's edits
  // back to blinker as they advance. Disabled for standalone refi.
  // MissionControl hand-off context (URL token + ids) OR the direct-login
  // session context (which picks up any bootstrapped ids from localStorage on
  // mount, so per-section writes + DB hydrate work after the first submit).
  const [writeCtx] = useState(() => resolveWriteContext());

  // Shared refi form + step. Lifted from RefiWizard (was local) so
  // DEV CONTROLS prefill / jump-to-screen can drive them directly. Both
  // customer and agent views read the same form per the embed contract;
  // agent layers its own opportunity slice on top.
  const [form, updateForm, resetForm] = useForm(INITIAL_FORM);
  // Restore the wizard step from localStorage so a reload lands on the same
  // page (not step 0). Saved on every change below.
  const [stepIdx, setStepIdx] = useState(() => loadStep());

  useEffect(() => {
    saveStep(stepIdx);
  }, [stepIdx]);

  // Gate the save-on-change effect until the mount-time restore (URL prefill +
  // localStorage draft) has run. Without this, the first render's empty
  // INITIAL_FORM would overwrite the saved draft before it's loaded back.
  const [restored, setRestored] = useState(false);

  // Browser Back button → previous wizard screen instead of unloading the
  // refi-portal back to MissionControl. The wizard step is React state, not a
  // URL, so without this a browser Back leaves the app entirely. We "trap"
  // Back by keeping a sentinel history entry: each Back fires popstate here,
  // consumes one wizard step, and re-arms the trap. At the first step we
  // release the trap so Back returns to MissionControl as before. Agent view
  // only — that's the flow launched from MissionControl.
  useEffect(() => {
    if (view !== 'agent') return;
    if (typeof window === 'undefined') return;

    // Arm: seed a sentinel entry so the first Back triggers popstate rather
    // than navigating away.
    window.history.pushState({ refiBackTrap: true }, '');

    const onPopState = (): void => {
      setStepIdx((idx) => {
        if (idx > 0) {
          // Consume one step and re-arm the trap for the next Back.
          window.history.pushState({ refiBackTrap: true }, '');
          return idx - 1;
        }
        // First step: release the trap and let Back leave to MissionControl.
        window.removeEventListener('popstate', onPopState);
        window.history.back();
        return idx;
      });
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
    // Re-arm when the view changes; current step is read via functional update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const [devOptions, setDevOptions] = useState<WizardDevOptions>(INITIAL_DEV_OPTIONS);

  // Apply MissionControl query-param prefill once on mount. Seeds the
  // shared RefiForm (VIN / user / address) so the agent flow lands
  // pre-filled. Runs regardless of view since the form is shared; the
  // capture-link gate prefill (mcPrefill.contact) is agent-only and
  // threaded through ViewSwitcher below.
  useEffect(() => {
    // 1. URL snapshot from MissionControl (baseline).
    if (Object.keys(mcPrefill.patch).length > 0) {
      updateForm(mcPrefill.patch);
    }
    // 2. localStorage draft — restores the agent's prior edits, including
    //    fields with no backend endpoint (current loan: lender/payment/payoff).
    //    Overrides the URL baseline.
    //
    //    Except where the draft is blank: saveDraft persists EVERY non-stripped
    //    field, so a draft written before MissionControl started sending YMMT
    //    (or written on an earlier visit to the same package_id) carries
    //    year: null / make: "" / model: "" / trim: "" and would wipe the
    //    hand-off values right back off the screen. Empty draft entries are
    //    dropped for the keys the URL actually supplied — a deliberate clear of
    //    one of those (YMMT / contact / address) therefore doesn't survive a
    //    reload, which is the accepted trade: those fields are VIN-decode-owned
    //    and re-arrive with every hand-off. Keys the URL did NOT supply keep
    //    full draft precedence, empty or not.
    const draft = loadDraft();
    if (Object.keys(draft).length > 0) {
      const prefilled = mcPrefill.patch as Record<string, unknown>;
      const merged: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(draft)) {
        const isBlank = v === null || v === undefined || v === '';
        if (isBlank && k in prefilled) continue;
        merged[k] = v;
      }
      if (Object.keys(merged).length > 0) {
        updateForm(merged as Partial<RefiForm>);
      }
    }
    // 3. DB hydrate (async) — authoritative saved values for vehicle / user /
    //    address override both above; doesn't touch current-loan, so the
    //    draft's loan fields survive.
    hydrateFromDb(writeCtx).then((patch) => {
      if (patch && Object.keys(patch).length > 0) updateForm(patch);
    });
    // Synchronous restore (URL + draft) is done — arm the save-on-change
    // effect. The async DB hydrate that may still be in flight applies through
    // updateForm and is captured by the same effect.
    setRestored(true);
    // Mount-only: mcPrefill + writeCtx + updateForm are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the draft on every form change once restore has run. Co-applicant
  // DOB (and any field entered on the final s1_identity_consent screen) is
  // captured here so a reload restores it via loadDraft — previously the draft
  // was only saved on a forward step change, so last-screen edits were lost on
  // reload. Sensitive fields (ssn / coAppSsn) are stripped inside saveDraft.
  useEffect(() => {
    if (!restored) return;
    saveDraft(form);
  }, [form, restored]);

  // Keep ?view= in sync when DEV CONTROLS flips the view, so reloading
  // and sharing URLs both work.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('view') !== view) {
      url.searchParams.set('view', view);
      window.history.replaceState({}, '', url.toString());
    }
  }, [view]);

  // applyPrefill — DEV CONTROLS Section 1 (Prefill payload + presets).
  // Wired through to formState.applyPrefill in the panel.
  const applyPrefill = useCallback(
    (payload: PrefillPayload): void => {
      const patch = buildPrefillPatch(payload);
      if (patch) updateForm(patch);
    },
    [updateForm]
  );

  // beforeStepChange — write-back hook. When the agent advances ('next')
  // past the Vehicle / Personal / Address screens, push that section's edits
  // back to blinker so MissionControl reflects them. No-op for standalone
  // refi (writeCtx.enabled === false) and on 'back'. `form` is the current
  // shared slice (latest edits) since this callback recreates on form change.
  const beforeStepChange = useCallback(
    (ctx: StepChangeContext): void => {
      if (ctx.direction !== 'next') return;
      // Persist the draft on every Next so revisits/reloads pre-fill — this
      // is how the current-loan form (no backend endpoint) survives, matching
      // MissionControl's localStorage refiApplication draft.
      saveDraft(form);
      syncForStep(writeCtx, ctx.from, form);
    },
    [writeCtx, form]
  );

  // resetAll — DEV CONTROLS Section 14 (Reset prototype). Clears form
  // back to INITIAL_FORM, resets stepIdx, restores DEV CONTROLS to its
  // initial slice (preserving the current view + persona since the
  // user usually wants to keep their orientation).
  const resetAll = useCallback(() => {
    resetForm();
    setStepIdx(0);
    setDevOptions((prev) => ({
      ...(INITIAL_DEV_OPTIONS),
      // Preserve persona / personaLocked so a super_admin doesn't get
      // dropped back to consumer mid-debug.
      persona: prev.persona,
      personaLocked: prev.personaLocked,
    }));
  }, [resetForm]);

  // wizardNav — DEV CONTROLS Section 11 (Jump to screen). The panel
  // expects `screen` (a step name) and `goToScreen(stepKey)`. We map
  // step names to indices via getSequence() so the panel and the
  // wizard agree on the active step.
  const sequence = useMemo(
    () => getSequence(form, form.hasCoApplicant === true),
    [form]
  );
  const screen = sequence[Math.min(stepIdx, sequence.length - 1)] || sequence[0];

  const goToScreen = useCallback(
    (stepKey: ScreenKey): void => {
      // 'embedded_entry' is a pseudo-step the prototype's screen list
      // included for the standalone shell entry card. We don't have a
      // distinct embedded_entry surface in refi-portal yet, so jump to
      // step 0 (vehicle_add) as the closest neighbor.
      if (stepKey === 'embedded_entry') {
        setStepIdx(0);
        return;
      }
      const idx = sequence.indexOf(stepKey);
      if (idx >= 0) setStepIdx(idx);
    },
    [sequence]
  );

  const formState = useMemo(
    () => ({ form, update: updateForm, applyPrefill, resetAll }),
    [form, updateForm, applyPrefill, resetAll]
  );
  const wizardNav = useMemo(
    () => ({ screen, goToScreen, sequence }),
    [screen, goToScreen, sequence]
  );

  // Agent notes — posted to the REAL blinker backend (/api/v3/admin/notes via
  // blinkerWrite), attached to the handed-off ProductPackage and authored by
  // the agent (backend stamps current_user from the access_token). This is how
  // a note added in refi-portal shows up in MissionControl's package view.
  // Enabled only when the MC hand-off carried a package_id + token; standalone
  // refi has no target, so NotesCard renders a disabled hint.
  const notesAvailable = useMemo(() => notesEnabled(writeCtx), [writeCtx]);
  const onLoadNotes = useCallback(() => notesList(writeCtx), [writeCtx]);
  const onCreateNote = useCallback(
    (body: string) => notesCreate(writeCtx, body),
    [writeCtx]
  );

  // DEV CONTROLS are hidden by default. Set VITE_SHOW_DEV_CONTROLS=true to
  // re-enable the debug sidebar + its TopBar toggle.
  const showDevControls = import.meta.env.VITE_SHOW_DEV_CONTROLS === 'true';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <TopBar
        panelOpen={panelOpen}
        togglePanel={() => setPanelOpen((o) => !o)}
        view={view}
        showToggle={showDevControls}
        // Logo click → jump to the first wizard step (vehicle VIN form).
        onHome={() => setStepIdx(0)}
      />
      <div className="flex">
        {showDevControls && (
          <DevControls
            open={panelOpen}
            view={view}
            setView={setView}
            devOptions={devOptions}
            setDevOptions={setDevOptions}
            formState={formState}
            wizardNav={wizardNav}
          />
        )}
        <main className="flex-1 p-8">
          <div className="max-w-3xl mx-auto">
            <ViewSwitcher
              view={view}
              devOptions={devOptions}
              form={form}
              updateForm={updateForm}
              stepIdx={stepIdx}
              setStepIdx={setStepIdx}
              agentContact={mcPrefill.contact}
              beforeStepChange={beforeStepChange}
              notesEnabled={notesAvailable}
              onLoadNotes={onLoadNotes}
              onCreateNote={onCreateNote}
            />
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;
