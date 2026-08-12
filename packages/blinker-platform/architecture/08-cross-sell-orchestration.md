# 08 — Cross-Sell Orchestration

## Context

Until 2026-05-03 the four child apps were peers: `protection-portal`, `insurance-portal`, `refi` (still as `refi-prototype`), `payments` (in `payment-processing-platform`). Each owned its workflow end-to-end; cross-app touchpoints were minimal. The first real cross-app embed shipped 2026-05-03 — `protection-portal/src/views/customer/Confirm.jsx` imports `SavingsCard` from `insurance-portal/src/views/customer` via a `file:../insurance-portal` dependency. That validated the embed-don't-fork rule (one source of truth per workflow; consumers reach into the workflow's public surface).

This ADR locks the next step: **`protection-portal` becomes the orchestrator for cross-sell embeds.** The protection workflow's `RecommendedCoverage` step is the agent's selling moment — the consumer is engaged, the agent has a price in hand, but the down payment hasn't committed yet. That's the right place to surface two affordances: "find insurance savings" and "lower your monthly with refinance." Insurance is already an embed source. Refi joins as a second embed source once the prototype (renamed locally to `refi-portal/` on 2026-05-03) is flattened and lifted into the platform pattern in § 1.5b.

This also formalizes that the orchestrator role is asymmetric: protection-portal pulls in from refi-portal and insurance-portal, but neither of those reaches back. Customer-portal will eventually consume from all three but isn't part of the orchestration triangle — it's a re-skinned wrapper, not a cross-sell host.

## Decisions

Five decisions land together. All are dated 2026-05-03 and now appear in `README.md`'s decisions log.

### 1. `refi-portal` repo path + publish

The previous `~/Documents/Claude/Projects/Refinance Application Version 2/` directory was renamed locally to `~/Documents/Claude/Projects/refi-portal/` on 2026-05-03; its inner `refi-prototype/` subdirectory remains for now (flatten happens in § 1.5b as part of substrate work, so the result matches the `*-portal/` flat-layout convention). The GitHub remote is `github.com/BlinkerGit/refinance-prototype` — kept under that name; local↔GitHub asymmetry is acceptable, with a non-destructive GitHub UI rename available as a later follow-up if desired. No other developer is currently active in the prototype, so the rename was non-disruptive.

**Rationale:** the prototype carries the refi domain knowledge (screen sequence, decision-engine logic, fixture shape) but was never built with a persona-aware shell or a public component surface. Lifting it into the protection-portal pattern (substrate → customer view → agent view → public exports) gives it the same shape every other portal has, which is the precondition for being an embed source.

### 2. Two agent affordances at `RecommendedCoverage`

The `RecommendedCoverage` screen renders three plan cards (Good / Better / Best) and is the moment in the protection workflow where the agent is positioning value. Two CTAs land here, framed as marketing buttons that "sell" the opportunity:

- **"Find insurance savings"** — runs the insurance capture+quote flow against Embedded Insurance. Result is the consumer's monthly savings vs. their current premium, applied as monthly buying power against the protection plan.
- **"Lower your monthly with refinance"** — runs the refi prequal flow. Result is amortizing the protection plan price into a refinanced loan using the org's configured min/max rate + term, producing an "added per-month cost" the customer absorbs into their refi payment.

Both CTAs follow the same hybrid agent shell that protection-portal already uses elsewhere: save and send (mock the consumer link), guide the consumer (live screen-share-style), or take over (agent fills it out themselves and saves). In customer self-serve mode, the same CTAs render with consumer-direct copy — no agent affordances, but the same selling logic.

**Rationale:** the legacy product already amortizes protection-plan into a refi loan when both are present (`Blinker::Amortization::FixedTerm#products_payment` — see § Math models). The cross-sell makes that legacy capability legible to the consumer at decision time instead of after the fact. The insurance side is novel-but-validated by the SavingsCard ship.

### 3. Embed surface

Two surfaces, two different containment models:

- **Agent view: side pane.** Same pattern as mission-control's `CoPilotPane` — opens to the right of `RecommendedCoverage` without unmounting it. Agent stays in the protection flow context; the embedded insurance-or-refi flow lives in the pane and writes back into protection-portal's form state when it terminates.
- **Customer view: sub-flow with memory, NOT a modal.** When the consumer clicks a cross-sell CTA, the URL changes (e.g., `?view=customer&substep=insurance-savings`); the sub-flow renders as a real screen sequence, not an overlay. A persistent "Back to coverage" affordance (breadcrumb-style) lets the consumer return to `RecommendedCoverage` at any time without losing protection-flow state. Sub-flow termination (success or back) returns the consumer to `RecommendedCoverage` with the cross-sell result baked into form state.

