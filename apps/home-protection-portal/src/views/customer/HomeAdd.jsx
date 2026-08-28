// Customer view · Step 1 — Add home.
//
// Captures the covered property and, on Continue, fires the home GetRates
// call. Field set mirrors the legacy Mission Control "Add New Home" screen
// (spec §2.5): Home Type, an existing-address picker, the address block,
// Year Built, Square Feet, Purchase Price, Disposition.
//
// THE ELIGIBILITY GATE (ADR 30 R2)
// --------------------------------
// The Omega home agreement prints a five-way dwelling-type checkbox:
// single-family under 5,000 / 5,000–8,000 / 8,001–12,000 sq ft, townhome
// under 5,000, condominium under 5,000. `classifyDwelling` resolves
// (home_type, square_feet) to exactly one of those buckets, or to null.
//
// null means INELIGIBLE, not "unknown". A home over its type's ceiling has
// no box to tick on the agreement, so we block the quote here rather than
// papering a signed agreement with a blank dwelling field. The rule is
// INFERRED from the printed bucket list, not stated by Omega — confirm with
// product before treating it as authoritative.
//
// WHY GETRATES FIRES FROM THIS STEP
// ---------------------------------
// A home quote takes exactly one location input: <State>. There is no
// mileage axis, no new/used axis, and no VIN. Since the covered-property
// address is captured right here, there is nothing left to collect before
// rating — which is why the auto flow's garage_location step has no home
// equivalent. Square footage and year built are NOT rating inputs; they
// exist for eligibility and for the agreement PDF.
import { useEffect, useMemo, useRef, useState } from 'react';
import { House, AlertTriangle, Loader2, MapPin } from 'lucide-react';
import {
  ScreenHeader,
  WizardFooter,
  Field,
  SelectField,
  AddressBlock,
} from 'blinker-platform/components';
import { classifyDwelling, listHomeTypes } from 'blinker-platform/utils';
import { getRatesForHome } from 'blinker-platform/integrations/product_admin';
import { track } from 'blinker-platform/telemetry';
import planMappings from '../../constants/canon/plan-mappings.json' with { type: 'json' };

const DWELLING_CANON = planMappings.home_dwelling_classes;

// AddressBlock's fieldNames contract supports ONE level of nesting
// ('contact.zip'), and our address lives two levels deep at
// form.home.address.zip. So we hand it the address object itself as its
// `form` with flat field names, and re-nest the patch on the way back out.
const ADDRESS_FIELD_NAMES = {
  zip: 'zip',
  city: 'city',
  state: 'state',
  address: 'address1',
  apt_suite: 'address2',
};

function toInt(raw) {
  const digits = String(raw ?? '').replace(/[^0-9]/g, '');
  return digits === '' ? null : Number(digits);
}

// Highest square footage this home type can carry and still land in a
// bucket. Used to phrase the ineligibility message concretely rather than
// telling the consumer "no" with no number attached.
function ceilingForType(homeType) {
  const buckets = (DWELLING_CANON?.buckets || []).filter((b) => b.home_type === homeType);
  if (buckets.length === 0) return null;
  return Math.max(...buckets.map((b) => Number(b.max_sqft)));
}

