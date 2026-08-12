# Wave 20 — Org Configuration Research

**Purpose:** Feed the Wave 20 v3-B build agent with a complete picture of legacy data, current canon coverage, and the proposed v3.0.3 hierarchical org-config structure. The next agent (v3-B) will use this as its primary design input to replace the current 4-tab `OrgRegistry.jsx` dialog with a richer, bucketed editor.

**Consumed by:** Wave 20 v3-B build agent (mission-control org-config editor).

---

## 1. Legacy `Configuration` Model — Column Inventory

Source: `BlinkerLegacy/blinker/app/models/configuration.rb` (schema comment) + `schema-in-use.dbml` table `blinker.configurations`.

The legacy `configurations` table has **one row per "configuration name"**; organizations reference it via `configurations.id` FK on the organizations table (many-to-one in legacy — multiple orgs can share a config, e.g., AAA-RCO, AAA-BUSA). The rewrite breaks this to 1:1 (one config per org, copy-down).

| Column | Type | Default | Purpose | v3 Bucket |
|---|---|---|---|---|
| `id` | integer PK | — | Identity | — |
| `periods_per_year` | integer | null | Amortization periods (12 for monthly) | opp_refi |
| `min_monthly_payment` | decimal(10,2) | null | Floor on refi monthly payment | opp_refi |
| `max_monthly_payment` | decimal(10,2) | null | Ceiling on refi monthly payment | opp_refi |
| `offer_amount_step` | decimal(10,2) | null | Refi offer slider step size | opp_refi |
| `offer_amount_additional_percent_under` | integer | null | % under asking price allowed | opp_refi |
| `offer_amount_additional_percent_over` | integer | null | % over asking price allowed | opp_refi |
| `monthly_payment_step` | decimal(10,2) | null | Refi payment slider step size | opp_refi |
| `asking_price_step` | decimal(10,2) | null | Vehicle asking price slider step | opp_refi |
| `asking_price_percent_under` | integer | null | Asking price floor band | opp_refi |
| `asking_price_percent_over` | integer | null | Asking price ceiling band | opp_refi |
| `estimated_payment_tier` | integer | null | T1 buydown tier (1–5) | opp_refi |
| `estimated_payment_down_pct` | integer | null | % down used to derive estimated APR via T1_BUYDOWN_MATRIX | opp_refi |
| `estimated_payment_term` | integer | null | Default term for estimated payment display | opp_refi |
| `down_payment_percent_default` | integer | null | Default down-payment % for protection billing | opp_protection |
| `down_payment_percent_min` | integer | 10 | Minimum down-payment % for protection billing | opp_protection |
| `down_payment_step` | decimal(10,2) | null | Down-payment slider step size | opp_protection |
| `min_term` | integer | not null | Minimum refi loan term (months) | opp_refi |
| `max_term` | integer | null | Maximum refi loan term (months) | opp_refi |
| `max_vehicle_age` | integer | null | Refi eligibility: max vehicle age in years | opp_refi |
| `max_vehicle_mileage` | integer | null | Refi eligibility: max mileage | opp_refi |
| `max_min_amount_financed` | decimal(10,2) | null | Max-of-minimum amount that can be financed | opp_refi |
| `faq_url` | varchar(255) | null | FAQ page URL shown to consumers | system |
| `feedback_email` | varchar(255) | null | Feedback recipient email | system |
| `info_email` | varchar(255) | null | General info email | system |
| `support_email` | varchar(255) | null | Support team email | system |
| `support_phone` | varchar(255) | null | Support phone (required with validation) | system |
| `support_hours_text` | text | null | Human-readable support hours copy | system |
| `min_android_app` | varchar(255) | null | Minimum required Android app version | system |
| `min_ios_app` | varchar(255) | null | Minimum required iOS app version | system |
| `min_ios_os` | varchar(255) | null | Minimum required iOS OS version | system |
| `app_store_id` | varchar(255) | null | Apple App Store ID | system |
| `app_store_url` | varchar | null | App Store URL | system |
| `android_upgrade_reason` | text | null | Copy shown when Android upgrade required | system |
| `ios_upgrade_reason` | text | null | Copy shown when iOS upgrade required | system |
| `android_cpr_enabled` | boolean | null | Android CPR feature flag | system |
| `refi_cash_back_step` | decimal(10,2) | null | Refi cash-back slider step | opp_refi |
| `refi_min_cash_back` | decimal(10,2) | null | Minimum cash-back to show as refi benefit | opp_refi |
| `refi_min_pmt_diff` | decimal(10,2) | null | Minimum payment-savings threshold for refi offer | opp_refi |
| `profit_markup_default` | decimal(10,2) | 2700.00 | Protection plan markup (non-FL) in dollars | opp_protection |
| `profit_markup_florida` | integer | 2450 | Protection plan markup in FL (DBML says 2450; Ruby default is 2550.00 — DBML may lag) | opp_protection |
| `profit_discount_max` | decimal(10,2) | 540.00 | Agent discount hard cap in dollars | opp_protection |
| `profit_discount_percent` | integer | 20 | Agent discount hard cap as percent | opp_protection |
| `validation_discount_max` | decimal(10,2) | 0.00 | Secondary validation discount cap (purpose unclear — not in Ruby schema comment) | opp_protection |
| `filters` | jsonb | `{}` | Product package filter rules | opp_protection |
| `addons` | jsonb | `[]` | Add-on product definitions | opp_protection |
| `required_addons` | jsonb | `[]` | Required add-ons per package | opp_protection |
| `call_center_name` | varchar | null | Display name of call center | system |
| `call_center_logo_path` | varchar | null | S3 path for call center logo image | system |
| `call_center_link` | varchar | null | URL for the call center | system |
| `call_center_code` | varchar | `'AMR2'` | Short code for the call center | system |
| `call_center_lienholder_default` | varchar | `'EFS'` | Default lienholder for EFS paylink | payments |
| `test_mode` | boolean | false | Broad-switch: routes all supporting integrations to sandbox | system |
| `payment_services` | jsonb | not null | Structured blob for FluidPay + Ensurety + FloPay credentials (test/live split) | integrations |
| `timezone` | varchar(255) | `'UTC'` | IANA timezone string for the org | system |
| `ghl_webhook_secret` | varchar | null | HMAC secret for GHL inbound webhooks | integrations |
| `ghl_api_key` | varchar | null | GHL location-scoped API key | integrations |
| `ghl_configuration` | jsonb | `{}` | GHL field/pipeline mapping overrides (GIN-indexed) | integrations |
| `calltools_api_key` | varchar | null | CallTools API key (legacy CRM; likely dead) | integrations |
| `plan_settings` | jsonb | `{}` | Protection plan settings JSONB (GIN-indexed; contains `profit_markup_default` percent variant + `payment_term_public_default` used by partner quote pages) | opp_protection |
| `sms_daily_fail_limit` | integer | 10 | Max daily SMS failures before auto-pause | integrations |
| `first_payment_min_days` | integer | 31 | Minimum days until first protection plan payment | opp_protection |
| `first_payment_max_days` | integer | 45 | Maximum days until first protection plan payment | opp_protection |
| `external_api_key` | varchar | null | External API key (likely for a partner API surface) | integrations |
| `payment_confirmation` | boolean | false | Require explicit payment confirmation step | payments |
| `default_owner_id` | bigint FK | null | Default agent assigned to new leads | system |
| `created_at` / `updated_at` | timestamp | — | Rails standard timestamps | — |

