# 09 — Protection-Plan Billing Config

## Premise

Protection-portal's agent-facing billing UX (Confirm + BillingPayment + ThankYou) needs configurable per-org behavior for: discount caps, down-payment range, first-payment-date strategy, months-to-pay options, dealer markup, and disclosure copy. This file documents the canon shape, the legacy mapping, and the five locked decisions made 2026-05-04.

Companion canon files:
- `canon/org-registry.json` → `protection_billing` per-org block
- `canon/org-disclaimers.json` → TCPA + e-sign + payment-auth copy with `defaults` and `by_org` axes

## Locked decisions (2026-05-04)

1. **Months-to-pay options** — Canon stores the legacy Ruby constant `[1, 6, 12, 18, 24]` as `payment_term.options_months` (1 = pay-in-full). Default = `12`. Per-org canon may subset; new values are NOT introducible without a Ruby + canon change because the legacy `ProductPackage::PAYMENT_COUNT_OPTIONS` constant gates server-side validation.
2. **First payment date default** — Canon stores `default_strategy: "first_of_next_month"` (prototype UX) clamped to the `min_days_from_today` (31) / `max_days_from_today` (45) window. The clamp is the consumer's responsibility — when the strategy resolves to a date below the floor (e.g., the 25th of a month → "first of next month" is 6 days away), the BillingPayment screen advances forward to the floor. Documented inline at the consumer.
3. **Markup system** — Two parallel systems exist in legacy: column-based dollars (`$2700` default / `$2550` FL) used by MissionControl agent UI; JSONB percent (`0.15` / `0.20` FL) used by partner public quote pages. Canon picks **dollars** for the agent rewrite. The percent variant is intentionally NOT mirrored in canon — the customer-portal partner-quote rewrite (post-Phase-1.5) decides whether to add it.
4. **FL discount-disable is canon-driven** — `discount.disabled_in_states: ["FL"]`. Future state expansion is a canon edit, not a code change. Replaces hardcoded check in `MissionControl/src/features/refiApp/productsForm.tsx:89`.
5. **Down-payment 75% cap is canon-driven** — `down_payment.max_percent_of_total: 75`. Replaces the hardcoded validation in `BlinkerLegacy/blinker/app/models/product_option.rb:30-34` mirrored client-side at `paymentOptions.tsx:156`.

## Canon → legacy column mapping

| Canon path | Legacy source | Default |
|---|---|---|
| `protection_billing.discount.max_percent` | `configurations.profit_discount_percent` | 20 |
| `protection_billing.discount.max_dollars` | `configurations.profit_discount_max` | 540.00 |
| `protection_billing.discount.disabled_in_states` | hardcoded `["FL"]` in MC | `["FL"]` |
| `protection_billing.down_payment.default_percent` | `configurations.down_payment_percent_min` | 10 |
| `protection_billing.down_payment.min_percent` | `configurations.down_payment_percent_min` | 10 |
| `protection_billing.down_payment.max_percent_of_total` | hardcoded `75` (`product_option.rb:30-34`) | 75 |
| `protection_billing.first_payment_date.min_days_from_today` | `configurations.first_payment_min_days` | 31 |
| `protection_billing.first_payment_date.max_days_from_today` | `configurations.first_payment_max_days` | 45 |
| `protection_billing.payment_term.options_months` | `ProductPackage::PAYMENT_COUNT_OPTIONS` constant | `[1, 6, 12, 18, 24]` |
| `protection_billing.markup.default_dollars` | `configurations.profit_markup_default` | 2700.00 |
| `protection_billing.markup.florida_dollars` | `configurations.profit_markup_florida` | 2550.00 |

## Inheritance + override pattern

**1 Configuration per Organization, no cascade.** Confirmed against legacy `Organization belongs_to :configuration` (1:1) and the recent `parent_organization_id` migration (`20251204152138`) which adds the hierarchy WITHOUT cascading config values. Children orgs need their own configuration row at provisioning time. Matches the platform's locked "1 config per org / copy-down" decision verbatim.

Canon mirrors this: every org has a fully-populated `protection_billing` block with the legacy defaults inline. Per-org overrides land as canon edits when product confirms them.

## Implementation notes for Wave 7 (billing rewrite consumer)

- Read pattern: `orgRegistry.orgs.find(o => o.id === orgId)?.protection_billing` — caller is responsible for null-safety if the org isn't recognized.
- Discount clamp: enforce BOTH `max_percent` AND `max_dollars` simultaneously; whichever is reached first wins. Canonical bidirectional clamp lives in `MissionControl/src/features/refiApp/productsForm.tsx:230-326` — consult before re-implementing.
- First-payment-date clamp: when `default_strategy === "first_of_next_month"` resolves to fewer than `min_days_from_today` days, advance to today + min_days. Document the clamp at the consumer.
- Pay-in-full edge case: when `payment_count === 1`, legacy resets `first_payment_date` to `original_first_payment_date` (`packages_controller.rb:53`). Preserve this behavior — the agent's date pick is forgotten when they flip to pay-in-full.
- TCPA copy: `orgDisclaimers.by_org[orgId]?.tcpa_consent?.[locale] ?? orgDisclaimers.defaults.tcpa_consent[locale]`. `{{ORG_NAME}}` placeholder is interpolated at render time.

## Legacy file pointers (read-only canonical sources)

- `BlinkerLegacy/blinker/app/models/configuration.rb` — schema + CATEGORIES grouping + validations
- `BlinkerLegacy/blinker/app/models/product_package.rb` — `PAYMENT_COUNT_OPTIONS` (line 37), `PercentageDiscount`/`AbsoluteDiscount` (152-188), `final_price`/`monthly_payment`/`calculate_due_today` (195-218)
- `BlinkerLegacy/blinker/app/models/product_option.rb:30-34` — 75% down-payment validation
- `BlinkerLegacy/blinker/app/controllers/packages_controller.rb:38-99` — full agent payment flow (update_payment_option, payment_date, update_payment_date, confirm, submit_confirm)
- `BlinkerLegacy/blinker/app/views/packages/payment_date.html.erb:65` — exact range copy: "your payment date must be between {min} and {max} days from today"
- `BlinkerLegacy/blinker/app/helpers/application_helper.rb:80-108` — `format_monthly_payment` reference math (markup → down → finance → divide-by-term)
- `BlinkerLegacy/blinker/app/views/partner/quote/contact.html.erb:114-143` — TCPA fallback copy (verbatim)
- `BlinkerLegacy/MissionControl/src/features/refiApp/coverages/paymentOptions.tsx:84-214` — agent payment widget (down-pmt entry, calendar wiring, paymentLimits.max, finalizePurchaseParams shape)
- `BlinkerLegacy/MissionControl/src/features/refiApp/productsForm.tsx:80-101, 125-126, 230-326` — discount state + bidirectional %/$ clamp + FL disable
- `BlinkerLegacy/MissionControl/src/helpers/calculateProductPricing.ts` — canonical "discount applies only to base, never to surcharges" math

## Open questions (carried forward as canon `_TODO`)

- Apex 102 protection_billing values are legacy-column-defaults, NOT extracted from a specific Configuration row — confirm with product before production.
- `PAYMENT_COUNT_OPTIONS` is a Ruby constant today, not per-org; canon allows subset but production may want to centralize the constant in canon and remove from app code.
- E-sign + payment-authorization disclaimer copy is `_TODO` placeholder — extract from legacy templates.
- Phase 2 swap is `await blinkerApi.orgs.get(orgId)` returning the same shape per `architecture/07-data-layer.md`.
