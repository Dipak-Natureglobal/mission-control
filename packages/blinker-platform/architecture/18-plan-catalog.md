# 18 — Plan Catalog + DocuSeal Template Mapping (Wave 27, v3.0.8 PDF Tasks 1+2)

## Premise

The protection workflow's Step 5 ("Recommended Coverage") today shows whatever `PlanDescription` the rater (StoneEagle GetRates, F&I Express, direct product administrator) returns — e.g. *"AAA PT Plus High Mileage"* (PlanCode 51, TpaCode OMGA). Two problems:

1. **Raw plan descriptions don't sell.** Different raters use different naming conventions; the descriptions are written for back-office, not customers.
2. **Organizations have brand-specific positioning** they want to use — AAA might call their PowerTrain Plus offering different things than another org running on the same OMGA paper.

We already classify plans into `Good / Better / Best` (`PlanLevel`) via `canon/plan-mappings.json::default_quality_mapping`. v3.0.8 adds:

- **`PlanTitle`** — the org-controlled display name that replaces the rater's `PlanDescription` on the coverage card (e.g., "Powertrain Plus" instead of "AAA PT Plus High Mileage").
- **`PlanCoverage` HTML** — the rich-text content shown when a customer clicks "See what's covered". Default per `PlanLevel` (3 HTMLs supplied in the v3.0.8 PDF), override per `(TpaCode, ProductTypeCode, PlanCode)`.
- **`SampleAgreementURL`** — interpolated into the default HTML's "See what's covered" link, opens the actual sample-agreement PDF or landing page in a modal.
- **`DocuSealTemplateID`** (Task 2) — the DocuSeal e-sign template to use when generating the contract for THIS plan. Per `(TpaCode, ProductTypeCode, PlanCode)` because each plan has its own underlying contract paper.

All four fields are org-configurable through a new admin tab. Defaults fall through the canon → catalog → per-org-override stack.

## Canon model

### `canon/plan-mappings.json::plan_level_defaults`

Three HTML blobs — one per PlanLevel — used when a plan has no specific override. Verbatim from v3.0.8 PDF. Also carries the inline `tagline_default` string the PlanCard subtitle reads.

```json
"plan_level_defaults": {
  "good": {
    "default_selected": false,
    "tagline_default": "Core powertrain coverage for budget-minded peace of mind.",
    "plan_coverage_default_html": "<div>...Affordable coverage designed for older vehicles...</div>"
  },
  "better": { ... },
  "best":   { "default_selected": true, ... }
}
```

The `{{SAMPLE_AGREEMENT_URL}}` placeholder in each default HTML is interpolated by the resolver with the plan's `sample_agreement_url` (or `#` if absent). This keeps the canon defaults reusable without embedding org-specific URLs.

### `canon/plan-mappings.json::plan_catalog`

Global, per-`(TpaCode, ProductTypeCode, PlanCode)` classification. Key format: `${tpa}::${ptc}::${plan_code}` (e.g. `OMGA::VSC::51`).

```json
"plan_catalog": {
  "OMGA::VSC::51": {
    "tpa_code": "OMGA",
    "product_type_code": "VSC",
    "plan_code": "51",
    "plan_level": "good",
    "plan_title": "Powertrain Plus",
    "plan_coverage_html": null,
    "sample_agreement_url": null,
    "docuseal_template_id": null
  }
}
```

Nullable fields fall through to the level default. Seeding is intentionally minimal — the admin tool populates the rest from the Google Sheet at https://docs.google.com/spreadsheets/d/1-5TMtDlNPeeoD9dtrCNUK-OCZqqtCbaOoynreeiBfyw/.

**Behavior for unmapped PlanCodes:** when a rater returns a `(TpaCode, ProductTypeCode, PlanCode)` triple with no catalog entry, the resolver classifies it as `good` and uses the raw `PlanDescription` as `PlanTitle`. This is the PDF-spec'd default — `"by default, it will show up in the Good classification with the PlanDescription as the PlanTitle."`

The legacy `default_quality_mapping` (name-match against the plan name) stays as a secondary fallback ahead of the hard `good` default — preserves Wave 21 behavior for plans whose name carries a tier signal (`EXCL`, `POWERTRAIN PLUS`, etc.).