**Total legacy `configurations` columns:** ~57 (excluding PK + timestamps).

The Ruby model also defines a `CATEGORIES` grouping (`android`, `ios`, `loan`, `profit`, `support`, `system`, `packages`, `call_center`, `payment_services`) and the `T1_BUYDOWN_MATRIX` (APR lookup by down-payment percent for estimated payment display). Several virtual/delegate fields exist: `buy_active_states`, `sell_active_states`, `refi_active_states`, `refi_keep_co_owner_states`, `feature_flags` (all delegated to the global `Blinker` object — they are NOT per-org columns).

---

## 2. Legacy `Organization` Model — Column Inventory

Source: `BlinkerLegacy/blinker/app/models/organization.rb` + `schema-in-use.dbml` table `blinker.organizations`.

| Column | Type | Default | Purpose | v3 Bucket |
|---|---|---|---|---|
| `id` | bigint PK | — | Identity | — |
| `code` | varchar | not null, unique | Short org code (e.g., "APEX", "AAA-RCO") | system |
| `name_legal` | varchar | not null | Legal name of the organization | system |
| `name_dba` | varchar | null | Doing-business-as name | system |
| `contact_email` | varchar | null | Primary contact email for the org | system |
| `contact_phone` | varchar | null | Primary contact phone | system |
| `address_id` | bigint FK | not null | FK → `blinker.addresses.id` | system |
| `configuration_id` | bigint FK | not null | FK → `blinker.configurations.id` (many orgs → one config in legacy; 1:1 in rewrite) | — |
| `external_provider_account_id` | bigint FK | null | FK → external provider (e.g., Ensurety account) | integrations |
| `parent_organization_id` | bigint FK | null | Self-referential: parent org (hierarchy) | system |
| `ghl_location_id` | varchar | null, unique | GHL sub-account location ID | integrations |
| `created_at` / `updated_at` | timestamp | — | Rails standard timestamps | — |

