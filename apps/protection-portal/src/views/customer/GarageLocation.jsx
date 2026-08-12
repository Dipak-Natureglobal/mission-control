// Customer view · Step (post-modifications, pre-coverage) — Garage Location.
//
// Asks where the vehicle is garaged. Phase 1 wedge for per-state coverage
// availability — protection-plan providers' product menus vary by state,
// so we need a confirmed address before quoting. Slotted between
// Modifications and RecommendedCoverage in buildSteps.
//
// Wave-7b move (2026-05-04 follow-up): this screen now dispatches the
// StoneEagle GetRates call on Continue. It used to live on
// VehicleDrive's onNext, but GetRates needs form.state and state isn't
// collected until here. Sequence is now:
//   modifications → garage_location (state collected, GetRates fired) →
//   recommended_coverage (renders form.rates).
// On a GetRates failure the wizard does NOT advance — error UI surfaces
// inline and the user can retry the same Continue button. On success
// form.rates is stashed and onNext() advances to RecommendedCoverage.
//
// Conditional rendering: only runs when we don't already have a usable
// contact location on file (form.contact.zip + city + state). Wave 16 F4
// flipped the predicate from address1+state to zip+city+state because
// per-state coverage availability and StoneEagle GetRates only require
// the zip/city/state triple — street isn't needed until checkout, where
// BillingPayment's AddressBlock collects it. When the predicate
// short-circuits, GetRates is dispatched as a fallback from
// RecommendedCoverage's mount useEffect (form.rates empty + zip+state
// populated). See CustomerView.shouldRunGarageLocation +
// RecommendedCoverage's mount effect.
//
// Body: refi-portal's AddressBlock (zip-first → city/state autofill via
// Google Places + zippopotam.us; street autocomplete via Places API).
// AddressBlock writes into form.contact.* via the fieldNames remap —
// same shape BillingPayment uses, so the two screens share one canonical
// address slice. Eliminates the prior form-shape drift where
// GarageLocation wrote flat (form.zip / form.address) and BillingPayment
// wrote nested (form.contact.zip / form.contact.address1).
//
// Continue gating: contact.zip + contact.city + contact.state must be
// filled. Street address is OPTIONAL on this screen (Wave 16 F4) — the
// canonical street is collected on BillingPayment, and per-state
// coverage availability only needs the zip/city/state triple.
// AddressBlock auto-fills city + state on a successful ZIP resolve, so
// the typical user clears Continue with just a ZIP entry.
import { useEffect, useRef, useState } from 'react';
import { MapPin, AlertCircle, Loader2 } from 'lucide-react';
import { ScreenHeader, WizardFooter } from 'blinker-platform/components';
import { AddressBlock } from 'blinker-platform/components';
// Wave 21: lifted to blinker-platform/integrations/product_admin. Phase 2 swap
// will flip the package's _PROVIDER_MODE constant from 'fixture' to 'proxy'
// at packages/integrations/product_admin/stoneeagle.js — single line change,
// no consumer-side update needed.
import { getRates } from 'blinker-platform/integrations/product_admin';
import { track } from 'blinker-platform/telemetry';

// AddressBlock fieldNames remap — write into form.contact.* so the
// canonical address slice is shared with BillingPayment + Confirm.
// Mirrors BillingPayment's ADDRESS_FIELD_NAMES; apt/suite is omitted
// here (showAptSuite=false on this screen) since garage location only
// needs the street.
const ADDRESS_FIELD_NAMES = {
  zip: 'contact.zip',
  city: 'contact.city',
  state: 'contact.state',
  address: 'contact.address1',
};

