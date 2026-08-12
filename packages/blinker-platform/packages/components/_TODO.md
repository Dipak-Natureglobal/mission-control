# components/ — Wave 15 backlog

## Wave 15c — lift current shared trio from refi-portal

Source: `refi-portal/src/components/{AddressBlock,NotesPanel,TagPicker}.jsx` + their public-surface index at `refi-portal/src/components/index.js:1-267`.

- Lift `AddressBlock.jsx` verbatim. Component-scoped Google Places fetch + zippopotam.us ZIP lookup + ZIP_FALLBACK table all come along.
- Lift `NotesPanel.jsx` verbatim. Lifted-state contract preserved.
- Lift `TagPicker.jsx` verbatim. Role-gated permissions stay parent-derived.
- Port full per-component JSDoc blocks from `refi-portal/src/components/index.js:46-266` into `index.js` here, replacing the scaffold-era summaries.
- Sweep child-app imports: `'refi-portal/src/components'` → `'blinker-platform/components'`. Five repos: mission-control, protection-portal, insurance-portal, refi-portal (it consumes its own components), customer-portal (when it lands).
- Remove `refi-portal/src/components/index.js` shared exports (keep refi's app-internal components in place: DevPanel, EmbeddedEntry, FormFields, JsonPeek, Stage2Shell, TopBar, WizardShell — those stay private to refi).
- Drop `protection-portal/vite.config.js` `refiConstantsBarrelShim` plugin if the upstream `src/constants/index.js` half-fix is no longer needed once the components import path stops crossing through refi-portal.

## Wave 15e — new shared inputs

- `PhoneInput.jsx` — format normalizer (already exists in `mission-control/src/lib/contact-form.js::normalizePhoneE164`; lift to `blinker-platform/utils` first if multiple consumers); 10-digit US validator; debounced blur-fire to `blinker-platform/integrations/sms_lookup::lookupPhoneCarrier`; verified/unverified pill; per-org policy read from canon org-registry `contact_validation` block.
- `EmailInput.jsx` — regex format check; typo dictionary (lift from `BlinkerLegacy/blinker/app/validators/email_format_validator.rb` — 30 entries); placeholder-prefix detection; debounced blur-fire to `blinker-platform/integrations/email_verification::verifyEmail`; same pill + policy treatment.

## Beyond Wave 15

- Lift `protection-portal/src/components/PlanCard.jsx` if a second consumer surfaces.
- Consider extracting modal shell + Field primitive if 3+ apps duplicate (audit in 15b).
- Design tokens / theming pass when customer-portal re-skin work begins.
