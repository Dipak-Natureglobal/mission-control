# utils/ — backlog

3-strikes rule: only lift when 2+ apps already duplicate. The Wave 15b audit will produce the ranked list.

## Likely first lifts (already 2+ consumers today)

- [ ] **validators** — `isValidEmail`, `isValidUSPhone10`, `isValidZip5`, `normalizePhoneE164`, `normalizeZip5`. Source: `mission-control/src/lib/contact-form.js`. Used by AddContactModal today; PhoneInput + EmailInput will share. Lift in Wave 15d-adjacent (15e blocked on this).
- [ ] **email-format** — typo dictionary (gmal.com → gmail.com, 30 entries) + placeholder-prefix pattern + placeholder-domain list. Source: `BlinkerLegacy/blinker/app/validators/email_format_validator.rb` (Ruby, port to JS). Used by `packages/components/EmailInput` AND `packages/integrations/email_verification` (the integration may run a quick local check before billing the API call).

## Other candidates (validate via 15b audit)

- [ ] protection-pricing math (PMT/ELIR/etc) — `protection-portal/src/lib/protection-pricing.js`
- [ ] status-mapping resolver — `mission-control/src/lib/status-mapping.js`
- [ ] plan-selector — `protection-portal/src/lib/plan-selector.js`
- [ ] marketcheck mock — `protection-portal/src/lib/marketcheck.js` (used by VehicleDrive)
- [ ] formatters (currency, date, phone-display) — scattered helpers across apps

## Anti-pattern to avoid

Do NOT lift one-off helpers that have a single consumer today. The 3-strikes rule is real — premature lifting forces churn when the second consumer's needs reshape the API.
