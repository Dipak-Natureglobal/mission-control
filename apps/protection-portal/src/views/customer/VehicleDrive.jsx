// Customer view · Step 2 — Vehicle Drive (mileage + new/used + purchase date).
//
// Wave-7 swap: body comes from refi-portal's VehicleDrive via the file: dep.
// Wave-7b reorder: GetRates dispatch moved to GarageLocation.jsx (needs form.state).
//
// Wave-13 / Wave-16-F3: a data-write useEffect calls getVehicleValue and persists
// the result at form.vehicle.market_value (canonical shape: { retail, trade_in,
// fetched_at, source }). That slot is consumed by ApiResponsesModal, agent overrides,
// and downstream analytics. The visual MarketCheckCard that previously rendered
// below refi's inherited card was removed in Wave 16 F3 — refi's card now handles
// both VIN and YMMT paths (F9-fu). One card renders (refi's); protection's data-write
// useEffect still populates the canonical slot.
//
// AgentView composes the same step list; the wrapper's behavior fires
// in both customer and agent personas.
import { useEffect, useRef } from 'react';
import { VehicleDrive as RefiVehicleDrive } from 'refi-portal/src/views/customer';
import { track } from 'blinker-platform/telemetry';
import { computeAnnualMileageEstimate } from 'blinker-platform/utils';
import { getVehicleValue } from '../../lib/marketcheck.js';
import orgRegistry from '../../constants/canon/org-registry.json';

const DEFAULT_VEHICLE_DEFAULTS = { annual_mileage_estimate: 12000 };

export function VehicleDrive({ form, update, onNext }) {
  // Resolve org-level vehicle defaults from canon; fall back to US benchmark.
  const orgVehicleDefaults =
    orgRegistry.orgs.find((o) => o.id === form.org_id)?.vehicle_defaults ||
    DEFAULT_VEHICLE_DEFAULTS;

  const viewedRef = useRef(false);
  const lastFetchKeyRef = useRef(null);
  const fetchTimerRef = useRef(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    track('protection.customer.vehicle_drive.viewed', {
      year: form.year,
      make: form.make,
      model: form.model,
      trim: form.trim,
    });
  }, [form.year, form.make, form.model, form.trim]);

  // MarketCheck fetch — fires when there's enough info (VIN OR YMMT) and
  // the input fingerprint changes. Debounced 400ms so dragging the
  // mileage slider doesn't spam the mock; deterministic by inputs so
  // the same vehicle never re-fetches under the same parameters.
  useEffect(() => {
    const vin = form.vehicle?.vin || form.vin || '';
    const haveEnough = (vin && vin.length >= 8) || (form.year && form.make && form.model);
    if (!haveEnough) return;

    const key = [
      vin,
      form.year ?? '',
      form.make ?? '',
      form.model ?? '',
      form.trim ?? '',
      form.mileage ?? '',
    ].join('|');
    if (key === lastFetchKeyRef.current) return;
    if (inFlightRef.current) return;

    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);

    update({ marketCheckLoading: true, marketCheckError: null });

    fetchTimerRef.current = setTimeout(async () => {
      inFlightRef.current = true;
      lastFetchKeyRef.current = key;
      try {
        const result = await getVehicleValue({
          vin,
          year: form.year,
          make: form.make,
          model: form.model,
          trim: form.trim,
          mileage: form.mileage,
        });
        if (!result) {
          update({ marketCheckLoading: false });
          return;
        }
        // Persist on the canonical slot — form.vehicle.market_value.
        // form.vehicle may be null pre-VehicleAdd-commit; in that case
        // we stash on a sibling slot so the data isn't lost when the
        // commit lands.
        const nextVehicle = {
          ...(form.vehicle || {}),
          year: form.year,
          make: form.make,
          model: form.model,
          trim: form.trim,
          vin: vin || null,
          market_value: {
            retail: result.retail_value,
            trade_in: result.trade_in_value,
            fetched_at: result.fetched_at,
            source: result.source,
          },
        };
        update({
          vehicle: nextVehicle,
          marketCheck: result, // raw response — surfaced in API Responses modal
          marketCheckLoading: false,
          marketCheckError: null,
        });
        track('protection.customer.vehicle_drive.market_check_fetched', {
          retail_value: result.retail_value,
          trade_in_value: result.trade_in_value,
          via: vin && vin.length >= 17 ? 'vin' : 'ymmt',
        });
      } catch (err) {
        update({
          marketCheckLoading: false,
          marketCheckError: err?.message || 'MarketCheck mock failed',
        });
        track('protection.customer.vehicle_drive.market_check_failed', {
          message: err?.message || 'unknown',
        });
      } finally {
        inFlightRef.current = false;
      }
    }, 400);

    return () => {
      if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.vin, form.year, form.make, form.model, form.trim, form.mileage]);

  useEffect(() => {
    const nextCondition = form.condition ? String(form.condition).toLowerCase() : null;
    const nextPurchaseDate = nextCondition === 'new' ? null : (form.purchaseDate || null);
    const currentCondition = form.vehicle?.condition ?? null;
    const currentPurchaseDate = form.vehicle?.purchase_date ?? null;
    if (nextCondition === currentCondition && nextPurchaseDate === currentPurchaseDate) return;
    if (nextCondition === null && currentCondition === null && nextPurchaseDate === currentPurchaseDate) return;
    update({
      vehicle: {
        ...(form.vehicle || {}),
        condition: nextCondition,
        purchase_date: nextPurchaseDate,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.condition, form.purchaseDate]);

  function handleNext() {
    // Compute annual_miles_estimate using the shared helper — same math the
    // screen shows, single source of truth.
    const annualMilesEstimate = computeAnnualMileageEstimate({
      currentMileage: form.mileage,
      vehicleYear: form.year,
      condition: form.condition,
      purchaseDate: form.purchaseDate,
    });

    track('protection.customer.vehicle_drive.continued', {
      mileage: form.mileage,
      condition: form.condition,
      purchase_date: form.purchaseDate || null,
      annual_miles_estimate: annualMilesEstimate,
      market_check_retail: form.vehicle?.market_value?.retail ?? null,
    });
    onNext();
  }

  return <RefiVehicleDrive form={form} update={update} onNext={handleNext} orgVehicleDefaults={orgVehicleDefaults} />;
}

// Default export so React.lazy() at the wizard mount site can pick this
// up directly without a re-import wrapper. Named export preserved for
// callers that use the named import (CustomerView's static path).
export default VehicleDrive;