### `canon/org-registry.json::orgs[].plan_overrides`

Per-org overrides — supersede the global catalog. Same shape as a catalog entry, same key format.

```json
"plan_overrides": {
  "OMGA::VSC::51": {
    "plan_level": "good",
    "plan_title": "Coverage Saver",
    "plan_coverage_html": "<div>...org-specific HTML...</div>",
    "sample_agreement_url": "https://example.com/coverage/aaa-vsc-51.pdf",
    "docuseal_template_id": "tpl_abc123"
  }
}
```

Empty by default — Apex (102) ships with `{ "_comment": "..." }` as the placeholder. Other orgs in the registry are sparse fixtures and don't carry the block until the admin tool adds entries.

### `canon/org-registry.json::orgs[].integrations.docuseal.credentials.template_id_by_plan`

Per-org-level fallback for DocuSeal template IDs (used when a plan has no `docuseal_template_id` in catalog or override). Same key format. Empty by default.

Why two places to set DocuSeal template? Practical: most orgs use ONE template across all their plans; some have plan-specific templates. The plan-level setting wins; the org-level `template_id_by_plan` is the default-for-this-org-when-no-plan-level-override. Both layer above the integration-default behavior (no template id → DocuSeal flow falls back to whatever the integration default is).

## Resolution order

Implemented in `packages/utils/plan-presentation.js`:

```
resolvePlanPresentation({ orgId, tpaCode, productTypeCode, planCode, planName })
  → { planLevel, planTitle, tagline, coverageHtml, sampleAgreementUrl, docusealTemplateId, source }
```

Field-by-field precedence (most specific first):

| Field                 | 1                                 | 2                              | 3                               | 4              |
|-----------------------|-----------------------------------|--------------------------------|---------------------------------|----------------|
| `planLevel`           | org_override.plan_level           | catalog.plan_level             | name_match (default_quality_…)  | `'good'`       |
| `planTitle`           | org_override.plan_title           | catalog.plan_title             | `planName`                      | `'Plan'`       |
| `coverageHtml`        | org_override.plan_coverage_html   | catalog.plan_coverage_html     | level_default.plan_coverage_… | `''`           |
| `sampleAgreementUrl`  | org_override.sample_agreement_url | catalog.sample_agreement_url   | —                               | `null`         |
| `tagline`             | org_override.tagline              | catalog.tagline                | level_default.tagline_default | `''`           |
| `docusealTemplateId`  | org_override.docuseal_template_id | catalog.docuseal_template_id   | org.integrations.docuseal.credentials.template_id_by_plan[key] | `null` |

`source` field returns which path resolved each field — used by admin UI to show "Using default" vs "Override" labels.

`tpaCode` defaults to the org's StoneEagle credential `tpa_code` (test if `org.test_mode`, else live) — most orgs use a single TPA. Callers may pass an explicit `tpaCode` to override (multi-TPA orgs, future product-admin integrations).

## Admin surface

Lives in `mission-control/src/personas/admin/PlanCatalog.jsx`, gated on the existing `admin` persona. New top-level nav entry "Plan presentations" (between "Integrations" and "Configuration").

**Two sub-tabs:**

1. **Defaults** — rich-text-edit (textarea, no WYSIWYG in Phase 1) the three `plan_level_defaults.{good, better, best}.plan_coverage_default_html` blocks plus `tagline_default`. Edits write to `canon/plan-mappings.json` — Phase 1 session-only via the existing fixture-edit hook pattern (see `IntegrationDrawer.jsx` for the precedent). Phase 2 hits a server endpoint.
2. **Plans** — table of all entries from `listPlanCatalog()` UNIONed with this org's `plan_overrides`. Columns: TpaCode · ProductTypeCode · PlanCode · PlanLevel (dropdown Good/Better/Best) · PlanTitle (text) · Sample agreement URL (text) · DocuSeal Template ID (text) · "Coverage HTML" (opens a side panel with `<textarea>` for the override). Each row shows a "Default" badge when fields fall back to the catalog/level-default, and an "Override" badge when this org has its own value. "Add plan" button opens a form prompting `(TpaCode, ProductTypeCode, PlanCode)` and lets the user choose to save into the org-level overrides (default) or, when persona is `super_admin`, the global catalog.

