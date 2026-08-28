# CLAUDE.md — home-protection-portal

The **Home Protection Plan** consumer wizard. A sibling app in the Blinker
platform polyrepo, on the locked substrate: **Vite + React 19 + JavaScript
(no TypeScript) + lucide-react + Tailwind (CDN)**.

Governing decision record: **`blinker-platform/architecture/30-home-protection-plan.md`**
(ADR 30). Design spec: `blinker-platform/docs/superpowers/specs/2026-08-25-home-protection-plan-design.md`.
Read ADR 30 before changing anything in `src/lib/` or `src/views/customer/`.

## What this app is

A nine-step wizard that quotes OMEGA's **Omega-J Home 2024** home-warranty
line through StoneEagle `GetRates`, prices customer-selected optional
coverages, and signs one of six DocuSeal agreements.

Six plans, all `TpaCode=OMGA` / `ProductTypeCode=VSC`:

| Plan | Tier | Structure | Terms |
|---|---|---|---|
| 35 | good | fixed term | 12 / 24 / 36 / 48 mo |
| 36 | better | fixed term | 24 / 36 / 48 mo |
| 37 | best | fixed term | 24 / 36 / 48 mo |
| 38 / 48 / 49 | good / better / best | month-to-month | 1–23 mo |

## The steps

```
home_add              type, address, year built, sq ft; eligibility gate; fires GetRates
home_features         the twelve "does the home have X" questions
recommended_coverage  good/better/best; global term <-> monthly switch
[customize]           conditional — opt-in plan browser
optional_coverages    priced add-ons, filtered by plan code + term
                      CONDITIONAL — dropped for monthly plans 38/48/49
confirm               review; totals INCLUDE add-ons
billing_payment       FluidPay hosted fields + contact capture
docuseal              real signing integration
thank_you             completion
```

`buildSteps(form)` in `src/views/customer/CustomerView.jsx` owns the
conditional splicing. `stepIdx` is a plain integer index into that list.

## Rules that are easy to get wrong

1. **Add-on dollars are IN the money path.** `total_cost = plan.total_cost +
   sumAddOnPrices(form.selectedAddOns)`, and every downstream figure —
   discount ceiling, down payment, monthly payment, due today, the charge,
   `ProductPrice` on the agreement — derives from that. This is a real
   divergence from `protection-portal`, where add-on passthrough totals are
   display-only and never reach `paymentSchedule`. (ADR 30 D7.)

2. **Any plan or term change must run `revalidateSelections`.** Both the
   `option_id` and the price move when the plan or term flips — internal
   plumbing is $57 at 12 months, $152 at 36 months on plan 35, and $186 at
   36 months on plans 36/37. A carried-forward selection mischarges against
   a signed agreement.

3. **`optional_coverages` is conditional.** Plans 38 / 48 / 49 return no
   `<Option>` rows at all, so the step is removed from the list, not
   rendered empty.

4. **At 12 months only plan 35 exists.** Better and Best render an explicit
   "not available at 12 months" state. Never silently borrow a plan from a
   different term.

5. **An ineligible home blocks at `home_add`.** `classifyDwelling` returning
   `null` means no dwelling checkbox exists on the Omega agreement for that
   (home_type, square_feet) pair. Disable Continue and explain; do not quote.
   (ADR 30 R2 — the rule is inferred from the agreement PDF, not stated by
   Omega. Confirm with product.)

6. **Do NOT port `protection-portal/src/lib/plan-selector.js`.** Home tiering
   has no term/mileage optimizer, no `classifyAsNew`, no new/used
   preference, no deductible filter, and no tier borrowing. Tier comes
   straight from `plan_catalog.plan_level` via `resolvePlanPresentation`.
   `src/lib/home-plan-selector.js` is deliberately ~1/5 the size.

7. **Tooltips use the custom pattern** — trigger ref + `getBoundingClientRect`
   + `position: fixed` + opacity transition. Native `title=` is banned
   (delay, unstyleable, clipped by `overflow-hidden` ancestors, no keyboard
   affordance).

8. **Add-on prices are never hard-coded.** They come from the live or fixture
   GetRates response (ADR 30 R6). The published price matrix in the spec
   documents shape, not truth.

## Where things come from

Everything workflow-agnostic is imported from `blinker-platform` via the
`file:../blinker-platform` dep — never reimplemented here:

- `blinker-platform/utils` — `classifyDwelling`, `isHomeEligible`,
  `listHomeTypes`, `parseOptionDesc`, `resolveHomeAddOns`, `sumAddOnPrices`,
  `revalidateSelections`, `resolvePlanPresentation`, `validators`,
  `formatPhoneDisplay`
- `blinker-platform/integrations/product_admin` — `getRatesForHome`
- `blinker-platform/integrations/signing` — `resolveTemplateId`,
  `buildHomeSubmissionFields`, `createSubmission`, `resolveSigningMode`
- `blinker-platform/components` — `WizardShell`, `ScreenHeader`,
  `WizardFooter`, `Field`, `PhoneField`, `AddressBlock`, `DevPanel`,
  `Section`, `Segmented`, `JsonPeek`
- `blinker-platform/api` — `blinkerApi.homes`, `.contacts`, `.opportunities`
- `blinker-platform/telemetry` — `track`

Portal→portal `file:` deps are **forbidden** (ADR 30 D4 / ADR 11). This repo
depends on `blinker-platform` only.

## Canon

`src/constants/canon/*.json` is a **synced copy**, never edited here. The
source of truth is `blinker-platform/canon/`. To change it: edit there, bump
`canon/_version`, run `blinker-platform/scripts/sync-canon-into-apps.sh`,
then commit the synced copy in this repo.

Blocks this app reads:
`plan-mappings.json#home_add_ons`, `#home_dwelling_classes`, `#plan_catalog`;
`ghl-status.json#home_protection`; `org-registry.json` per-org
`home_protection_billing` and `opportunities.home_protection.enabled`;
`org-disclaimers.json` for TCPA copy.

## The mission-control embed contract

`mission-control` deep-imports exactly these. Changing a name is a
cross-repo break:

- `src/views/agent/index.js` → `AgentView`
- `src/views/customer/CustomerView.jsx` → `INITIAL_FORM`, `buildSteps`
- `src/lib/status-step-map.js` → `stepFromStatus`
- `src/views/customer/index.js` → the step components + `INITIAL_FORM` + `buildSteps`

`AgentView` props: `persona`, `opportunity`, `contact`, `home`, `form`,
`update`, `stepIdx`, `setStepIdx`, `onFormChange`, `onHomeCommitted`,
`availableStatuses`. **Destructure every prop AgentView accepts** — React
silently discards props that are never named, and that exact bug hid an
unused `opportunity` prop in protection-portal's AgentView for many waves.

## Telemetry

Namespace: `home_protection.<surface>.<step>.<verb>` —
e.g. `home_protection.customer.home_add.ineligible`,
`home_protection.customer.optional_coverages.revalidated`.

## Commands

```
npm run dev      # port 5177
npm run build
npm run lint
npm test         # node --test over src/lib/*.test.js
```

Never run `npm run dev` or `npm install` mid-task in an agent session —
long-running commands trigger a sandbox kill. Use `npm run build` to verify.