export function GarageLocation({ form, update, onNext }) {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const viewedRef = useRef(false);

  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    track('protection.customer.garage_location.viewed', {
      vehicle_year: form.year,
      vehicle_make: form.make,
      vehicle_model: form.model,
    });
    if (!form.garage_location_started) {
      update({ garage_location_started: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // AddressBlock returns { contact: {key:v} } patches via writePatch when
  // fieldNames target nested paths. useForm's shallow merge would clobber
  // the rest of form.contact (name/email/phone seeded by INITIAL_FORM,
  // tags, etc.) — wrap update so any patch touching `contact` merges
  // into the existing slice. Mirrors BillingPayment's updateContactSafe
  // (sans the household-member mirroring, which is agent-only on
  // BillingPayment). Coordinator removes both wrappers once AddressBlock
  // is fixed upstream.
  function updateContactSafe(patch) {
    if (!patch || !Object.prototype.hasOwnProperty.call(patch, 'contact')) {
      update(patch);
      return;
    }
    const merged = { ...(form.contact || {}), ...(patch.contact || {}) };
    update({ ...patch, contact: merged });
  }

  const contact = form.contact || {};
  const vehicleTitle = [form.year, form.make, form.model].filter(Boolean).join(' ');
  // Wave 16 F4: street is optional on this screen — Continue requires
  // only zip + city + state. Street is collected on BillingPayment.
  const ok = !!(contact.zip && contact.city && contact.state);

  async function handleNext() {
    if (!ok || submitting) return;
    setSubmitting(true);
    setSubmitError(null);

    const stateForRates = contact.state ?? form.state ?? null;
    track('protection.customer.garage_location.get_rates.requested', {
      year: form.year,
      make: form.make,
      model: form.model,
      trim: form.trim,
      mileage: form.mileage,
      condition: form.condition,
      state: stateForRates,
    });
    try {
      // Wave 23 Task 4: state propagated; FL contacts get FL-specific filed-rate plans via SE.
      // Wave 23-fu2: asset_type derived from VIN decode or YMMT lookup in VehicleAdd, no longer hardcoded.
      const rates = await getRates({
        year: form.year,
        make: form.make,
        model: form.model,
        trim: form.trim,
        mileage: form.mileage,
        condition: form.condition,
        vin: form.vin || null,
        state: stateForRates,
        asset_type: form.vehicle?.asset_type ?? null,
      }, { orgId: form.org_id });
      track('protection.customer.garage_location.get_rates.received', {
        product_count: rates?.products?.length ?? 0,
        add_on_count: rates?.add_ons?.length ?? 0,
        error_classified: rates?._error_classified?.kind ?? null,
      });
      update({ rates, status: 'rates_received' });
      // Wave 23 Task 7: if SE returned a classified error, stash the rates
      // (for fallback_fixture display) but still advance so RecommendedCoverage
      // can render the friendly callout + fixture plans beneath it.
      track('protection.customer.garage_location.continued', {
        zip: contact.zip,
        state: contact.state,
        rates_received: true,
      });
      onNext();
    } catch (err) {
      track('protection.customer.garage_location.get_rates.failed', { error: err.message });
      setSubmitError(err.message || 'Could not load coverage options.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <ScreenHeader
        icon={MapPin}
        eyebrow="Coverage · Location"
        title={`Where is your ${vehicleTitle || 'vehicle'} garaged?`}
        subtitle="Our protection plan providers' options vary by location. We need to confirm availability of coverage."
      />

      {submitting ? (
        <div className="px-6 py-12 flex flex-col items-center justify-center text-center">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-4" />
          <div className="text-lg font-semibold text-slate-800 mb-1">Loading your coverage options…</div>
          <div className="text-sm text-slate-500">This usually takes a few seconds.</div>
        </div>
      ) : (
        <>
          <div className="px-6 space-y-3">
            <AddressBlock
              form={form}
              update={updateContactSafe}
              fieldNames={ADDRESS_FIELD_NAMES}
              autoFocusZip={true}
              showAptSuite={false}
            />

            {!ok && (contact.zip || contact.city || contact.state || contact.address1) && (
              <div className="text-xs text-amber-700 flex items-start gap-1">
                <AlertCircle className="w-3 h-3 mt-0.5" />
                Fill in ZIP, city, and state to continue. Street address is optional.
              </div>
            )}

            {submitError && (
              <div className="text-xs text-rose-600 flex items-center justify-center gap-1">
                <AlertCircle className="w-3 h-3" /> {submitError}
              </div>
            )}
          </div>

          <WizardFooter onNext={handleNext} disabled={!ok || submitting} nextLabel="Continue" />
        </>
      )}
    </>
  );
}

// Default export so React.lazy() at the wizard mount site can pick this
// up directly without a re-import wrapper.
export default GarageLocation;
