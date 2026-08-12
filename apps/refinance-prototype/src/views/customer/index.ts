// Public surface for refi-portal's customer view — the embed contract
// per ~/Documents/Claude/Projects/blinker-platform/architecture/02-integration-boundaries.md.
//
// Consumers (today: protection-portal § 1.5d via file:../refi-portal)
// import named exports from THIS file ONLY. Importing from any deeper
// path (e.g., src/views/customer/CustomerView.jsx, RefiWizard.jsx, or
// any individual screen) is contract violation.
//
// Embed-contract reminders:
//   - Every public component accepts { persona, personaLocked }.
//     Today the props are forward-compat scaffolding (the components
//     don't yet branch on them); accept them anyway so the contract
//     doesn't change when copy variants land.
//   - personaLocked=true means DON'T render a persona switcher; parent
//     owns the switch. None of these three components render a
//     switcher today, so the flag is informational.
//   - Public lib hooks/pure-logic live at src/lib/refi.js (also a
//     public surface; not exported here — consumers import directly
//     from src/lib/refi.js).
//   - Fixtures (src/constants/mock-data.js) are private to this app —
//     readable by this app's components but NOT cross-app. If
//     protection-portal needs MOCK_OFFERS for fixture work, they
//     should mint their own.
//   - CustomerView, RefiWizard, individual screens, and the heavyweight
//     src/results/* variants are deliberately NOT exported. Those are
//     internal and may shift across § 1.5e/f/g — exporting them would
//     make refactor across the seam a breaking change for
//     protection-portal.
//
// Available public exports (all accept `persona` + `personaLocked`):
//
//   RefiSubFlow       — step-by-step wizard wrapper for cross-sell hosts.
//                       Wraps RefiWizard with applicant + co-applicant
//                       prefill and a configurable startStep (default
//                       's1_ownership' so the wizard skips vehicle_add /
//                       vehicle_drive when the host already has those).
//                       Use this when the host wants the consumer to
//                       walk through the canonical refi screens to
//                       confirm + extend pre-filled data; results land
//                       via onComplete with the SAME payload shape as
//                       PrequalForm so QualifiedCard / OffersCard /
//                       DisqualifiedCard / PendingCard render unchanged.
//                       Co-applicant prefill flips form.hasCoApplicant
//                       so s1_co_app_decision lands with the answer
//                       pre-selected.
//   PrequalForm       — slim single-page condensed prequal form. Use
//                       this when the host prefers the legacy mini-
//                       capture pattern (single scroll of applicant +
//                       employment + housing). Runs useRefiPrequal,
//                       hands the decision back via onComplete with the
//                       same payload shape as RefiSubFlow.
//   OffersCard        — embed-friendly best-offer + per-offer rows card.
//                       Lifted from prototype EmbeddedPost (offers_returned
//                       branch).
//   QualifiedCard     — embed-friendly pre-approved handoff card. Lifted
//                       from prototype EmbeddedPost (pre_approved branch).
//   DisqualifiedCard  — embed-friendly "you don't qualify, here's why"
//                       terminal card. Lifted from prototype EmbeddedPost
//                       (disqualified branch). Accepts a `reason` key from
//                       DISQUAL_REASONS (matches `decision.reason` shape
//                       from runDecision()).
//   PendingCard       — embed-friendly "awaiting partner response" card.
//                       Lifted from prototype EmbeddedPost (pending
//                       branch). For async-submit partners (e.g. Gravity
//                       warm transfer) where the decision lands later.
//   VehicleAdd        — VIN OR manual YMMT entry with mismatch
//                       confirmation modal. Verified monolith signature:
//                       `function ScreenVehicleAdd({ form, update, onNext })`.
//                       `form` is the wizard form slice (reads
//                       form.vin / year / make / model / trim plus
//                       VIN-decode bookkeeping fields:
//                       vinDecoded, vinDecodeLoading, vinDecodeError,
//                       _lastDecodedVin); `update(patch)` shallow-merges
//                       into that slice (matches useForm's update
//                       contract); `onNext()` is the Continue handler.
//                       Used by mission-control for contact-level
//                       vehicle add (and any other embedder that needs
//                       the canonical refi vehicle-entry UX). No
//                       context-provider dependency — all monolith
//                       helpers (Field, PickerField, YmmtPicker,
//                       ScreenHeader, Footer, validators,
//                       fetchVinDecode, YMMT_DATA) resolve internally
//                       to refinance-v2-prototype.jsx.
//   VehicleDrive      — Mileage + condition (New/Used) + purchase-date
//                       capture with computed annual-miles estimate.
//                       Verified monolith signature:
//                       `function ScreenVehicleDrive({ form, update, onNext, nextLabel })`.
//                       `form` is the wizard form slice (reads
//                       form.mileage / condition / purchaseDate / year /
//                       vin / zip plus MarketCheck valuation fields:
//                       valuationLoading, valuationError,
//                       valuationMarketCheckPrice, valuationRetailPrice);
//                       `update(patch)` shallow-merges into that slice;
//                       `onNext()` is the Continue handler.
//                       Optional `nextLabel` (string) overrides the
//                       footer Continue button text — defaults to
//                       "Add Vehicle" (the refi-canonical copy).
//                       Embedders rendering this screen inside a
//                       different workflow (e.g. protection-portal
//                       passes "See coverage options") should set their
//                       own label so footer copy matches the host flow.
//                       The shared mileage view used across protection /
//                       refi / insurance workflows (per
//                       architecture/02-integration-boundaries.md). No
//                       context-provider dependency — all monolith
//                       helpers (ScreenHeader, Footer, fetchMarketCheckPrice,
//                       MARKETCHECK_DEFAULT_ZIP) resolve internally to
//                       refinance-v2-prototype.jsx. Embedders should
//                       seed form.mileage (number) and form.condition
//                       ("New" | "Used"); form.purchaseDate is captured
//                       in-screen when condition === "Used".
//
// Together, PrequalForm.onComplete(decision) returns one of four
// `decision.result` values — pre_approved / offers_returned /
// disqualified / pending — and consumers have a 1:1 public component
// for every branch (QualifiedCard / OffersCard / DisqualifiedCard /
// PendingCard respectively).
//
// onComplete payload shape (always passed):
//   { partner, partnerName, partnerPhone, result, reason, ruleId,
//     log, externalApplicationId, valuation, offers }
//   - `offers` is the array OffersCard expects. Populated when
//     result === 'offers_returned'; an empty [] for the other three
//     branches. Always present so embedders can render OffersCard
//     without synthesizing placeholders.
export { RefiSubFlow } from './RefiSubFlow';
export { PrequalForm } from './PrequalForm';
export { OffersCard } from './OffersCard';
export { QualifiedCard } from './QualifiedCard';
export { DisqualifiedCard } from './DisqualifiedCard';
export { PendingCard } from './PendingCard';
export { VehicleAdd } from './VehicleAdd';
export { VehicleDrive } from './VehicleDrive';
