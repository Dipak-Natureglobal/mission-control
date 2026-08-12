# Phase 1 → Phase 2 Readiness Plan

**Audit date:** 2026-05-10. Source: 3 parallel research agents reviewing all 6 repos (5 child apps + blinker-platform meta-repo) + 16 memory files + 14 ADRs + 12 canon files + STATUS.md + child-app CLAUDE.mds + payment-processing-platform reference.

**The ultimate question** — *are we ready to start building to live dev/prod in Google Cloud?*

**Short answer:** Yes, *with* a focused 2-wave cleanup pass and a decision session on 5–6 architectural choices. Phase 1 has reached its scope (functional prototype demonstrating every consumer + agent flow with real-call paths gated behind DevPanel toggles). The blockers between here and Phase 2 are 80% mechanical hygiene + 20% greenfield infrastructure decisions that have not yet been documented anywhere.

---

## Section 1 — Where we are (Phase 1 state)

| Repo | Functional state | Local commits ahead | Canon version |
|---|---|---|---|
| **protection-portal** | 12-step consumer wizard end-to-end functional. SE GetRates real-call (DevPanel), FluidPay tokenize (live sandbox), EFS charge (4 emulation modes + proxy). VinValidate + RatesChanged shipped W25. Cross-sell embeds (insurance + refi) wired. | **6 ahead, unpushed** | v305 (2 waves behind master) |
| **mission-control** | 4-persona shell (agent/manager/admin/super_admin). CoPilot embeds protection + refi + insurance AgentViews. Notes/activities/household/tags shipped. AgentReports Looker iframe. AddContactModal + super-admin OrgRegistry editor. | **3 ahead, unpushed** | v305 |
| **insurance-portal** | Lead origination + LeadStatusTimeline + cross-sell embed mode. EI integration is **100% mock** (no sandbox creds wired). | 0 ahead but **canon drift uncommitted** | v305 (W22-fu5 sync staged not committed) |
| **refi-portal** | Consumer wizard (monolithic ~2600 lines), agent view, CoPilot embed wired. MarketCheck deterministic mock (CORS blocks real call). Twilio/Mandrill = console.log. | 0 ahead but **canon drift uncommitted** | v305 (same drift) |
| **customer-portal** | **Not started.** Directory exists with canon JSON copies + CLAUDE.md only. No `package.json`, no `src/`. | Canon drift uncommitted | v305 (same drift) |
| **blinker-platform** | 7 packages (api, components, integrations, personas-stub, telemetry, utils + README). EFS payment package shipped W24. classifyRatesChange shipped W25. | **13 ahead, unpushed** | **v307** (master) |

**Headline**: Wave 25 v3.0.7 closes the 5-task v3.0.6 PDF brief. 25 waves of work since 2026-05-04 (post-1.5 iteration arc). Real OMGA UAT smoke confirmed working W21. All 5 portal flows demo-ready in fixture mode; protection-portal demo-ready in real-call mode.

---

## Section 2 — Critical cross-cutting findings (must-resolve)

These are not optional. Each is independently surfaced by the audit; none have been formally documented anywhere as Phase 2 blockers until now.

### 2.1 `npm run build` is broken in every portal

`lucide-react` peerDependency was fixed in `blinker-platform/package.json` but no child app has re-run `npm install` since. Every portal currently fails to produce a production artifact. **Until this is fixed, Phase 2 deployment cannot be tested.**

**Fix**: 1-line per repo (`npm install` after pulling latest blinker-platform). Should be the first item in Wave 26 cleanup.

### 2.2 The `file:` dep model is incompatible with CI/CD

Child apps consume `blinker-platform`, `insurance-portal`, `refi-portal`, etc. via `"file:../<repo>"` npm entries. These resolve via symlinks on local disk. A standard CI build running in a container does not have sibling repos at the expected relative paths. **Three options:**

- **A) Mount all repos into the same build workspace** (Cloud Build with multi-source checkout — keeps polyrepo, complicates CI config).
- **B) Publish `blinker-platform` (and any cross-app deps) as private npm packages** to GCP Artifact Registry — keeps polyrepo, adds publish step but standard pattern.
- **C) Convert to a monorepo** with Turborepo/Nx — biggest one-time work; cleanest long-term.

This is the **single highest-leverage architectural decision** for Phase 2. Pick before any CI work starts.

### 2.3 PostHog never actually initializes anywhere

