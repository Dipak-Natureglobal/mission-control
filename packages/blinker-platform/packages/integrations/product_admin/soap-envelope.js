// StoneEagle GetRates SOAP envelope construction.
//
// Extracted from stoneeagle.js (Wave 39 / ADR 30) so the request contract can
// be unit-tested under Node's ESM loader — stoneeagle.js statically imports
// JSON fixtures, which Node refuses to load without an import attribute.
// Pure string building: no network, no canon, no fixtures.
//
// Two shapes are produced, and they are BRANCHES rather than one parameterized
// builder because the vehicle path coerces NewUsed to N|U and defaults
// AssetType to 'P' — neither of which a home request can express.

export function escapeXml(s) {
  return String(s ?? '').replace(/[<>&"']/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  })[c]);
}

export function buildSoapEnvelope(input, creds) {
  const today = new Date().toISOString().slice(0, 10);

  // ADR 30 — Home Protection. OMEGA addresses its home-warranty line through
  // the SAME GetRates operation, with HOME sentinels in the vehicle slots
  // (values verbatim from the Basecamp AUG2 capture):
  //
  //   NewUsed '*'  — a home has no new/used axis, so there is no N+U fan-out.
  //   VehicleYear 2025, VehicleMake/Model 'HOME'
  //   Trim and AssetType emitted EMPTY, VehicleOdometer 0
  //
  // This is a BRANCH rather than a parameter because neither sentinel is
  // expressible on the vehicle path: that path coerces NewUsed to N|U and
  // DEFAULTS AssetType to 'P' when absent, so a home request routed through it
  // would silently be rated as a passenger vehicle.
  //
  // <State> is still sent (filed rates are state-driven) but omitted entirely
  // when absent — an empty <State/> is worse than no element.
  if (input?.asset_kind === 'home') {
    const homeStateTag = input.state
      ? `<State>${escapeXml(String(input.state).toUpperCase())}</State>`
      : '';
    return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetRates xmlns="http://www.natinc.com/SCSAutoService/">
      <objGetRatesRequest>
        <TpaCode>${escapeXml(creds?.tpa_code)}</TpaCode>
        <UserId>${escapeXml(creds?.user_id)}</UserId>
        <Password>${escapeXml(creds?.password)}</Password>
        <DealerNo>${escapeXml(creds?.dealer_no)}</DealerNo>
        <SaleDate>${today}</SaleDate>
        <NewUsed>*</NewUsed>
        ${homeStateTag}
        <VehicleYear>2025</VehicleYear>
        <VehicleMake>HOME</VehicleMake>
        <VehicleModel>HOME</VehicleModel>
        <Trim></Trim>
        <AssetType></AssetType>
        <VehicleOdometer>0</VehicleOdometer>
        <ProductCollection>
          <Product>
            <Code>VSC</Code>
          </Product>
        </ProductCollection>
      </objGetRatesRequest>
    </GetRates>
  </soap:Body>
</soap:Envelope>`;
  }
  // input.condition can be 'N'/'U' directly (from the parallel orchestrator)
  // or a free-form 'new'/'used' string (from legacy callers).
  const newUsed = input.condition === 'N' || input.condition === 'U'
    ? input.condition
    : (input.condition && /new/i.test(input.condition)) ? 'N' : 'U';
  const mileage = input.mileage ?? 0;

  // Wave 23-fu2 — AssetType resolution (PDF v3.0.5 follow-up).
  // SE recognizes 'P' (passenger), 'T' (truck/SUV/van/etc.), 'AL' (antique).
  // Caller resolves from VinAudit `type` (VIN path) or YMMT lookup
  // (make/model path) via packages/utils/asset-type.js + ymmt-data.js, then
  // passes input.asset_type. Default 'P' covers the common consumer-vehicle
  // case; the previous hardcoded 'T' miscategorized every sedan as a truck
  // and skewed GetRates output (surfaced 2026-05-09 OMGA UAT — Maxima SR
  // returned wrong rate set).
  const assetType = input.asset_type && /^(P|T|AL)$/i.test(input.asset_type)
    ? input.asset_type.toUpperCase()
    : 'P';

  let vehicleIdentifier;
  if (input.vin) {
    const trimTag = input.trim ? `<Trim>${escapeXml(String(input.trim).toUpperCase())}</Trim>` : '';
    vehicleIdentifier = `<VIN>${escapeXml(input.vin)}</VIN>${trimTag}`;
  } else {
    vehicleIdentifier = `<VehicleYear>${escapeXml(input.year)}</VehicleYear>
        <VehicleMake>${escapeXml(String(input.make ?? '').toUpperCase())}</VehicleMake>
        <VehicleModel>${escapeXml(String(input.model ?? '').toUpperCase())}</VehicleModel>
        <Trim>${escapeXml(String(input.trim ?? '').toUpperCase())}</Trim>
        <AssetType>${assetType}</AssetType>`;
  }

  // Wave 23 v3.0.5 Task 4: surface buyer state to SE so filed-rate plans
  // (FL VSC, TX GAP) return the right rate set. OMIT entirely when missing
  // — sending an empty <State/> is worse than no element (some SE handlers
  // treat empty as 'unknown' and short-circuit).
  // TODO(SE-doc): confirm element name with SEFI — `<State>` is a reasonable
  // default; SE eRating Integration Guide v1.31 should pin the exact field.
  const stateTag = input.state ? `<State>${escapeXml(String(input.state).toUpperCase())}</State>` : '';

  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetRates xmlns="http://www.natinc.com/SCSAutoService/">
      <objGetRatesRequest>
        <TpaCode>${escapeXml(creds?.tpa_code)}</TpaCode>
        <UserId>${escapeXml(creds?.user_id)}</UserId>
        <Password>${escapeXml(creds?.password)}</Password>
        <DealerNo>${escapeXml(creds?.dealer_no)}</DealerNo>
        <SaleDate>${today}</SaleDate>
        <NewUsed>${newUsed}</NewUsed>
        ${stateTag}
        ${vehicleIdentifier}
        <VehicleOdometer>${escapeXml(mileage)}</VehicleOdometer>
        <ProductCollection>
          <Product>
            <Code>VSC</Code>
          </Product>
        </ProductCollection>
      </objGetRatesRequest>
    </GetRates>
  </soap:Body>
</soap:Envelope>`;
}