// Addresses already on file for this contact, offered as a one-click
// prefill. Accepts both the canonical mission-control shape (line_1 /
// postal_code) and the flat wizard shape (address1 / zip), because a
// contact reaches this screen from either.
function existingAddresses(contact) {
  const rows = [];
  const seen = new Set();
  function push(id, a) {
    if (!a) return;
    const address1 = a.address1 ?? a.line_1 ?? '';
    const city = a.city ?? '';
    const state = a.state ?? '';
    const zip = a.zip ?? a.postal_code ?? '';
    if (!address1 || !city || !state || !zip) return;
    const key = `${address1}|${city}|${state}|${zip}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      id: id || key,
      label: `${address1}, ${city}, ${state} ${zip}`,
      value: { address1, address2: a.address2 ?? a.line_2 ?? '', city, state, zip },
    });
  }

  if (Array.isArray(contact?.addresses)) {
    contact.addresses.forEach((a, i) => push(a.id || `addr_${i}`, a));
  }
  for (const m of contact?.household_members || []) {
    (m.addresses || []).forEach((a, i) => push(a.id || `${m.id}_addr_${i}`, a));
  }
  push('contact_flat', contact);

  return rows;
}

export function HomeAdd({ form, update, onNext, persona = 'consumer' }) {
  const home = form.home || {};
  const address = home.address || {};

  const [fetching, setFetching] = useState(false);
  const [rateError, setRateError] = useState(null);
  const ineligibleTrackedRef = useRef(null);

  const homeTypes = useMemo(() => listHomeTypes(DWELLING_CANON), []);
  const savedAddresses = useMemo(
    () => existingAddresses(form.contact || {}),
    [form.contact],
  );

  const sqft = home.square_feet;
  const bothInputsFilled = !!home.home_type && Number.isFinite(Number(sqft)) && Number(sqft) > 0;

  // Recomputed on every render rather than cached, so it can never drift
  // from the two inputs it derives from.
  const dwelling = useMemo(
    () => classifyDwelling({ home_type: home.home_type, square_feet: sqft }, DWELLING_CANON),
    [home.home_type, sqft],
  );
  const ineligible = bothInputsFilled && dwelling === null;

  // Mirror the derived bucket onto the form so downstream consumers
  // (mission-control's Home card, the DocuSeal field builder's sanity
  // check) read one value rather than each re-deriving it.
  useEffect(() => {
    const next = dwelling?.id ?? null;
    if ((home.dwelling_class ?? null) === next) return;
    update({ home: { ...home, dwelling_class: next } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dwelling?.id]);

  // Fire the ineligibility event once per distinct (type, sqft) pair, so a
  // consumer typing "12" → "120" → "12000" does not emit three events for
  // what is one decision point.
  useEffect(() => {
    if (!ineligible) return;
    const key = `${home.home_type}::${sqft}`;
    if (ineligibleTrackedRef.current === key) return;
    ineligibleTrackedRef.current = key;
    track('home_protection.customer.home_add.ineligible', {
      home_type: home.home_type,
      square_feet: Number(sqft),
      persona,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ineligible, home.home_type, sqft]);

  function writeHome(patch) {
    update({ home: { ...(form.home || {}), ...patch } });
  }

  function writeAddress(patch) {
    update({
      home: {
        ...(form.home || {}),
        address: { ...(form.home?.address || {}), ...patch },
      },
    });
  }

  function applySavedAddress(id) {
    const hit = savedAddresses.find((a) => a.id === id);
    if (!hit) return;
    writeAddress(hit.value);
    track('home_protection.customer.home_add.existing_address_applied', { persona });
  }

  const addressOk = !!(address.address1 && address.city && address.state && address.zip);
  const yearOk = Number.isFinite(Number(home.year_built)) && String(home.year_built ?? '').length === 4;
  const canContinue = !!home.home_type && bothInputsFilled && !ineligible && addressOk && yearOk && !fetching;

  async function handleContinue() {
    if (!canContinue) return;
    setFetching(true);
    setRateError(null);
    const state = String(address.state || '').toUpperCase();
    track('home_protection.customer.home_add.get_rates.requested', {
      state,
      home_type: home.home_type,
      dwelling_class: dwelling?.id ?? null,
      persona,
    });
    try {
      const rates = await getRatesForHome({ state }, { orgId: form.org_id });
      const productCount = rates?.products?.length ?? 0;
      track('home_protection.customer.home_add.get_rates.received', {
        product_count: productCount,
        status: rates?.status ?? null,
        error_classified: rates?._error_classified?.kind ?? null,
      });
      update({
        rates,
        status: productCount > 0 ? 'Quoted' : 'Quoted - No Results',
      });
      setFetching(false);
      onNext();
    } catch (err) {
      const detail = err?.message || 'Could not fetch coverage rates.';
      track('home_protection.customer.home_add.get_rates.failed', { error: detail });
      setRateError(detail);
      setFetching(false);
    }
  }

  const ceiling = ceilingForType(home.home_type);
  const typeLabel =
    homeTypes.find((t) => t.id === home.home_type)?.label || 'this home type';
  const currentYear = new Date().getFullYear();
  const homeAge =
    yearOk && Number(home.year_built) <= currentYear
      ? currentYear - Number(home.year_built)
      : null;

  return (
    <>
      <ScreenHeader
        icon={House}
        eyebrow="Home · Add"
        title="Tell us about the home"
        subtitle="We only need a few details to price coverage for this property."
      />

      <div className="px-6 space-y-4">
        <SelectField
          label="Home type"
          value={home.home_type}
          onChange={(v) => writeHome({ home_type: v })}
          options={homeTypes.map((t) => ({ value: t.id, label: t.label }))}
        />

        {savedAddresses.length > 0 && (
          <div className="border border-slate-200 rounded-md px-3 py-2 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-slate-500 shrink-0" />
            <label className="text-[11px] uppercase tracking-wide font-semibold text-slate-600 shrink-0">
              Use an address on file
            </label>
            <select
              defaultValue=""
              onChange={(e) => applySavedAddress(e.target.value)}
              className="flex-1 text-sm border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
            >
              <option value="">Enter a new address…</option>
              {savedAddresses.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </div>
        )}

        <div className="border border-slate-200 rounded-md overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
            <House className="w-4 h-4 text-slate-500" />
            <span className="text-xs uppercase tracking-wide font-semibold text-slate-600">
              Covered property address
            </span>
          </div>
          <div className="px-4 py-3 space-y-3">
            {home.address_source === 'contact_address' && (
              <p className="text-[11px] text-blue-700 bg-blue-50 border border-blue-100 rounded-md px-2.5 py-1.5 leading-snug">
                Prefilled from the contact&apos;s address on file — confirm this is the
                covered property, or update it below.
              </p>
            )}
            {/* AddressBlock gets the address object as its own form — its
                fieldNames contract only reaches one level of nesting. */}
            <AddressBlock
              form={address}
              update={writeAddress}
              fieldNames={ADDRESS_FIELD_NAMES}
              showAptSuite={true}
              autoFocusZip={false}
            />
            <p className="text-[11px] text-slate-500 leading-snug">
              This is the property being covered. The agreement holder&apos;s mailing
              address is collected at billing and may differ.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Year built"
            value={home.year_built ?? ''}
            onChange={(v) => writeHome({ year_built: toInt(String(v).slice(0, 4)) })}
            placeholder="1998"
            inputMode="numeric"
            maxLength={4}
          />
          <Field
            label="Square feet"
            value={home.square_feet ?? ''}
            onChange={(v) => writeHome({ square_feet: toInt(v) })}
            placeholder="2400"
            inputMode="numeric"
            maxLength={6}
          />
        </div>
        {homeAge != null && (
          <div className="text-[11px] text-slate-500 -mt-2">
            {home.year_built} — {homeAge} {homeAge === 1 ? 'yr' : 'yrs'} old
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Purchase price"
            optional
            prefix="$"
            value={home.purchase_price ?? ''}
            onChange={(v) => writeHome({ purchase_price: toInt(v) })}
            placeholder="285000"
            inputMode="numeric"
          />
          <Field
            label="Disposition"
            optional
            value={home.disposition ?? ''}
            onChange={(v) => writeHome({ disposition: v })}
            placeholder="Owner occupied"
          />
        </div>

        {dwelling && (
          <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
            Eligible — this property files as{' '}
            <span className="font-semibold">{dwelling.label}</span> on the agreement.
          </div>
        )}

        {ineligible && (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold mb-0.5">This home can&apos;t be covered</div>
              {ceiling != null ? (
                <>
                  Coverage for a {typeLabel.toLowerCase()} tops out at{' '}
                  <span className="font-semibold">{ceiling.toLocaleString()} sq ft</span>, and this
                  property is {Number(sqft).toLocaleString()} sq ft. There is no dwelling
                  category on the Omega agreement that fits it, so we can&apos;t quote a plan.
                </>
              ) : (
                <>
                  We don&apos;t have a dwelling category for this property type, so we
                  can&apos;t quote a plan.
                </>
              )}
              <div className="mt-1 text-[11px] text-amber-700">
                Check the square footage above, or talk to an agent about other options.
              </div>
            </div>
          </div>
        )}

        {rateError && (
          <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold mb-0.5">Couldn&apos;t fetch rates</div>
              {rateError}
            </div>
          </div>
        )}

        {fetching && (
          <div className="text-xs text-blue-600 flex items-center justify-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Pricing coverage for this home…
          </div>
        )}
      </div>

      <WizardFooter
        onNext={handleContinue}
        disabled={!canContinue}
        nextLabel={fetching ? 'Pricing…' : 'Continue'}
      />
    </>
  );
}
