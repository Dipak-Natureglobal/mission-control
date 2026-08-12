# Blinker Refinance v2 — Clickable Prototype

Interactive React prototype for the Refinance v2 auto loan workflow. Covers the full agent-facing flow from embedded quote card through vehicle capture, applicant intake, decision engine, and Stage 2 results — including insurance savings finder and protection plan upsell.

## Quick Start

```bash
cd refi-prototype
npm install
npm run dev
```

Open `http://localhost:5173` in your browser. The Dev Panel on the left controls every aspect of the prototype state.

### Environment Variables (optional)

Copy `.env.example` to `.env` and fill in API keys. The prototype falls back to hardcoded dev keys if these are absent, so this is only needed if the keys are rotated.

```
VITE_PLACES_API_KEY=...      # Google Places (street autocomplete)
VITE_MARKETCHECK_API_KEY=... # MarketCheck (vehicle valuation)
VITE_VINAUDIT_API_KEY=...    # VinAudit (VIN decode)
```

---

## Architecture

The prototype is a **single-file React component** (`refinance-v2-prototype.jsx`, ~4100 lines) wrapped in a standard Vite project. A reference split into ~40 component files lives in `src/` for engineering to use as a starting point for the production build.

### File Layout

```
Refinance Application Version 2/
├── refinance-v2-prototype.jsx   ← Canonical working prototype (single file)
├── refi-prototype/              ← Vite project wrapper
│   ├── .env.example
│   ├── vite.config.js
│   ├── index.html               (includes Tailwind CDN)
│   ├── src/
│   │   ├── App.jsx              (imports the prototype)
│   │   ├── main.jsx             (React entry point)
│   │   ├── constants/           (reference split — static data)
│   │   ├── utils/               (reference split — API + validation)
│   │   ├── hooks/               (reference split — form state)
│   │   ├── components/          (reference split — shared UI)
│   │   ├── screens/             (reference split — wizard screens)
│   │   └── results/             (reference split — Stage 2 results)
```

### Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| react | 19.x | UI framework |
| lucide-react | latest | Icon library |
| Tailwind CSS | CDN | Utility-first styling (via `<script>` tag in index.html) |

**Production note:** Replace the Tailwind CDN with a proper PostCSS/Tailwind build.

---

## Screens & Flow

### Stage 1 — Wizard (Sequential)

| Screen ID | Component | Purpose |
|-----------|-----------|---------|
| `embedded_entry` | `EmbeddedPre` / `EmbeddedPost` | Pre-apply card + post-result card |
| `vehicle_add` | `ScreenVehicleAdd` | VIN entry + YMMT picker + mileage/condition |
| `vehicle_drive` | `ScreenVehicleDrive` | Confirm drive + MarketCheck valuation |
| `s1_ownership` | `ScreenOwnership` | Financed / Leased / Owned / None |
| `s1_auto_loan` | `ScreenAutoLoan` | Lender + monthly payment + payoff |
| `s1_credit` | `ScreenCredit` | Self-reported credit band |
| `s1_co_app_decision` | `ScreenCoAppDecision` | Co-applicant yes/no |
| `s1_co_app_contact` | `ScreenCoAppContact` | Co-applicant name/phone/email |
| `s1_co_app_employment` | `ScreenCoAppEmployment` | Co-applicant employment |
| `s1_applicant` | `ScreenApplicant` | Primary applicant name/phone/email |
| `s1_housing` | `ScreenHousing` | Address + own/rent + street autocomplete |
| `s1_employment` | `ScreenEmployment` | Employer + type + income |
| `s1_identity_consent` | `ScreenIdentityConsent` | DOB + SSN + soft pull consent |

**Dynamic ordering:** Co-applicant screens appear early (after credit) for poor credit bands, later (after employment) for fair+ bands.

### Stage 2 — Decision Engine & Results

| Screen ID | Component | Purpose |
|-----------|-----------|---------|
| `decision_engine` | `DecisionEngineScreen` | Animated rule evaluation log |
| `stage2_result` | `StageTwoResult` | Orchestrates result cards below |

**Result cards (one shown based on decision):**

- `QualifiedHandoffCard` — Pre-approved (Gravity). Agent talk track, why-qualified bullets, partner handoff, what-happens-next.
- `OffersCard` — Offers returned (Savings Group). Offer cards with APR/term/monthly, combined savings when insurance savings exist.
- `DisqualifiedCard` — Not eligible. Reason code display, retry CTA.
- `PendingCard` — Awaiting partner response.

**Add-on cards (shown below result card):**

- `InsuranceTeaser` — When `insuranceReviewed === false`. SMS flow to send Canopy Connect link.
- `InsuranceSavingsCard` — When savings found. "At a Glance" + "Buying Power" tab views.
- `ProtectionPlanTeaser` — When `planSold === false`. Best/Better/Good tier cards, SMS flow. Insurance savings adjust prices as buying power.

---

## Insurance Savings Integration

Insurance savings flow through three touchpoints:

1. **Refi Offers (OffersCard)** — Each offer shows refi savings + insurance savings + combined total. A banner at the top summarizes the combined monthly savings.

2. **Protection Plans (ProtectionPlanTeaser)** — Plan tier cards show dual pricing when insurance savings exist: `$97 / $122` format with the adjusted price in green and original price struck through. A note reads "*Adjusted by $25 per month in Auto Insurance Savings".