`packages/telemetry/track()` wraps `window.posthog.capture()` IF present, else `console.log`. Audit found `posthog.init(...)` is **not called in any portal's `main.jsx` or `index.html`**. All 25 waves of telemetry events are silently dropping to console. PostHog project "Blinker" exists but is empty.

**Fix**: 5 lines per portal entry — `import posthog from 'posthog-js'; posthog.init(import.meta.env.VITE_POSTHOG_KEY, { api_host: import.meta.env.VITE_POSTHOG_HOST });`. Trivial; high impact for Phase 2 funnel analytics.

### 2.4 `VITE_ALLOW_DEV_VAULT_TOKEN` defaults to `true` (PCI risk)

`protection-portal/src/lib/fluidpay.js:63` defaults this flag to `'true'` when the env var is absent. When true, FluidPay tokenizer is bypassed and synthetic `tok_dev_*` tokens are minted from raw card inputs. **A production Vite build without this env var explicitly set to `false` would accept raw card data in the browser** — broadens PCI scope by accident.

**Fix**: flip the default to `false`, gate dev-mode behind `import.meta.env.DEV === true`. Add a build-time assertion. Document in a new ADR for PCI scope.

### 2.5 StoneEagle SOAP credentials may be exposed browser-side

`packages/integrations/product_admin/stoneeagle.js` builds the SOAP envelope including `TpaCode`, `UserId`, `Password`, `DealerNo` — and POSTs it via the Vite `/se-rating` proxy to `staging.fiadmin.com`. **Need to confirm**: is the browser sending real credentials in the envelope today? (The org-registry canon has these as fixture values labelled "NOT real secrets" — but if the dev proxy works against UAT with these fields in the body, the production path would replay this pattern with real creds.) **Production path requires a backend proxy that injects creds server-side from Secret Manager.**

### 2.6 Hardcoded API keys

- Google Places: `packages/components/AddressBlock.jsx:70` — `AIzaSy...`.
- VinAudit: `packages/utils/vinDecode.js:23` — `2S1SZI7HUF89L6Z`.

Both must be externalized to env vars (and ideally restricted to allowed domains via Google's API console / VinAudit's IP allowlist) before any production deploy.

### 2.7 Domain entity stubs block any real mutation

`canon/blinker-domain.json` has full shapes for `contact`, `tag`, `note`, `activity`, `household_relationship`. **One-line stubs** for `opportunity`, `vehicle`, `household`. Missing entirely: `quote`, `contract/agreement`, `payment`, `refund`, `payment_plan`, `audit_log`. The first Phase 2 mutation through `blinkerApi.opportunities.create()` will invent a shape that diverges from later consumers. **`opportunity` and `vehicle` shapes must land before any write API is wired.**

### 2.8 `org-disclaimers.json` e-sign + payment-auth copy is placeholder

TCPA copy is real. **e-sign consent and payment-authorization copy are `_TODO` placeholders** lifted from legacy DocuSeal templates. No per-org overrides have been seeded. No Spanish translations (Nicaragua org needs them). **Blocks any consumer-facing production launch** — these screens cannot show placeholder text to a real customer.

### 2.9 13 unpushed commits across 3 repos

Nothing has been pushed in ~7 days. Wave 21–25 lives only on this machine. **Before Phase 2 infrastructure work** (which involves new repos, CI, shared API surfaces), there should be a push + review session. Suggested gate: user smokes W24 + W25 (already requested), then push.

### 2.10 Customer-portal not started

CLAUDE.md exists; no source code. Last in Phase 1 build order, deliberately deferred. **Decision needed**: build it as the final Phase 1 wave (Wave 26), or fold it into Phase 2 alongside backend wiring? My recommendation: **build the shell now** (token-driven SPA scaffold, importing existing portal customer views) so Phase 2 can deploy a single matrix of front-ends.

---

## Section 3 — Memory + doc cleanup (mechanical, low-risk)

### 3.1 Memory files (16 total)

