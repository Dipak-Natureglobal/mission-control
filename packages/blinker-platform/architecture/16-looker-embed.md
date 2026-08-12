# ADR 16 — Looker Studio reports embedded in mission-control (no external links)

**Status:** Accepted (Wave 23 v3.0.5 Task 3, 2026-05-09)
**Replaces:** the v3.0.5 PDF's literal "Add links to Looker Studio" wording

## Context

The v3.0.5 PDF Task 3 supplied four Looker Studio URLs (Opportunities,
Down Payments, Payment Tracking, Contracts in Transit) and asked us
to "Add links to Looker Studio. Add org config for managing report
urls."

During Wave 23 planning the user explicitly redirected: do NOT
external-link out to Looker. Embed in our shell. Two reasons:

1. **No context switch.** The agent / manager stays inside
   mission-control instead of bouncing to a separate Google chrome
   they may not be authed into.
2. **Don't expose the URL.** A bare external link surfaces the
   underlying report id + filter parameters in a way that's easy to
   reshare / forward outside the auth boundary. An iframe `src` is
   inspectable but not invitingly copyable.

This decision is preserved in `feedback_looker_embed_pattern.md`
(coordinator memory) so future waves don't backslide into linking out.

## Decision

1. Canon stores **ids, never URLs**. Per-org
   `org.reports.looker_studio` shape:
   ```json
   {
     "report_id": "<looker-report-uuid>",
     "params_template": {
       "ds0.p0": "{user_email}",
       "ds1.p1": "{user_email}",
       "ds2.p2": "{user_email}"
     },
     "pages": {
       "<key>": { "label": "<tab label>", "page_id": "<looker-page-id>|null" }
     }
   }
   ```

2. URL construction lives in `mission-control/src/lib/external-links.js#buildLookerEmbedUrl`:
   ```
   https://lookerstudio.google.com/embed/reporting/{report_id}[/page/{page_id}]?params={url-encoded JSON}
   ```
   The params JSON has `{user_email}` substituted with the resolved
   session user email then `encodeURIComponent(JSON.stringify(...))`.
   The encoded form matches the `%7B%22ds0.p0%22:...%7D` shape of
   the URLs supplied in the v3.0.5 PDF.

3. `mission-control/src/personas/agent/AgentReports.jsx` is the only
   consumer:
   - Reads `org.reports.looker_studio` from synced canon.
   - Tab strip across the top — one tab per `pages[*]` entry.
   - Body is a full-bleed `<iframe>` with `src=buildLookerEmbedUrl(...)`,
     `allowfullscreen`, no `referrerpolicy="no-referrer"`.
   - Loading state + empty/error state when `report_id` is null
     (not yet configured for this org).

4. The agent persona nav gets a single internal `reports` item that
   routes to AgentReports — NOT five external links to Looker pages.

5. `_demo_user_email` at the canon `org-registry.json` root provides
   a Phase 1 fallback (`jimmy@aautoalliance.com` per the PDF) when no
   real session user is present. Phase 2 swaps to the resolved auth user.

## Auth caveat (operational, NOT enforced by code)

The `params` query string is a **row filter** inside the report's
user-input controls, not an auth mechanism. Every viewer must:

- Be logged into a Google account in their browser.
- Have view access to the underlying Looker Studio report (Blinker
  ops grants per-email).
- Use a browser that allows third-party cookies for `lookerstudio.google.com`
  (Safari ITP and Brave block by default — embed will fail to render).

These three constraints are operational onboarding, not code:
mission-control cannot detect them ahead of time. Surface in the
integrations runbook + manager onboarding checklist.

## Consequences

- Reports surface inside our shell — same chrome, same nav, same
  interaction model as the rest of mission-control.
- Underlying report URL never appears in nav DOM as a link element;
  iframe `src` is the only place it lives.
- Adding a new report tab to an existing org = edit `pages` in canon
  + sync. No code change.
- New orgs go live by populating `report_id` + `pages` — empty state
  handles the pre-config period.
- Looker permission management remains a manual ops step. The auth
  caveat is documented but not enforced — flag in any incident review
  where a user reports "report won't load."

## Out of scope

- Migrating the inline canon report ids out into encrypted server-side
  storage (Phase 2 work — same migration path as integration credentials).
- Per-report filter customization beyond the user-email substitution
  (e.g., date-range pre-filter, vehicle-type filter).
- Programmatic Looker permission grants when an org's user list changes.
