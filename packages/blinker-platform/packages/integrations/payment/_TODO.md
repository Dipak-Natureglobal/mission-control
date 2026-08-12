# packages/integrations/payment — TODO / Backlog

## Status

**Wave 24 v3.0.6** — NEW package. Fixture + emulate paths only. Real
`/efs-charge` proxy backend wiring lands in Wave 24 Task C2 (protection-portal
vite.config.js + mission-control vite.config.js add the `/efs-charge` proxy
entry that forwards to the EFS cloud-function).

## Open items

### C2 (Wave 24) — Vite proxy wiring
Add `/efs-charge` to `vite.config.js` in both protection-portal and
mission-control so `mode = 'proxy'` actually reaches the EFS cloud-function.
This package intentionally omits the proxy config — it lives in the child apps
per the dep-direction rules (packages/integrations may NOT import from child apps).

### Emulate mode sync
The four emulate modes (`auto / success / declined / gateway_timeout`) are
surfaced in protection-portal's DevPanel (Wave 24 Task C3). Keep them in sync:
- `efs.js` is the authoritative list of valid emulate values.
- DevPanel toggle writes `blinker.dev.payment_emulate` to localStorage.
- If a new emulate mode is added here, update the DevPanel dropdown in
  protection-portal simultaneously.

### Refund flow (Wave 25 v3.0.7) — partially complete
`refundCharge()` is now feature-complete in fixture + emulate modes:
- **fixture path** (mode='fixture', emulate='auto') → synthetic approved,
  `refund_id: 'dev_refund_fixture_<ts>'`, 400ms simulated delay.
- **emulate paths** (emulate ≠ 'auto') → distinct success / declined /
  gateway_timeout outcomes via `makeRefundEmulateResult`. The same
  `blinker.dev.payment_emulate` localStorage key controls both charge and
  refund — a single DevPanel toggle drives both call types.
- **proxy path** (mode='proxy', emulate='auto') → POSTs to `/efs-charge/refund`
  and classifies via `classifyRefundError`. Already wired in client code.

Remaining backend work (not in v3.0.7 scope):
- Wire the `/efs-charge/refund` backend endpoint in the cloud-function.
- Validate `classifyRefundError` gateway-code mappings against the live
  FluidPay refund response shape (refund_too_old, refund_already_processed
  message patterns are best-effort until the endpoint ships).
- Remove this TODO item once smoke-tested against FluidPay sandbox.

### Org-level provider selection (Wave 25+)
Currently EFS is the only provider and is used for all orgs. When a second
payment provider is added, update `index.js` to resolve the active provider
per org from `canon/integrations.json` + `canon/org-registry.json` (mirroring
the pattern in `product_admin/index.js::selectProvider`).

### PCI note
`chargeOneTimeToken` only ever sees the short-lived `one_time_token` from the
FluidPay Hosted Fields iframe — never raw PAN, CVV, or expiration. The
cloud-function is the only party that exchanges the token for a vault ref.
Never log or persist the `token` parameter.