**Key associations:**
- `belongs_to :address` — physical address for the org (used in agreements, support contact)
- `belongs_to :configuration` — the per-org config record
- `belongs_to :external_provider_account, optional: true` — ties an org to a specific Ensurety/payment account
- `belongs_to :parent_organization, optional: true` + `has_many :child_organizations` — explicit hierarchy
- `has_many :organization_partner_sessions` — tracks partner portal quote sessions (step-enum: vehicle/mileage/contact/qualification/qualification_mods/plans/capture_name/final_step/completed)
- `has_many :organization_users` — many-to-many with `users` (via `organization_users` join table: `user_id`, `organization_id`, uniqueness constraint + email+phone uniqueness within org)
- Delegates `test_mode`, `ghl_api_key`, `ghl_webhook_secret`, `external_api_key` → configuration (these are on the config record but accessed via the org)

**`organization_users` join table columns:** `id`, `user_id`, `organization_id`, `created_at`, `updated_at`. Validates uniqueness of `(user_id, organization_id)` and uniqueness of email+phone within org.

**`organization_partner_sessions` notable shape:** `organization_id`, `user_id?`, `product_package_id?`, `vehicle_id?`, `session_token_digest`, step enum (0=vehicle → 8=completed). This drives the consumer self-serve portal flow.

---

## 3. Current Canon Coverage — Gaps

### What canon already covers (well)

| Domain | Canon source | Coverage |
|---|---|---|
| Org identity + hierarchy | `org-registry.json` → `id`, `name`, `type`, `status`, `parent_org_id`, `timezone`, `test_mode`, `users_count`, `ghl_location_id` | Good |
| Integration credentials shape | `integrations.json` — all 13 providers with field schemas, test/live splits, sensitivity flags | Comprehensive |
| Per-org integration enablement | `org-registry.json` → `integrations.<provider>.{enabled, status, credentials}` | Good (Apex 102 fully seeded) |
| Protection plan billing | `org-registry.json` → `protection_billing` block (`discount`, `down_payment`, `first_payment_date`, `payment_term`, `markup`) | Well covered; confirmed against legacy columns |
| Cross-sell / refi financing | `org-registry.json` → `cross_sell` (`insurance_enabled`, `refi_enabled`, `protection_plan_financing`) | Good |
| Vehicle defaults | `org-registry.json` → `vehicle_defaults.annual_mileage_estimate` | Thin but functional for Phase 1 |
| Personas + badge permissions | `personas.json` + `badges.json` | Comprehensive |

### Gaps — fields in legacy NOT yet in canon