3. **InsuranceSavingsCard** — Two tab views:
   - **"Glance"** — Current carrier, monthly cost, coverage checklist (pass/fail), potential savings hero, Find Coverage CTA.
   - **"Buying Power"** — Ties insurance savings to protection plan affordability. Shows cheapest plan price + insurance savings amount.

### DevPanel Insurance Controls

| Control | Default | Effect |
|---------|---------|--------|
| Insurance reviewed | Yes | No → shows InsuranceTeaser (SMS flow) |
| Insurance savings found | No | Yes → shows InsuranceSavingsCard + adjusts plan prices |

---

## Decision Engine Rules

The simulated decision engine in `runDecision()` evaluates these rules in order:

1. **Applicant age** — Under 18 → disqualified (`under_18`)
2. **Vehicle age** — Exceeds `maxVehicleAgeYears` → disqualified (`vehicle_too_old`)
3. **Mileage** — Exceeds `maxMileage` → disqualified (`mileage_too_high`)
4. **Ownership** — Not in `eligibleOwnership` → disqualified (`ownership_ineligible`)
5. **Payoff** — Below `minPayoff` → disqualified (`payoff_below_min`)
6. **LTV** — Payoff / MarketCheck value exceeds `maxLtv[creditBand]` → disqualified (`ltv_too_high`)
7. **Credit + co-app** — Poor band + no co-app → disqualified (`credit_requires_coapp`)
8. **Employment + credit** — Restricted combo → disqualified (`employment_and_credit`)
9. **Income** — Below `minAnnualIncome` → disqualified (`income_below_min`)
10. **Consent** — Missing → disqualified (`no_consent`)
11. **Routing** — 580–669 → Savings Group (offers). 670+ w/SSN → Gravity (pre-approved). No SSN → Savings Group.

All thresholds are configurable via the Org Config JSON in the Dev Panel.

---

## Form State

The full form state is defined in `emptyForm()` inside the main component. Key field groups:

```
Vehicle:     vin, year, make, model, trim, mileage, condition
Applicant:   firstName, lastName, phone, email
Loan:        ownership, lender, monthlyPayment, payoff
Credit:      creditBand
Co-app:      hasCoApplicant, coAppFirst, coAppLast, coAppPhone, etc.
Housing:     address, city, state, zip, ownRent, moveInDate, housingPayment
Employment:  employer, employmentType, income, startDate
Identity:    dob, ssn, consentConfirmed
Valuation:   valuationMarketCheckPrice, valuationRetailPrice
Protection:  planSold, selectedPlanId, smsSent
Insurance:   insuranceReviewed, insuranceSavingsFound, insuranceMonthlySavings, insuranceSmsSent
```

---

## API Integrations

| API | Purpose | Auth |
|-----|---------|------|
| VinAudit Specifications | VIN decode → Year/Make/Model/Trim | API key (query param) |
| MarketCheck | Vehicle valuation (price by VIN+miles+zip) | API key (header) |
| Google Places (New) | Street address autocomplete | API key (header) |
| Zippopotam.us | ZIP → City/State lookup | None (free) |

All external fetches use a CORS proxy cascade: direct → allorigins.win → corsproxy.io → VIN cache fallback.

---

## Dev Panel Controls

| Control | Effect |
|---------|--------|
| Force partner | Override routing: Auto / Gravity / Savings Group / None |
| Force result | Override result: Auto / Pre-approved / Offers / Disqualified / Pending |
| Disqual reason | When disqualified, which reason code to show |
| SSN provided | Yes/No — affects Gravity eligibility |
| Co-applicant | Auto / Yes / No — override co-app decision |
| Protection plan sold | Yes → hides coverage teaser. No → shows it. |
| Insurance reviewed | Yes → hides insurance teaser. No → shows it. |
| Insurance savings found | Yes → shows savings card + adjusts plan prices. No → hides. |
| Jump to screen | Direct navigation to any screen in the flow |
| Vehicle JSON prefill | Paste a JSON payload to pre-fill vehicle + applicant data |
| Org Config | Edit decision engine thresholds as JSON |

---

## Reference Component Split (src/)

The `src/` directory contains a reference split of the monolithic prototype into proper modules. This is intended as a starting-point architecture for production — it shows how to organize the code but may need import fixes before it compiles independently.

```
src/constants/   — Static data (YMMT, lenders, mock data, screen sequence)
src/utils/       — API integrations, validation helpers
src/hooks/       — Form state management
src/components/  — Shared UI (TopBar, WizardShell, FormFields, DevPanel)
src/screens/     — Wizard step components (13 screens)
src/results/     — Stage 2 result components (8 cards)
```

---

## Production Roadmap

1. **Replace Tailwind CDN** with PostCSS + Tailwind build
2. **Move API keys** to server-side env vars (never expose in client bundle)
3. **Replace mock data** with real API calls:
   - `MOCK_OFFERS` → Savings Group API
   - `MOCK_PROTECTION_PLANS` → Blinker Coverage Quoting API
   - `MOCK_INSURANCE_QUOTES` / `MOCK_INSURANCE_SAVINGS` → Canopy Connect + Insurance Quoting API
4. **Split the single file** into proper component modules (reference architecture in `src/`)
5. **Add TypeScript** — the form state and decision types are well-defined and ready for interfaces
6. **Add error boundaries** and loading states for production resilience
7. **Replace the Dev Panel** with real CRM integration for form prefill
8. **Wire SMS sends** to actual messaging service (Twilio, etc.)
9. **Add unit tests** — the decision engine logic is pure functions, easy to test