- **KEEP (7)**: `feedback_agent_long_commands`, `feedback_canon_todo_defaults`, `feedback_coordinator_dispatch`, `feedback_embed_ui_gotchas`, `feedback_looker_embed_pattern`, `feedback_scope_boundary`, `feedback_silent_prop_drop`, `project_monthly_pay_vsc_products`, `project_refi_portal_quirks`.
- **UPDATE-IN-PLACE (4)**: `project_platform_packages` (Waves 21-25 not reflected), `project_post_1_5_iteration` (body cuts off at W21-fu; missing W22-25), `reference_state_locations` (canon version stamped 2026-05-05; actual is 2026-05-10-v307; missing keys for blinkerApi/EFS emulate/vin_validate_scenario), `MEMORY.md` index (header description for `project_post_1_5_iteration` cuts off; lists retired memories without RETIRED notes).
- **ARCHIVE-OR-DELETE (4)**: `project_phase_1_5_pipeline` (self-declares CLOSED 2026-05-04), `project_wave_21_fu_real_se_calls` (smoke completed; findings absorbed into ADR 13 + STATUS.md), `reference_shared_components` (self-declares RETIRED 2026-05-05), and the W22-25 work has effectively superseded most of the older project memories' detail.

### 3.2 Architecture ADRs

- **15 written**: 00, 02, 06–17. All current or with valid open-backlog blocks (ADR 14 + ADR 17 educated-guess defaults; ADR 13 needs Wave 21+ extensions reflected in body; ADR 11 has stale roadmap table).
- **4 never written**: ADR 01 (event taxonomy), 03 (canon versioning), 04 (personas), 05 (status state machines). All four have shipped artifacts (telemetry infra, sync script, personas.json, ghl-status.json) but no narrative ADR. **Decision needed**: write them as part of Phase 2 prep or accept the deferral?
- **My take**: ADR 01 (event taxonomy) is the most load-bearing — write it before Phase 2 funnel work. The other three can be deferred.

### 3.3 Canon `_TODO` arrays

- **Highest-priority canon gap**: `plan-mappings.json` `term_semantics.by_regulated_rule_id` defaults are *confirmed wrong* (W23 smoke proved Omega EXCL Total Miles is `absolute_from_purchase`, not `additive`). Customer-facing mileage labels are incorrect today. ADR 14 backlog calls for an authoritative mapping derived from real SE contract docs.
- **Second-priority**: W25 `vin_validate` config values on all 7 orgs are educated guesses flagged `_TODO`. Gate refund + re-pick UX in `RatesChanged.jsx`.
- **Items shipped but `_TODO` not cleared**: `plan-mappings.json` `vehicle_class_rule` (DONE 2026-05-09 but `_TODO[2]` still says DONE — text-cleanup); `relationships.json` `_TODO` (resolved by W20).
- **Domain backlog**: `blinker-domain.json` stubs for opportunity, vehicle, household (covered above).

### 3.4 STATUS.md sections

- **Banner + Wave 22-25 sections**: CURRENT.
- **Per-app status section**: stale through W22+ (does not reflect Waves 13-25 additions in protection/mc/insurance).
- **Cross-cutting → Canon section**: stamped `_version = 2026-05-03-cross-sell-orchestration`; reality is `2026-05-10-v307-spec`. **7+ version bumps stale**.
- **Cross-cutting → Architecture section**: ADRs 01/03/04/05 still listed as `⏳ placeholder`; 09–17 shipped but not in this list.
- **Decision log**: last entry 2026-05-02. **35+ wave decisions not logged.**
- **Risks & open issues**: many items resolved but not struck; new risks not added.

These sections are the "front door" for any new agent or human onboarding. **Recommend full refresh as part of Wave 26 cleanup.**

### 3.5 Child-app CLAUDE.md staleness

- `protection-portal/CLAUDE.md`, `mission-control/CLAUDE.md`, `insurance-portal/CLAUDE.md` — all reference `~/Documents/Claude/Projects/Refinance Application Version 2/refi-prototype/src/` as the lift source for screen patterns. **That directory was renamed to `refi-portal/`** and the relevant components have been lifted to `blinker-platform/packages/`. Any agent following these CLAUDE.mds will navigate to a non-existent path.
- `refi-portal/CLAUDE.md` — describes "Phase 1.5b acceptance (this session)" as if in-progress; 7+ days stale.
- **Recommend cleanup pass on each CLAUDE.md** as part of Wave 26.

---

## Section 4 — Phase 1 backlog prioritization (Wave 26 cleanup → Wave 27+ Phase 2)

### Wave 26 — Cleanup (recommended next; mostly mechanical, ~1–2 days dispatched)