Both surfaces inherit the parent's persona (the **embed-don't-fork** rule, see decision 5): every cross-app embeddable surface accepts `{ persona, personaLocked }` and respects parent context. Agent persona means the embed renders with agent affordances; consumer persona means consumer-direct copy. `personaLocked` means the embed cannot show its own persona switcher (this is what mission-control's CoPilotPane already passes when composing protection-portal's `AgentView`).

**Rationale (modal rejection):** modals truncate copy, reset focus, and lose state on accidental dismiss. The legacy refi flow was a multi-screen wizard; collapsing it into a modal would force a redesign that doesn't add value. Sub-flow with memory respects the screen-sequence the workflows were built to render.

### 4. Per-org gating: DEV CONTROLS in Phase 1.5; canon-backed config

Each cross-sell CTA is per-org-gated. In Phase 1.5 the gate is wired through DEV CONTROLS (the existing pattern across all portals), backed by a real org-config JSON structure that the API layer will replace later (consistent with `architecture/07-data-layer.md`'s Phase 1 fixtures → Phase 2 real API pattern). The structure lives in `canon/org-registry.json` (decision 5 below); apps read it at boot from their canon copy.

Apex Org 102 is enabled for both insurance and refi (the verified-live test org). All other orgs default to `enabled: false` until product confirms.

**Rationale:** product wants per-org rollout for both compliance and partner-relationship reasons (some partners haven't approved insurance cross-sell). DEV CONTROLS as the override means a sales engineer can demo any org without waiting on backend.

### 5. Math models — two different framings, do NOT conflate

Two different math models drive the two CTAs. Conflating them in code or in copy creates a bug-class that's hard to reason about; document them separately and keep them in separate functions in `protection-portal/src/lib/protection-pricing.js`.

**Insurance: SAVINGS framing.**

```
monthly_savings = current_premium_per_month - new_premium_per_month
```

Already implemented in `insurance-portal/src/lib/money.js` and rendered by `SavingsCard`. The savings figure is applied as monthly buying power against the protection plan: if the new monthly insurance is $50 less than the current monthly insurance, the customer can spend that $50/mo on the protection plan without their total monthly outlay going up. UI copy: "$50/mo savings on insurance — applies as buying power on your protection plan."

**Refi: AFFORDABILITY framing — NOT savings.**

The customer is amortizing the protection plan total cost (e.g. $3,692) into a refinanced auto loan. The legacy formula (`Blinker::Amortization::FixedTerm#products_payment` in `BlinkerLegacy/blinker/lib/blinker/amortization/fixed_term.rb:49-54`):

> ```
> products_sales_price.to_d / term.to_d * (1 + effective_lifetime_interest_rate)
> ```

Where `effective_lifetime_interest_rate = total_finance_charge / initial_loan_amount` and `total_finance_charge` comes from running standard fixed-payment amortization (PMT formula at lines 74-81) over the full refi loan amount, term, and APR.

Translation to JS (lives in `protection-portal/src/lib/protection-pricing.js`):

```js
function pmt(principal, annualRate, termMonths) {
  const r = annualRate / 12;
  if (r === 0) return principal / termMonths;
  const n = termMonths;
  return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

function effectiveLifetimeInterestRate(principal, annualRate, termMonths) {
  const monthly = pmt(principal, annualRate, termMonths);
  const totalPayments = monthly * termMonths;
  const totalFinanceCharge = totalPayments - principal;
  return totalFinanceCharge / principal;
}

// Per-month addition to a refi payment, given a protection-plan total
// and the loan's APR/term. Matches BlinkerLegacy products_payment exactly.
function protectionPlanMonthlyOnRefi({ planTotal, loanPrincipal, apr, termMonths }) {
  const elir = effectiveLifetimeInterestRate(loanPrincipal, apr, termMonths);
  return Math.ceil((planTotal / termMonths) * (1 + elir) * 100) / 100;
}
```

**Worked example.** Customer is refinancing a $3,692 protection plan into the refi loan at 8.99% APR over 60 months (loan principal = $3,692 — the simplest case where the plan is the only thing being financed):

- Monthly rate `r = 0.0899 / 12 = 0.007492`.
- `(1+r)^60 = 1.5673`.
- PMT = `3692 * (0.007492 * 1.5673) / (1.5673 - 1) = $76.62/mo`.
- Total payments over 60mo = `60 * 76.62 = $4,597.20`.
- Total finance charge = `4,597.20 - 3,692 = $905.20`.
- Effective lifetime interest rate = `905.20 / 3,692 = 0.2452 (24.52%)`.
- products_payment = `(3692 / 60) * (1 + 0.2452) = $61.53 * 1.2452 = $76.62 → ceil to $77/mo`.

UI copy: "Add $77/mo to your refi payment to roll your $3,692 protection plan into the loan." NOT "save" copy — this is added cost the customer accepts in exchange for not paying the down payment up front.

When the protection plan is one of multiple things being financed (e.g., a $25,000 vehicle plus a $3,692 protection plan rolled together), the legacy formula uses the loan's full ELIR — so the protection-plan portion of the new monthly is `(plan_total / term) * (1 + ELIR_full_loan)`. For a $28,692 loan at 8.99% / 60mo, that comes out to roughly the same $77/mo for the plan portion (the math is convex in principal but for typical inputs the difference is single-digit dollars). The function above takes `loanPrincipal` as a separate input so the caller can pass the full loan principal when known.

**Source:** `BlinkerLegacy/blinker/lib/blinker/amortization/fixed_term.rb:49-54` (`products_payment`) and `:74-81` (`estimated_equal_payment` — the standard PMT). Configuration fields driving the rate/term defaults: `BlinkerLegacy/blinker/app/models/configuration.rb` — `min_term`, `max_term`, `estimated_payment_term`, `estimated_payment_apr` (derived from `T1_BUYDOWN_MATRIX[estimated_payment_down_pct]` at lines 173-175). Legacy schema does not bake in defaults at the migration level; production-current values for Apex are seeded into `canon/org-registry.json` as TBD-confirm.

## Embed contract

Every cross-app embeddable surface conforms to this contract. The protection-portal SavingsCard ship already implements it; refi-portal will follow the same shape; future embed sources copy it.

### Public surface

A child app exposes its embed sources via named exports from `src/views/customer/index.js` (consumer-facing pieces) and `src/views/agent/index.js` (agent-facing pieces). The `index.js` files are the only public surface — consumers must not reach into deeper paths. Hooks and pure logic exposed for cross-app reuse live at `src/lib/<workflow>.js` (e.g., `insurance-portal/src/lib/money.js`, future `refi-portal/src/lib/refi.js`).

### Persona props

Every embeddable surface accepts:

- `persona`: `'agent' | 'manager' | 'admin' | 'super_admin' | 'consumer'` — the active persona. Drives copy variants and affordance gating (e.g., "View API Responses" for `super_admin` only).
- `personaLocked`: `boolean` — when true, the embed must not render its own persona switcher. mission-control passes `true` because it owns the parent persona switcher.

Persona always inherits from the parent. The embed never decides its own persona based on the embedded URL or local state — the parent app's persona is the source of truth for the entire mounted tree.

### Data flow

- **Phase 1:** fixture-driven. Each portal ships `src/fixtures/*.json` files conforming to `canon/blinker-domain.json` (where applicable). Embeds read fixtures from their own repo's `src/fixtures/` (the `file:` dep makes them resolve normally).
- **Phase 2:** `blinkerApi.{entity}.get|list|create` calls. The fixture-to-API swap is a one-line import change per `architecture/07-data-layer.md`.

### `file:` deps wiring

Consumers add the source app as a `file:` dep in `package.json`:

```json
"protection-portal": "file:../protection-portal",
"insurance-portal":  "file:../insurance-portal",
"refi-portal":       "file:../refi-portal"
```

`npm install` creates a symlink at `node_modules/<app>/`. The consumer's `vite.config.js` should already alias `react` and `react-dom` to its own copy to dedupe through the symlink — no additional `optimizeDeps` tweaks needed. **HMR caveat applies** (see Risks).

### Termination semantics

Sub-flows write their result back to the parent's form state via callback props. For example, refi prequal calls `onPrequalComplete({ apr, termMonths, monthlyPaymentAddition })`. The parent stores it on `form.refiOffer` (see Form state shape), updates the buying-power UI on RecommendedCoverage, and the consumer returns to plan selection with the new context.

## Form state shape

`protection-portal/src/views/customer/CustomerView.jsx`'s `form` object grows two cross-sell slices:

```js
form.insuranceSavings = null
// or
form.insuranceSavings = {
  carrier:                 string,   // new carrier name
  currentPremiumCents:     number?,  // null if customer didn't share
  newPremiumCents:         number,
  termMonths:              6 | 12,   // EI default 6
  monthlySavingsCents:     number,   // derived: (current - new) / termMonths
  capturedAt:              ISO,
  source:                  'embedded_insurance',
}

form.refiOffer = null
// or
form.refiOffer = {
  apr:                       number,    // decimal, e.g. 0.0899
  termMonths:                number,
  loanPrincipalCents:        number,    // full loan amount being refinanced
  protectionPlanPortionCents: number,    // computed via products_payment formula
  prequalApprovedAt:         ISO,
  source:                    'refi_prequal',
}

// Effective monthly the customer faces (computed, not stored — derived per render):
//   protectionMonthly      = form.payment.monthly                          // current planned protection monthly
//   - insuranceSavingsApplied = form.insuranceSavings?.monthlySavingsCents (clamped to <= protectionMonthly)
//   + refiAddition         = form.refiOffer?.protectionPlanPortionCents
//   = effectiveMonthly
```

Computed effective monthly is a pure function in `src/lib/protection-pricing.js`; UI calls it on every render. No state is persisted for the derived value.

## Org config schema reference

The per-org cross-sell + protection-plan-financing config is canonized in `canon/org-registry.json` under each org's `cross_sell` block:

```json
{
  "cross_sell": {
    "insurance_enabled": true,
    "refi_enabled": true,
    "protection_plan_financing": {
      "min_apr": 0.0499,
      "max_apr": 0.1499,
      "min_term_months": 36,
      "max_term_months": 84,
      "default_apr": 0.0899,
      "default_term_months": 60
    }
  }
}
```

The `protection_plan_financing` block is only relevant when `refi_enabled: true`. Defaults seed reasonable mid-tier auto-refi values; production-actual defaults come from each org's legacy `Configuration` row (`estimated_payment_apr` derived from `T1_BUYDOWN_MATRIX`, `estimated_payment_term`, `min_term`, `max_term`) and are TBD-confirm for orgs other than Apex 102.

Read pattern from a child app:

```js
import orgRegistry from 'src/constants/canon/org-registry.json';
const org = orgRegistry.orgs.find(o => o.id === orgId);
const insuranceEnabled = org?.cross_sell?.insurance_enabled ?? false;
const financing = org?.cross_sell?.protection_plan_financing;
```

When the Phase 2 org-config API endpoint lands, this lookup becomes `await blinkerApi.orgs.get(orgId)` returning the same shape; the consumer's import line is the only thing that changes.

## Risks

- **Protection-portal becomes the highest-coupling app.** Three `file:` deps (`insurance-portal`, `refi-portal`, plus mission-control's reverse dep on `protection-portal`'s AgentView). Build size grows; HMR surface widens. Track bundle size before and after the refi embed lands.
- **Integration testing is harder.** A break in `refi-portal/src/views/customer/index.js` only surfaces when protection-portal builds, not when refi-portal builds. The fix is a smoke build of protection-portal whenever any embed source changes; CI hook lands when CI lands. Until then, manual smoke after any embed-source change.
- **HMR caveat propagates.** Vite HMR doesn't reliably propagate edits inside `file:`-linked deps into the consumer's dev server. Restart `npm run dev` in protection-portal after any change to insurance-portal or refi-portal source. mission-control already documents this in `CoPilotPane.jsx` header; protection-portal needs the same comment in `RecommendedCoverage.jsx` once embeds wire in.
- ~~**refi-prototype rename + GitHub publish is a manual user step.**~~ Resolved 2026-05-03. Local rename done; GitHub remote at `github.com/BlinkerGit/refinance-prototype`. App source nested at `refi-portal/refi-prototype/`; § 1.5b flatten lands as part of substrate.
- **Math-model conflation risk.** Insurance is savings framing; refi is affordability framing. Code, copy, and analytics MUST keep them separate. Two PostHog events (`insurance_savings_applied` vs `refi_offer_accepted`), two form-state keys (`form.insuranceSavings` vs `form.refiOffer`), two functions in `protection-pricing.js`. Do not introduce a unified `crossSellResult` shape — it tempts a reader into thinking the math is symmetric, which it is not.
- **Legacy formula assumes single APR/term across the loan.** When the protection plan is financed at a different rate than the vehicle (some lenders do this), the formula breaks. Out of scope for Phase 1.5 — flag if a real refi offer ever returns split rates.

## Sequencing

The Phase 1.5 build sequence lives in `PROMPTS.md`:

- **§ 1.5a — docs + canon (this prompt's output, this session).** This ADR + canon org-config + STATUS.md surfaces.
- **§ 1.5b — refi-portal substrate + customer view.** First child-app session; lifts screens from the prototype, scaffolds the standard substrate, ships consumer view by `?view=customer`.
- **§ 1.5c — refi-portal agent view + hybrid mode + public exports.** Second session; mirrors protection-portal's agent shell pattern; named exports for `PrequalForm`, `OffersCard`, `QualifiedCard`; public `useRefiPrequal` hook.
- **§ 1.5d — protection-portal embed wiring.** Final session; adds `file:../refi-portal` dep; implements `src/lib/protection-pricing.js`; updates `RecommendedCoverage` with the two CTAs and the strikethrough/buying-power UI; customer-view sub-flow with breadcrumb-style "Back to coverage"; DEV CONTROLS toggles; canon org-config gates the buttons.
- **§ 1.5e — coordinator pass.** STATUS.md flips Phase 1.5 to ✅; risks log updated with whatever surfaced; customer-portal unblocks.

The ordering is constrained: refi-portal must be a real embed source (1.5b + 1.5c) before protection-portal can wire to it (1.5d). Insurance side is already done — `SavingsCard` ships and `Confirm.jsx` already imports it.