| Legacy column | Gap type | Notes |
|---|---|---|
| `support_phone`, `support_email`, `info_email`, `feedback_email`, `faq_url`, `support_hours_text` | Missing | Support contact info not in canon. Needed for consumer-facing copy and the system settings editor. |
| `call_center_name`, `call_center_logo_path`, `call_center_link`, `call_center_code`, `call_center_lienholder_default` | Missing | Call-center branding block. `call_center_logo_path` is an S3 path with presigned-URL generation. |
| `name_dba`, `contact_email`, `contact_phone`, `address_id` | Missing | Org metadata (legal name + DBA are distinct; contact email/phone are org-level not config-level in legacy DBML) |
| `code` | Missing | The short org code (e.g., "APEX") — useful for API identifiers and display |
| `refi_cash_back_step`, `refi_min_cash_back`, `refi_min_pmt_diff` | Missing | Refi display thresholds — not yet in canon's `cross_sell` block |
| `estimated_payment_tier`, `estimated_payment_down_pct`, `estimated_payment_term`, `periods_per_year`, `min_term`, `max_term`, `min_monthly_payment`, `max_monthly_payment`, `offer_amount_step`, `offer_amount_additional_percent_under/over`, `monthly_payment_step`, `asking_price_step`, `asking_price_percent_under/over`, `max_vehicle_age`, `max_vehicle_mileage`, `max_min_amount_financed` | Missing | Full refi loan configuration parameters. The `cross_sell.protection_plan_financing` block only covers financing APR+term for protection cross-sells; the core refi slider/eligibility params are absent. |
| `filters`, `addons`, `required_addons` | Missing | Package-filter JSONB and add-on configs — complex; defer to Phase 2 |
| `plan_settings` | Missing | JSONB blob with `payment_term_public_default` (for partner quote pages) and percent-based markup variant. The percent-markup variant is intentionally excluded (per architecture/09 decision); `payment_term_public_default` is a gap if customer-portal needs it. |
| `validation_discount_max` | Missing | Secondary discount cap — purpose unclear; may be dead or overlap with `profit_discount_max` |
| `payment_confirmation` | Missing | Flag to require explicit payment confirmation step |
| `call_center_lienholder_default` | Missing | Default lienholder selection for EFS paylink |
| `android_cpr_enabled`, app version constraints | Missing | Mobile app gates — likely irrelevant to web rewrite; mark as legacy-only |
| `external_provider_account_id` | Missing | Links org to a specific external account record; likely absorbed into integrations block in v3 |
| `calltools_api_key` | Missing | Likely dead — CallTools is an older CRM; not in integrations.json registry |
| `ghl_configuration` jsonb | Partial | GHL field/pipeline mappings exist as `ref` fields in integrations.json but the actual per-org override JSONB structure is unspecified |
| `default_owner_id` | Missing | Auto-assign new leads to this user — not yet in canon |

### Naming drift

- Legacy `profit_markup_florida` default is **2450** in DBML but **2550** in Ruby model comment. Canon uses **2550**. Confirm actual prod value before shipping.
- Legacy has no `name` field on organizations — it uses `name_legal` + `name_dba`. Canon `org-registry.json` uses `name` (which appears to be `name_dba` or a combined display name). Clarify canonical display name source.

---

## 4. Proposed v3.0.3 Hierarchical Bucket Structure

### 4.1 System

Org identity, branding, support contact, platform behavior switches.

| Field | Type | Phase 1 Default | Source | Rationale |
|---|---|---|---|---|
| `code` | string | org name slug | `organizations.code` | Short identifier for API + display |
| `name_legal` | string | required | `organizations.name_legal` | Legal entity name for agreements |
| `name_dba` | string | null | `organizations.name_dba` | Display name (may differ from legal) |
| `type` | enum: internal/parent/child | child | canon `org-registry.json` | Hierarchy role |
| `status` | enum: active/paused/unknown | paused | canon `org-registry.json` | Operational status |
| `parent_org_id` | integer? | null | `organizations.parent_organization_id` | Explicit hierarchy |
| `timezone` | string (IANA) | America/Chicago | `configurations.timezone` | Local time display for agents |
| `test_mode` | boolean | false | `configurations.test_mode` | Global sandbox switch |
| `contact_email` | string | null | `organizations.contact_email` | Org-level contact (not support@) |
| `contact_phone` | string | null | `organizations.contact_phone` | Org-level contact phone |
| `support_email` | string | null | `configurations.support_email` | Consumer-facing support |
| `support_phone` | string | null | `configurations.support_phone` | Consumer-facing support (required in legacy) |
| `info_email` | string | null | `configurations.info_email` | General info email |
| `feedback_email` | string | null | `configurations.feedback_email` | Feedback recipient |
| `faq_url` | string | null | `configurations.faq_url` | FAQ URL for consumer screens |
| `support_hours_text` | string | null | `configurations.support_hours_text` | Human-readable support hours |
| `default_owner_id` | integer? | null | `configurations.default_owner_id` | Auto-assign new leads to this agent |
| `call_center_name` | string | null | `configurations.call_center_name` | Branding: call center display name |
| `call_center_logo_path` | string | null | `configurations.call_center_logo_path` | S3 path; served via presigned URL |
| `call_center_link` | string | null | `configurations.call_center_link` | URL for call center portal |
| `call_center_code` | string | AMR2 | `configurations.call_center_code` | Short code used in EFS routing |

**Note on address:** `organizations.address_id` is a FK to the `addresses` table. In Phase 1, org address is read-only display data. Phase 2 editor should allow address update. Not a scalar field — omit from the flat system form; handle as an `AddressBlock` sub-section.