**Phase A: Coordinator-direct (no agents)**
- A1: Update STATUS.md cross-cutting sections (Canon/Architecture/Decision-log/Risks).
- A2: Archive 4 memory files (rename to `_ARCHIVED_*` or delete; update MEMORY.md index).
- A3: Update 4 memory files (project_platform_packages, project_post_1_5_iteration, reference_state_locations, MEMORY.md).
- A4: Clean canon `_TODO` items that are DONE (`vehicle_class_rule`, `relationships`).
- A5: Update `blinker-platform/CLAUDE.md` Phase 1 build order to reflect customer-portal status.

**Phase B: Dispatched (parallel — different repos)**
- B1: Run `sync-canon-into-apps.sh`; commit canon-sync drift in insurance/refi/customer; sync mc + protection from v305 → v307 with proper commits.
- B2: Update 4 child-app CLAUDE.md files (replace `Refinance Application Version 2` paths; reflect current packages/ surface; refi-portal Phase-1.5 cleanup).
- B3: Fix the lucide-react peerDep build break — re-run `npm install` in each child repo, smoke `npm run build` succeeds.
- B4: Wire `posthog.init()` in each portal's `main.jsx`; verify events fire.
- B5: Externalize hardcoded API keys (Google Places, VinAudit) to env vars + `.env.example` per repo.
- B6: Flip `VITE_ALLOW_DEV_VAULT_TOKEN` default to `false`; add build-time assertion.

### Wave 27 — Phase 1 functional gaps (1–2 weeks; some dispatch, some discussion)

**Phase A: Decisions (must precede execution)**
- D1: Backend architecture — extend Rails, new Node service, or defer (see §5.1).
- D2: Frontend hosting / deploy topology (see §5.2).
- D3: Polyrepo CI/CD strategy (see §2.2).

**Phase B: Phase 1 hardening**
- C1: Write missing ADR 01 (event taxonomy) — canonical event-name list; reconcile insurance-portal snake_case events with platform dotted form.
- C2: Canonicalize `opportunity` and `vehicle` entity shapes in `blinker-domain.json` — these block any real mutation.
- C3: Extract real e-sign + payment-auth disclaimer copy from legacy DocuSeal/billing templates into `canon/org-disclaimers.json`.
- C4: Build customer-portal shell (token-driven SPA scaffold; imports existing customer views from sibling portals).
- C5: PCI scope ADR (formal platform-level doc); confirm StoneEagle SOAP creds aren't browser-exposed.
- C6: Address VinValidate `vin_validate` canon defaults (partner-ops + finance review) + ADR 14 `term_semantics` authoritative mapping.

### Wave 28+ — Phase 2 starts

After Wave 26 + 27 land + decisions D1–D3 are made, Phase 2 work begins. Suggested first-wave Phase 2 scope:
- First Cloud Run / Cloud Function backend service (probably the StoneEagle backend proxy since it unblocks the SOAP creds concern).
- `packages/api/` HTTP client (`createHttpClient()` against `VITE_BLINKER_API_URL`).
- Cloud Build pipeline for blinker-platform packages → private npm publish (or monorepo conversion if D1 picks that path).
- Secrets Manager wiring for the new backend.
- First end-to-end real-call demo against a deployed Cloud Run dev environment.

### P2 (defer — post-Phase-2-launch)

- Monthly-pay VSC products UX (currently filtered out by normalizer placeholder).
- Insurance-portal real EI integration (still 100% mock).
- DocuSeal eContracting (StoneEagle GenerateContract / VoidContract / PrintContractPDF).
- GHL bi-directional sync (mass: webhooks + conflict resolution).
- Twilio + Mandrill real sends.
- Plaid (refi income verification).
- S3 (storage for org logos + DocuSeal templates).
- Email verification (NeverBounce).
- SMS lookup (Twilio Lookup).
- Express Aftermarket TPA provider (StoneEagle alt).
- Customer auth (decision in §5.3 may move this earlier).

---

## Section 5 — Phase 2 design decisions (need user input)

These are the decisions that gate any Phase 2 build. None are documented; all need a reviewable answer from you.

### 5.1 Backend architecture — extend Rails or build new Node service?

**Why now**: `blinkerApi` will make HTTP calls starting in Phase 2. Something has to answer them.

| Option | Trade-off |
|---|---|
| **A) Extend legacy Rails app** with new endpoints returning canonical shapes. | Single deploy target, fastest path. Couples rewrite to Rails deployment cadence. Rails team owns the new endpoints. |
| **B) New Node service** (modeled on `payment-processing-platform/orchestrator/`). Reads from legacy Postgres, returns canonical JSON. | Matches the GCP-first direction. Rewrite team owns the surface. More work; more moving parts. |
| C) Defer to Phase 3 (full DB rewrite). | Not viable — frontend can't ship without a backend. Rules this out. |