**Persona gating:**
- `admin` — edits this org's `plan_overrides` only (cannot mutate the global catalog or per-level defaults).
- `super_admin` — edits the global catalog + level defaults too (the "Defaults" sub-tab is super-admin-only; admins see a read-only view of it).

**Per-org DocuSeal default editor:** also lives on this screen, as a small section at the top of "Plans" — "When a plan doesn't have a specific DocuSeal template ID, fall back to:" then a key-value editor over `integrations.docuseal.credentials.template_id_by_plan`. Two routes to set the same data is intentional: most orgs will only edit the per-plan field via the Plans table; the second path serves the rare "I need a default per (Tpa+Ptc+Plan) without overriding the title/level" case.

**Audit:** every save fires a `plan_catalog.{plan_override_updated, default_updated, docuseal_default_updated}` event into the org's `audit_events` collection (existing Wave 14 pattern from `architecture/10-admin-console.md`).

## Consumer surface

`protection-portal/src/components/PlanCard.jsx`:

- Calls `resolvePlanPresentation()` with the plan's `tpa_code` / `product_type_code` / `plan_code` / name and the current `orgId`.
- Replaces `plan.name` with `presentation.planTitle` for the card title.
- Replaces `PUBLIC_TIER_COPY[tier].tagline` with `presentation.tagline`.
- Adds a "See what's covered" link near the tagline that opens a modal rendering `presentation.coverageHtml` (sanitized; iframe-sandboxed OR `DOMPurify`'d — pick one in the agent dispatch).

`protection-portal/src/components/planCardCopy.js` keeps `TIER_ORDER` + tier icons/labels (Icon, Label) but `PUBLIC_TIER_COPY[tier].tagline` becomes a fallback that the resolver picks up via the level_default path.

The Customize coverage table (browse-all-plans view) gets the same `planTitle` treatment — agents see the org's preferred names everywhere, not just on the recommendation cards.

## Security

`coverageHtml` is HTML straight from canon (today) and an admin-edited canon-equivalent (Phase 2). To avoid an XSS path:

- Render with **`DOMPurify.sanitize(html, { ALLOWED_TAGS: [...], ALLOWED_ATTR: ['style', 'href'] })`** in the modal. Tags allowed: `div, h1-h4, p, ul, li, span, a, br, strong, em`. Attrs: `style, href` only.
- `href` values are URL-validated (must be `https://` or `mailto:` or `#`) before render.
- Inline `<script>` and `on*` event handlers are stripped by DOMPurify.

Phase 2 admin save endpoint must also sanitize server-side before persisting.

## Migration / rollout

- Canon ships with one seed (`OMGA::VSC::51` → `good` / "Powertrain Plus") matching the v3.0.8 PDF screenshot.
- All other (Tpa, Ptc, Plan) combinations get classified by the existing name-match fallback until the admin populates them.
- Once the admin populates the Google Sheet contents through the new tool, the seed entry will be one of many.

No breaking changes — every existing call site that read `plan.name` keeps working until protection-portal swaps to `presentation.planTitle`.

## Cross-references

- `canon/plan-mappings.json` — `plan_level_defaults`, `plan_catalog`, `default_quality_mapping`
- `canon/org-registry.json` — `orgs[].plan_overrides`, `orgs[].integrations.docuseal.credentials.template_id_by_plan`
- `packages/utils/plan-presentation.js` — `resolvePlanPresentation`, `getPlanLevelDefaults`, `listPlanCatalog`
- `architecture/10-admin-console.md` — admin shell pattern, persona gating, audit-events conventions
- `architecture/13-stoneeagle-integration.md` — where `tpa_code` / `product_type_code` / `plan_code` originate
- Google Sheet (source of truth for plan classifications): https://docs.google.com/spreadsheets/d/1-5TMtDlNPeeoD9dtrCNUK-OCZqqtCbaOoynreeiBfyw/
- v3.0.8 PDF — `~/Downloads/Blinker Platform - v.3.0.8.pdf`
