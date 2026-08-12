// Customer view · Step 2 — Vehicle Drive (mileage + new/used + purchase date).
//
// Insurance-portal wrapper around refi-portal's VehicleDrive body. Mirrors
// the parallel wrapper at protection-portal/src/views/customer/VehicleDrive.jsx
// per ADR 21 D1 — both wrappers share the same body (refi-portal's
// ScreenVehicleDrive) but diverge on side-effects:
//
//   protection: writes form.vehicle.market_value via MarketCheck + fires
//               protection.* telemetry.
//   insurance (this file): NO MarketCheck — insurance doesn't need
//               vehicle.market_value. Persists the same canonical fields
//               on workflow.vehicle and fires insurance.* telemetry.
//
// Canonical vehicle slot written by this wrapper:
//   workflow.vehicle.{vin, year, make, model, trim,
//                     mileage, condition, purchase_date,
//                     annual_miles_estimate}
//
// annual_miles_estimate is an EI underwriting input — the quote-fire in
// GettingQuote is gated behind mileage being set (ADR 21 D2).
//
// YMMT/VIN pre-known from the lead payload; the step header shows
// "GETTING TO KNOW YOUR {year make model trim}" (rendered by refi's body).
//
// Form shape note: refi's ScreenVehicleDrive reads flat keys from `form`
// (year, make, model, trim, vin, mileage, condition, purchaseDate, vehicle)
// and writes back via `update(patch)`. Insurance stores canonical vehicle
// data on workflow.vehicle. This wrapper maintains a local React state
// (`form`) that refi's controlled inputs drive, and syncs the mileage /
// condition / purchase_date fields through to workflow.vehicle on each
// change and on final commit.
//
// mode prop (Wave 31a-fu):
//   'workflow' (default) — writes directly to workflow.vehicle via
//     updateWorkflow. Props: workflow, updateWorkflow, onNext.
//     Used by: customer simulator flow (CustomerView).
//   'local' — does NOT write to workflow. Instead accepts an externalForm +
//     externalUpdate pair (refi-style flat), manages internal form state
//     seeded from the vehicle prop, and calls onCommit(driveData) with the
//     final { mileage, condition, purchase_date, annual_miles_estimate } on
//     next. Props: vehicle (seed), onCommit, onNext, persona.
//     Used by: AgentView pre-send wizard (collectedVehicle state).
//
// analyticsContext prop (Wave 31a-fu):
//   'customer' (default) — fires insurance.customer.vehicle_drive.* events.
//   'agent'             — fires insurance.agent.vehicle_drive.* events.
//   Prevents double-emission when the same wrapper is invoked from two
//   different contexts.
import { useEffect, useRef, useState } from 'react';
import { VehicleDrive as RefiVehicleDrive } from 'refi-portal/src/views/customer';
import { captureEvent } from 'blinker-platform/telemetry';
import { computeAnnualMileageEstimate } from 'blinker-platform/utils';
import orgRegistry from '../../constants/canon/org-registry.json';

const DEFAULT_VEHICLE_DEFAULTS = { annual_mileage_estimate: 12000 };