**My take**: **Option B** — a new Node service. Reasons: (1) The polyrepo pattern + Vite frontends are already GCP-shaped; adding a Cloud Run service mirrors what payment-processing-platform already does. (2) The rewrite team controls the cadence. (3) Avoids re-introducing Rails coupling we're trying to escape. (4) The Node service can read legacy Postgres directly during Phase 2; legacy Rails endpoints stay untouched.

### 5.2 Frontend hosting topology

**Why now**: Determines whether the embed-in-iframe model can stay simple.

| Option | Trade-off |
|---|---|
| **A) Single domain + subpaths** (`app.blinker.com/protection`, `/mc`, `/insurance`, etc.) | Same origin → no CORS, no postMessage auth relay. Simplest embed. Requires reverse proxy router. |
| B) Multiple subdomains (`protection.blinker.com`, `mc.blinker.com`) | Independent deployments. Breaks current iframe embed model unless `postMessage` auth relay is built. |
| C) Single bundle served from mc | Module federation across portals; significant build complexity. |

**My take**: **Option A** — single domain + subpaths via Cloud Run + URL Map (or Firebase Hosting rewrite rules). Lowest friction; matches current dev-server symlink model.

### 5.3 Customer / consumer auth model

**Why now**: protection-portal currently has no customer login. Wizard accepts a `customerToken` URL param.

| Option | Trade-off |
|---|---|
| **A) Token-URL** (current legacy pattern) — `/p/:token` resolves org + workflow + prefill. Time-limited, unauthenticated public pages. | Simplest. No password/session needed. Matches legacy. |
| B) Phone OTP | Better returning-user UX. Requires Twilio (Phase 2 anyway). |
| C) Magic-link email | Cleaner audit trail. Requires Mandrill (Phase 2 anyway). |

**My take**: **Option A for Phase 2 launch** — keeps scope minimal. Phone OTP / magic link as a post-launch enhancement.

### 5.4 Internal staff auth (mission-control)

**Why now**: Real agents log in before Phase 2.

| Option | Trade-off |
|---|---|
| A) Share legacy Devise tokens | Fastest. Couples rewrite to legacy auth. Agents have one login. |
| **B) Google Identity / Firebase Auth** | Matches GCP direction. Internal staff are likely on Google Workspace already. Cleanest decoupling. |
| C) New Devise in the new Node service | Most work. Most control. |

**My take**: **Option B** — Google Identity. SSO via Google Workspace for staff. Quick to wire; pairs naturally with GCP.

### 5.5 GHL sync — Phase 2 or post-launch?

**Why now**: If production agents start creating contacts in new mc, GHL diverges within hours.

| Option | Trade-off |
|---|---|
| A) Implement bi-directional sync pre-launch | Heavy work (webhooks, conflict resolution). Blocks launch. |
| **B) New mc runs read-only / demo until GHL sync built** | Lowest risk. Beta is read-only or limited-org. |
| C) Declare GHL out-of-scope for Phase 2; agents told to ignore GHL | Risky — agents may create duplicate records. |

**My take**: **Option B** — new mc launches read-only or limited to one beta org with a one-way Blinker → GHL writer (no inbound). Full bi-directional sync as a Phase 2.5 wave.

### 5.6 Secrets management

**My take**: Google Secret Manager for backend secrets. CI vars for build-time public keys (Vite `VITE_*` env vars are public-by-design). Document the split in a new ADR.

### 5.7 CI/CD

**My take**: GitHub Actions per repo for the static frontends (build → deploy to Firebase Hosting / Cloud Storage). Cloud Build for the backend Node service (build → deploy to Cloud Run). Decision blocks on §2.2 (file: dep model) — if we go monorepo, single Actions/Cloud Build pipeline.

### 5.8 DocuSeal eContracting — Phase 2 launch blocker?

| Option | Trade-off |
|---|---|
| A) Implement before launch | A real VSC sale isn't complete without a signed contract. |
| **B) Manual contracting for beta** | Limited-org beta; agents fall back to current legacy DocuSeal flow. |

**My take**: **Option B** for limited-org beta launch; full DocuSeal integration as a fast-follow Phase 2 wave.

