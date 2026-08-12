# `product_admin/` — VSC / GAP product administrator clients

Provider-pluggable rate-quote + product-catalog clients. Today: StoneEagle (SCS Auto / SEFI), Express Aftermarket (Omega stub).

```js
import { getRates } from 'blinker-platform/integrations/product_admin';

const result = await getRates(
  { year, make, model, trim, mileage, condition, state, vin },
  { orgId: 102, signal: ac.signal }
);
```

## Provider resolution

The facade reads `canon/org-registry.json::orgs[orgId].integrations` and picks the first enabled provider whose `category === 'product_admin'` per `canon/integrations.json`. It selects test vs live credentials from `org.test_mode`. Apps don't pick a provider; canon does.

## Phase 1 (today, fixture)

`stoneeagle.js` returns `_fixtures/stone-eagle-get-rates.json` with deterministic FNV-1a price perturbation by VIN. Canonical fixture VIN `2HGFE2F54SH551994` anchors at 1.00x; other inputs scale in `[0.85, 1.15]`. Logic lifted verbatim from the original `protection-portal/src/lib/stoneeagle.js`.

## Phase 2 (future, proxy)

`stoneeagle.js` carries a `_PROVIDER_MODE` constant. Flipping to `'proxy'` routes calls through a Blinker backend SOAP proxy that holds credentials server-side and calls SCS Auto's `scsautoservice.asmx` directly. The public surface (`getRates(input, ctx)`) does not change.

The browser MUST NOT call StoneEagle directly — credentials would leak in payloads, CORS would fail, and the audit log lives server-side. See `architecture/13-stoneeagle-integration.md::Why this can't run from the browser directly`.

## Backlog (separate wave)

- `bookContract`, `voidContract`, `printContractPDF` (eContracting v1.37)
- `getTrimsByVIN` (auxiliary, for trim-disambiguation retry)
- `getLienholders` (auxiliary, for lien-holder dropdown in BillingPayment)
- DocuSeal template alignment with the SCS `Sign<Type><Actor><Date>` PDF field naming convention

## References

- ADR: `architecture/13-stoneeagle-integration.md`
- Spec PDFs: `architecture/integration-partners/stoneeagle/`
- Canon: `canon/integrations.json::providers.stoneeagle`, `canon/plan-mappings.json`
- Legacy reference (read-only): `BlinkerLegacy/blinker/lib/blinker/gateway/product_services/stone_eagle*`