export function VehicleDrive({
  // workflow mode props (default)
  workflow,
  updateWorkflow,
  // local mode props (agent pre-send wizard)
  vehicle: vehicleProp,
  onCommit,
  persona,
  // shared
  onNext,
  mode = 'workflow',
  analyticsContext = 'customer',
}) {
  const isLocal = mode === 'local';

  // Resolve the seed vehicle: in workflow mode it comes from workflow.vehicle;
  // in local mode it comes from the vehicleProp (collectedVehicle from AgentView).
  const vehicle = isLocal ? (vehicleProp || {}) : (workflow?.vehicle || {});

  // Resolve org-level vehicle defaults from canon; fall back to US benchmark.
  const orgId = isLocal ? null : workflow?.orgId;
  const orgVehicleDefaults =
    orgRegistry.orgs?.find((o) => o.id === orgId)?.vehicle_defaults ||
    DEFAULT_VEHICLE_DEFAULTS;

  // Local form state bridging insurance's workflow.vehicle shape into the
  // flat structure refi's ScreenVehicleDrive controlled inputs expect.
  // Seeded from the resolved vehicle so back-navigation pre-populates.
  const [form, setForm] = useState(() => ({
    year:         vehicle.year         ?? null,
    make:         vehicle.make         ?? '',
    model:        vehicle.model        ?? '',
    trim:         vehicle.trim         ?? '',
    vin:          vehicle.vin          ?? '',
    mileage:      vehicle.mileage      ?? 50000,  // matches refi MILEAGE_INITIAL_DEFAULT; seed effect replaces with age-based estimate
    condition:    vehicle.condition    ?? null,
    purchaseDate: vehicle.purchase_date ?? null,
    // vehicle sub-object (refi reads form.vehicle.annual_mileage_estimate
    // in its internal useEffect; we keep it in sync below).
    vehicle: vehicle,
    // Wave 31a-fu3 — MarketCheck valuation fields written by refi's
    // ScreenVehicleDrive via update(). Captured here so handleNext can
    // fold them into driveData → mc left rail.
    valuationMarketCheckPrice: null,
    valuationRetailPrice: null,
    valuationLoading: false,
    valuationError: null,
  }));

  // update() called by refi's controlled inputs — patches local form state.
  // A companion useEffect syncs the drive-step fields through to
  // workflow.vehicle after each render where form changes — separating the
  // state update from the side-effect so React's strict-mode double-invoke
  // of the setState updater function doesn't call updateWorkflow twice.
  function update(patch) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  // Sync drive fields → workflow.vehicle whenever form changes.
  // Skipped in local mode — agent state is committed once on onNext only.
  // Condition + purchaseDate: canonicalize casing + null out purchase_date
  // when condition = 'new'.
  // Using individual primitives in the dep array (not the form object) so
  // the effect only fires when user input actually changes these fields.
  const { mileage, condition, purchaseDate, vin } = form;
  useEffect(() => {
    if (isLocal) return;
    const nextCondition = condition ? String(condition).toLowerCase() : null;
    const nextPurchaseDate = nextCondition === 'new' ? null : (purchaseDate || null);
    updateWorkflow({
      vehicle: {
        ...vehicle,
        vin:           vin   || vehicle.vin   || null,
        year:          form.year  ?? vehicle.year  ?? null,
        make:          form.make  || vehicle.make  || null,
        model:         form.model || vehicle.model || null,
        trim:          form.trim  || vehicle.trim  || null,
        mileage:       mileage ?? null,
        condition:     nextCondition,
        purchase_date: nextPurchaseDate,
        // annual_miles_estimate written on onNext (needs final values).
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mileage, condition, purchaseDate, vin]);

  const viewedRef = useRef(false);
  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    if (analyticsContext === 'agent') {
      captureEvent('insurance.agent.vehicle_drive.viewed', {
        persona: persona || null,
        vin:   vehicle.vin   || null,
        year:  vehicle.year  || null,
        make:  vehicle.make  || null,
        model: vehicle.model || null,
        trim:  vehicle.trim  || null,
      });
    } else {
      captureEvent('insurance.customer.vehicle_drive.viewed', {
        workflow_id: workflow?.lead?.leadId || null,
        vin:   vehicle.vin   || null,
        year:  vehicle.year  || null,
        make:  vehicle.make  || null,
        model: vehicle.model || null,
        trim:  vehicle.trim  || null,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleNext() {
    const annualMilesEstimate = computeAnnualMileageEstimate({
      currentMileage: form.mileage,
      vehicleYear:    form.year ?? vehicle.year,
      condition:      form.condition,
      purchaseDate:   form.purchaseDate,
    });

    const nextCondition = form.condition ? String(form.condition).toLowerCase() : null;
    const nextPurchaseDate = nextCondition === 'new' ? null : (form.purchaseDate || null);

    if (isLocal) {
      // Local mode: call onCommit with the drive-step fields only.
      // AgentView merges these onto collectedVehicle.
      //
      // Wave 31a-fu3 — include market_value when MarketCheck resolved.
      // Canonical shape mirrors protection-portal VehicleDrive.jsx lines 91-103:
      //   retail    ← valuationRetailPrice
      //   trade_in  ← valuationMarketCheckPrice  (refi's "marketcheck_price" = trade-in estimate)
      // Null when MarketCheck didn't resolve (loading, error, or not triggered).
      const hasValuation = !form.valuationLoading
        && !form.valuationError
        && form.valuationMarketCheckPrice != null;
      const marketValue = hasValuation
        ? {
            retail:     form.valuationRetailPrice ?? null,
            trade_in:   form.valuationMarketCheckPrice,
            fetched_at: new Date().toISOString(),
            source:     'marketcheck',
          }
        : null;

      const driveData = {
        mileage:               form.mileage ?? null,
        condition:             nextCondition,
        purchase_date:         nextPurchaseDate,
        annual_miles_estimate: annualMilesEstimate,
        market_value:          marketValue,
      };
      captureEvent('insurance.agent.vehicle_drive.committed', {
        persona:               persona || null,
        mileage:               driveData.mileage,
        condition:             driveData.condition,
        purchase_date:         driveData.purchase_date,
        annual_miles_estimate: driveData.annual_miles_estimate,
        has_market_value:      hasValuation,
      });
      onCommit(driveData);
      onNext();
      return;
    }

    // Workflow mode: final write — commit annual_miles_estimate alongside all other fields.
    updateWorkflow({
      vehicle: {
        ...vehicle,
        vin:                   form.vin   || vehicle.vin   || null,
        year:                  form.year  ?? vehicle.year  ?? null,
        make:                  form.make  || vehicle.make  || null,
        model:                 form.model || vehicle.model || null,
        trim:                  form.trim  || vehicle.trim  || null,
        mileage:               form.mileage ?? null,
        condition:             nextCondition,
        purchase_date:         nextPurchaseDate,
        annual_miles_estimate: annualMilesEstimate,
      },
    });

    captureEvent('insurance.customer.vehicle_drive.continued', {
      workflow_id:           workflow?.lead?.leadId || null,
      mileage:               form.mileage,
      condition:             nextCondition,
      purchase_date:         nextPurchaseDate,
      annual_miles_estimate: annualMilesEstimate,
    });

    onNext();
  }

  return (
    <RefiVehicleDrive
      form={form}
      update={update}
      onNext={handleNext}
      orgVehicleDefaults={orgVehicleDefaults}
    />
  );
}

export default VehicleDrive;