---

## Section 6 — Recommended sequencing

Three waves before "Phase 2 has officially started":

```
Wave 26 (1–2 days): Hygiene cleanup + critical mechanical fixes
  ├─ Phase A (coordinator): STATUS.md refresh, memory cleanup, ADR table updates
  └─ Phase B (parallel dispatched): canon-sync, CLAUDE.md updates, lucide-react fix,
                                     posthog init, hardcoded keys, dev-vault flag

Wave 27 (1–2 weeks): Phase 1 hardening + Phase 2 design decisions
  ├─ Decision session (this is the user-review meeting): D1–D3 above
  ├─ ADR 01 (event taxonomy) written
  ├─ opportunity + vehicle entity shapes in blinker-domain.json
  ├─ org-disclaimers.json e-sign + payment-auth real copy
  ├─ customer-portal shell built (last Phase 1 portal)
  ├─ PCI scope ADR + StoneEagle SOAP creds confirmation
  └─ canon vin_validate + term_semantics partner-ops/finance review

Wave 28+: Phase 2 begins
  ├─ First Cloud Run backend service (StoneEagle SOAP proxy as flagship)
  ├─ packages/api HTTP client (createHttpClient, isFixtureMode flip)
  ├─ Secret Manager wiring
  ├─ CI/CD pipeline (per §5.7 + §2.2 decisions)
  └─ First end-to-end real-call demo against deployed dev environment
```

Total wall-clock time before Phase 2 work starts: **~2 weeks of focused effort** (not full-time; depends on how the user-review meeting goes).

---

## Section 7 — The ultimate question

> *Are we at a good place and ready to start building to a live dev and prod environment in the cloud?*

**Yes — with caveats.**

Phase 1 has done what it set out to do: a functional prototype with real-call paths gated behind DevPanel toggles, embed contracts working across all portal pairs, every consumer flow demonstrable, every agent flow demonstrable, comprehensive canon shaping the data model, and 14 ADRs locking key decisions.

The caveats are:
1. **2 weeks of mechanical cleanup** (Wave 26 + Wave 27 hardening) before the codebase is in a state where you'd want to wire up real cloud infrastructure against it. Skipping this means dealing with broken builds, hardcoded keys, and untracked PostHog events while *also* doing greenfield backend work — that's a recipe for blocked dispatch loops.
2. **5–6 design decisions** (§5) need user input before the first backend line of code is written. None are documented today. This is a 1–2 hour meeting + a few ADRs.
3. **Phase 2 is greenfield infrastructure** — no Dockerfile, no CI, no auth, no secrets, no hosted backend exists today in the rewrite. The payment-processing-platform's Cloud Function + Orchestrator pattern is the closest reference point and is the right shape to copy. Plan for real engineering effort, not a 1-week wave.

**Concrete recommendation**: Land Wave 26 cleanup this week. Hold the user-review meeting for §5 decisions. Land Wave 27 hardening over the following week. Then officially open Phase 2 with a first wave that ships a single end-to-end real-call against deployed Cloud Run / Cloud Function infrastructure.

The prototype is in good shape. The infrastructure runway is greenfield. Don't conflate the two.

---

## Appendix — Top items requiring user discussion (compressed)

These are the questions to bring to the review meeting:

1. **Backend architecture** (§5.1) — A/B/C → my take: B (new Node service).
2. **Frontend hosting topology** (§5.2) — my take: A (single domain + subpaths).
3. **Polyrepo CI strategy** (§2.2) — A/B/C → my take: B (private npm packages on Artifact Registry).
4. **Customer auth model** (§5.3) — my take: A (token-URL) for launch.
5. **Staff auth** (§5.4) — my take: B (Google Identity).
6. **GHL sync timing** (§5.5) — my take: B (read-only / limited-org beta).
7. **Build the missing 4 ADRs?** (§3.2) — my take: write ADR 01 now; defer 03/04/05.
8. **ADR 14 + W25 vin_validate canon defaults** — schedule partner-ops + finance review session.
9. **Customer-portal shell now or in Phase 2?** (§4 Wave 27) — my take: build it as last-Phase-1.
10. **Push the 13 unpushed commits?** — my take: gate on user smoke W24 + W25, then push.
11. **Wave 26 cleanup approval** — should I dispatch it?
12. **DocuSeal eContracting** — Phase 2 blocker or beta-launch blocker?