### 4.2 Contacts

Per-org rules governing how contacts are created, tagged, and managed. Most of these are new (not in legacy) — legacy had no per-org contact-policy config.

| Field | Type | Phase 1 Default | Source | Rationale |
|---|---|---|---|---|
| `tcpa_consent_copy` | string | (from `org-disclaimers.json`) | `canon/org-disclaimers.json` | TCPA copy injected at contact capture; `{{ORG_NAME}}` interpolated |
| `do_not_contact_policy` | enum: honor/ignore/prompt | honor | new | What happens when a contact is marked DNC |
| `dedup_match_fields` | string[] | [email, phone] | new | Fields used for deduplication match |
| `tag_presets` | string[] | [] | `canon/system-tags.json` | Per-org tag presets shown in TagPicker |
| `annual_mileage_estimate` | integer | 12000 | `org-registry.json` → `vehicle_defaults.annual_mileage_estimate` | Mileage slider seed for vehicle screens |

**Note:** Household clustering and contact-creation automation rules are post-Phase-1 concerns — mark as "Phase 2 suggested" in the UI.

### 4.3 Opportunities

Each workflow sub-bucket is independently toggled.

#### 4.3.1 Refinance

Covers refi eligibility gates, slider defaults, and cross-sell financing display.

| Field | Type | Phase 1 Default | Source | Rationale |
|---|---|---|---|---|
| `enabled` | boolean | false | canon `cross_sell.refi_enabled` | Gates the refi cross-sell CTA and workflow |
| `min_term` | integer | 12 | `configurations.min_term` | Minimum refi loan term in months |
| `max_term` | integer | 84 | `configurations.max_term` | Maximum refi loan term in months |
| `estimated_payment_term` | integer | 60 | `configurations.estimated_payment_term` | Default term for the payment estimator |
| `estimated_payment_down_pct` | integer | 0 | `configurations.estimated_payment_down_pct` | % down for T1 APR lookup (T1_BUYDOWN_MATRIX) |
| `min_monthly_payment` | decimal | 50.00 | `configurations.min_monthly_payment` | Floor on displayed monthly payment |
| `max_monthly_payment` | decimal | 2000.00 | `configurations.max_monthly_payment` | Ceiling on displayed monthly payment |
| `max_vehicle_age` | integer | 15 | `configurations.max_vehicle_age` | Eligibility: vehicle age cap (years) |
| `max_vehicle_mileage` | integer | 200000 | `configurations.max_vehicle_mileage` | Eligibility: mileage cap |
| `max_min_amount_financed` | decimal | 50000.00 | `configurations.max_min_amount_financed` | Max of minimum amount to finance |
| `refi_min_pmt_diff` | decimal | 50.00 | `configurations.refi_min_pmt_diff` | Min $ savings to surface refi offer |
| `refi_min_cash_back` | decimal | 500.00 | `configurations.refi_min_cash_back` | Min cash-back to surface as benefit |
| `protection_plan_financing` | object? | null | canon `cross_sell.protection_plan_financing` | APR + term range for protection plan financing cross-sell (only relevant when refi + protection both enabled) |
| `cross_sell_protection_enabled` | boolean | false | new | Enable protection cross-sell in refi flow |
| `cross_sell_insurance_enabled` | boolean | false | new | Enable insurance cross-sell in refi flow |

#### 4.3.2 Insurance

| Field | Type | Phase 1 Default | Source | Rationale |
|---|---|---|---|---|
| `enabled` | boolean | false | canon `cross_sell.insurance_enabled` | Gates "Find insurance savings" CTA |
| `quote_display_mode` | enum: summary/detailed | summary | new | How quotes are rendered in InsuranceQuoteCard |
| `partner_id_ref` | string | (from EI credentials) | integrations.embedded_insurance | Reference to the EI partner ID; read-only here — editable only in Integrations bucket |

**Note:** Insurance-specific config is thin in legacy (it was all ENV-var based). Most configurable behavior is in the EI integration credentials block (Section 4.5). The `enabled` toggle + display prefs are the main per-org levers.

#### 4.3.3 Protection

| Field | Type | Phase 1 Default | Source | Rationale |
|---|---|---|---|---|
| `enabled` | boolean | true | new (protection is the primary workflow) | Toggle the protection workflow |
| `discount.max_percent` | integer | 20 | `configurations.profit_discount_percent` | Agent discount cap in % |
| `discount.max_dollars` | decimal | 540.00 | `configurations.profit_discount_max` | Agent discount cap in $ |
| `discount.disabled_in_states` | string[] | ["FL"] | hardcoded in legacy MC | States where discount is completely disabled |
| `down_payment.default_percent` | integer | 10 | `configurations.down_payment_percent_min` | Default down-pmt % seeded in UI |
| `down_payment.min_percent` | integer | 10 | `configurations.down_payment_percent_min` | Minimum agent-selectable down % |
| `down_payment.max_percent_of_total` | integer | 75 | hardcoded in `product_option.rb:30-34` | Max down as % of total price |
| `first_payment_date.default_strategy` | enum: first_of_next_month/min_date | first_of_next_month | architecture/09 decision | How the default first-payment date is computed |
| `first_payment_date.min_days_from_today` | integer | 31 | `configurations.first_payment_min_days` | Earliest first-payment date |
| `first_payment_date.max_days_from_today` | integer | 45 | `configurations.first_payment_max_days` | Latest first-payment date |
| `payment_term.options_months` | integer[] | [1,6,12,18,24] | `ProductPackage::PAYMENT_COUNT_OPTIONS` | Available payment terms; 1=pay-in-full |
| `payment_term.default_months` | integer | 12 | prototype decision | Default payment term shown to agent |
| `markup.default_dollars` | decimal | 2700.00 | `configurations.profit_markup_default` | Dealer markup outside FL |
| `markup.florida_dollars` | decimal | 2550.00 | `configurations.profit_markup_florida` | FL-specific markup (confirm vs DBML's 2450) |
| `plan_filters` | object | {} | `configurations.filters` | JSONB product-package filter rules; Phase 1 read-only display |
| `addons` | array | [] | `configurations.addons` | Add-on product definitions; Phase 1 read-only |
| `required_addons` | array | [] | `configurations.required_addons` | Required add-ons; Phase 1 read-only |
| `validation_discount_max` | decimal | 0.00 | `configurations.validation_discount_max` | Secondary validation cap — purpose TBD with product |

### 4.4 Payments

| Field | Type | Phase 1 Default | Source | Rationale |
|---|---|---|---|---|
| `primary_processor` | enum: fluidpay/authnet | fluidpay | new (integrations block implies FluidPay) | Which payment processor handles card charges |
| `lienholder_default` | string | EFS | `configurations.call_center_lienholder_default` | Default lienholder for EFS paylink routing |
| `payment_confirmation_required` | boolean | false | `configurations.payment_confirmation` | Require explicit agent confirmation step before charge |
| `processing_fee_percent` | decimal | 0.0 | new (legacy field not found; suggest) | Platform processing fee added to total |
| `refund_policy_days` | integer | 30 | new (legacy field not found; suggest) | Days within which refund is allowed |

**Note:** The `payment_services` JSONB on the legacy configuration is entirely absorbed into the Integrations bucket (per-provider credentials for FluidPay, Ensurety, FloPay). The payments bucket here covers policy and routing decisions, not credentials.

### 4.5 Integrations

This bucket references `canon/integrations.json` for the per-provider field schema. No duplication here.

Per-org integration state lives on the org record as `integrations.<provider_id>.{ enabled: bool, status: configured|missing|errored, credentials: { test: {...}, live: {...} } }`.

Provider registry (13 providers in `canon/integrations.json`): `ghl`, `fluidpay`, `ensurety`, `flopay`, `stoneeagle`, `express_aftermarket`, `embedded_insurance`, `docuseal`, `twilio`, `mandrill`, `zendesk`, `plaid`, `vinaudit`, `marketcheck`, `google_places`, `s3_storage`.

**Legacy fields absorbed into integrations block:**
- `configurations.ghl_api_key` → `integrations.ghl.credentials.api_key`
- `configurations.ghl_webhook_secret` → `integrations.ghl.credentials.webhook_secret`
- `configurations.ghl_configuration` → `integrations.ghl.credentials.pipeline_mappings` (or `field_mappings`)
- `configurations.payment_services` (FluidPay + Ensurety + FloPay nested JSONB) → individual `integrations.*` blocks
- `configurations.calltools_api_key` — **likely dead** (CallTools not in integrations.json); confirm with product
- `configurations.external_api_key` — purpose unclear; may be a partner-API surface key; flag for product clarification
- `configurations.sms_daily_fail_limit` → `integrations.twilio.credentials.{test,live}.daily_fail_limit` (already in integrations.json field schema)

---

## 5. Editor UX Recommendations

### 5.1 System bucket

**Render as:** Two-section flat form.
- Section A: Org identity (name_legal, name_dba, code, type, status, parent_org_id dropdown, timezone, address block as read-only display with "edit address" link in Phase 2).
- Section B: Support + branding (support_email, support_phone, info_email, feedback_email, faq_url, support_hours_text, call_center_name, call_center_logo upload, call_center_link, call_center_code).

**Validations:** `support_phone` required (legacy enforces via Rails validation). `timezone` must be in IANA list. `code` must be unique (check on save).

**Permission gates:**
- `name_legal`, `code`, `type`, `parent_org_id`: **super_admin only** — changing these has org-hierarchy implications.
- All other system fields: `admin` + `super_admin`.
- `address` edit: `admin` + `super_admin`.

**Confirmations:** Changing `parent_org_id` should show a modal: "Re-parenting this org will not change its existing configuration. Child orgs will remain independent."

**`test_mode`** is shown here as a toggle but must trigger the confirm modal (per `architecture/10-admin-console.md`) that lists every affected integration. The toggle requires `toggle_test_mode` badge. Render with a persistent amber banner on all screens when active.

### 5.2 Contacts bucket

**Render as:** Flat form with a TCPA copy preview card.
- `annual_mileage_estimate`: simple number input.
- `tcpa_consent_copy`: textarea with live preview + `{{ORG_NAME}}` interpolation hint.
- `do_not_contact_policy`: radio group.
- `dedup_match_fields`: checkbox group (email / phone / name+dob).
- `tag_presets`: TagPicker-style multi-select sourced from `system-tags.json`.

**Cross-cutting validation:** If `dedup_match_fields` is empty, warn but don't block.

**Permission gate:** `admin` + `super_admin`.

### 5.3 Opportunities bucket

**Render as:** Three-tab accordion or sub-tab row (Refinance / Insurance / Protection). Each tab starts with an `enabled` toggle that collapses/expands the tab's fields.

**Refinance tab:**
- `enabled` toggle at top.
- If enabled: numeric inputs for all refi loan parameters (min/max term, payment bounds, vehicle eligibility).
- Cross-cutting validation: `min_term` <= `max_term`; `min_monthly_payment` <= `max_monthly_payment`; `estimated_payment_term` within [min_term, max_term]; `refi_min_pmt_diff` > 0.
- `protection_plan_financing` sub-section: APR range inputs with validation `min_apr` <= `default_apr` <= `max_apr`; term range with same pattern.
- **Confirmation on disable:** "Disabling refi will hide the refi CTA from all agents at this org. Any in-flight refi opportunities will not be affected."

**Insurance tab:**
- `enabled` toggle.
- `quote_display_mode` radio.
- `partner_id_ref` as read-only display pill with link to Integrations → Embedded Insurance section.

**Protection tab:**
- `enabled` toggle (rare to disable — add tooltip: "Disabling removes the protection workflow from all agent sessions").
- Discount caps: two numeric inputs (% and $), rendered side-by-side. Note: both caps enforced simultaneously.
- `disabled_in_states`: multi-select state picker (defaults to FL).
- Down payment: three numeric inputs (default %, min %, max % of total).
- First payment date: `default_strategy` dropdown + two numeric inputs (min/max days). Show a hint: "When first_of_next_month falls within min_days, the screen clamps forward."
- Payment terms: checkbox group for `options_months` options (1, 6, 12, 18, 24) + default picker from selected options.
- Markup: two decimal inputs (default $ / Florida $).
- `plan_filters`, `addons`, `required_addons`: Phase 1 render as `JsonPeek` (read-only compact view) with "Edit via super-admin JSON panel" note.

**Permission gates:** `edit_org_config` badge (admin + super_admin). Markup and `disabled_in_states` changes: show an "are you sure?" confirm — these affect billing on every future transaction.

### 5.4 Payments bucket

**Render as:** Short flat form.
- `primary_processor`: enum dropdown (FluidPay / AuthNet).
- `lienholder_default`: text input with hint "Drives EFS paylink routing."
- `payment_confirmation_required`: checkbox.
- `processing_fee_percent`, `refund_policy_days`: numeric inputs (Phase 1 display-only if not in use).

**Confirmation on change:** Any change to `primary_processor` or `lienholder_default` requires a confirm modal: "Changing the payment processor will affect all future transactions on this org."

**Permission gate:** `configure_gateways` badge (admin + super_admin). `super_admin` only for processor changes.

### 5.5 Integrations bucket

**Render as:** Card grid (one card per provider, sourced from `canon/integrations.json`). Each card shows: provider label, category badge, enabled/disabled status pill, last_verified_at, a health indicator.

Clicking a card opens a per-provider **Edit drawer** with test/live tabs (where `env: ["test","live"]`). Sensitive fields masked by default; reveal button calls the reveal endpoint (super_admin only) or show the fixture value locally in Phase 1.

The `test_mode` toggle (on the System bucket) triggers a confirm modal that previews which providers will flip. This modal is generated from the `supports_test_mode: true` providers in `integrations.json`.

**Permission gate:** `edit_integrations` badge (admin) for credential updates; `view_integration_credentials` badge (super_admin) for reveals.

---

## 6. Open Questions for Product

1. **`profit_markup_florida` default discrepancy:** The DBML shows `default: 2450` but the Ruby model comment shows `2550.00` and canon uses `2550.00`. These are different values. Which is correct for current production? This affects the agent billing UI directly. **Confirm against a live Apex 102 configuration row before shipping.**

2. **`validation_discount_max` purpose:** The DBML has a `validation_discount_max decimal [not null, default: 0.0]` column not reflected in the Ruby schema comment or any canon file. Is this a secondary enforcement cap that runs after `profit_discount_max`, or is it legacy-dead? If live, what is its relationship to `profit_discount_max`? Without clarification, the v3-B editor should display it as read-only.

3. **`external_api_key` and `calltools_api_key`:** These two columns on `configurations` have no provider in `canon/integrations.json`. `calltools_api_key` likely corresponds to an older CRM (CallTools) and may be dead. `external_api_key` purpose is unclear — could be a partner API key for the public quote surface. Product needs to confirm which are active before they're either dropped from the schema or added to the integrations registry.

4. **`name_legal` vs. display `name`:** The canon `org-registry.json` uses a `name` field (e.g., "Apex Auto Solutions") but the legacy DB has `name_legal` + `name_dba` as distinct columns. Is the canon `name` the DBA name? The legal name? A combined display string? The editor UI needs to show both fields correctly labeled.

5. **`plan_filters`, `addons`, `required_addons` JSONB structure:** The legacy DBML shows these as JSONB fields on configurations, but no schema for their internal structure is documented in the current legacy docs or canon. These drive product-package filtering for the protection workflow. Before Phase 2 makes them editable in the org-config editor, their internal schema must be extracted from legacy and canonized.

6. **`organization_partner_sessions` and the consumer portal:** The `organization_partner_sessions` table (with the step enum vehicle→completed) appears to be the tracking record for the self-serve consumer flow. In the rewrite, does each org get its own partner session flow, or is this model retired in favor of the protection-portal embedded flow?

---

## 7. Phase 2 Swap Notes

In Phase 2, the org-config editor reads from and writes to `await blinkerApi.orgs.get(orgId)` which returns the full org shape (matching the `org-registry.json` per-org object structure). All buckets should track dirty state independently so the API only receives changed sections:

```js
// Suggested per-bucket dirty tracking pattern
const [dirtyBuckets, setDirtyBuckets] = useState(new Set());
function markDirty(bucket) { setDirtyBuckets(s => new Set(s).add(bucket)); }

// On save: only PATCH the dirty buckets
const payload = {};
if (dirtyBuckets.has('system'))      payload.system = form.system;
if (dirtyBuckets.has('contacts'))    payload.contacts = form.contacts;
if (dirtyBuckets.has('opportunities')) payload.opportunities = form.opportunities;
if (dirtyBuckets.has('payments'))    payload.payments = form.payments;
// integrations saved independently per-provider via the existing Edit drawer flow
```

Every mutation appends to the org-scoped audit log (`config.updated` with field-level diff per `architecture/10-admin-console.md`). Phase 1 (now): audit rows land in `src/fixtures/audit-events.json` in mission-control. Phase 2: server-side append-only with org filter + cross-org super-admin pivot.

The existing `blinkerApi.orgs` surface (see `packages/api/`) currently exposes `contacts` and `opportunities` read functions. The org-config CRUD endpoint is a new addition for Phase 2 — document in `architecture/07-data-layer.md` when scoped.
