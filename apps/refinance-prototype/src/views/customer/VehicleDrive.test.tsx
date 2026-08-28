// VehicleDrive (ScreenVehicleDrive) — the remittance lock on the odometer.
//
// blinker's lock is whole-record, not field-scoped: RemittanceLock installs a
// `before_update` that raises RemittedRecordError whenever
// `has_changes_to_save?` is true for ANY attribute
// (blinker/app/models/concerns/remittance_lock.rb:20,34). A mileage write on a
// remitted vehicle is rejected exactly like a VIN write, so the slider has to
// be read-only or the agent edits a value whose save is guaranteed to fail.
//
// The forms below carry no VIN and no year/make/model on purpose: the
// MarketCheck valuation effect bails out when both are absent
// (`if (!haveVin && !haveYmmt) return;`), which keeps these tests off the
// network.
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import { VehicleDrive } from './VehicleDrive';

// Minimal slice of INITIAL_FORM — only the fields ScreenVehicleDrive reads.
function baseForm(overrides = {}) {
  return {
    vin: '',
    year: null,
    make: '',
    model: '',
    trim: '',
    mileage: 62000,
    condition: 'Used',
    purchaseDate: null,
    zip: '',
    vehicle: null,
    valuationLoading: false,
    valuationError: null,
    valuationMarketCheckPrice: null,
    valuationRetailPrice: null,
    ...overrides,
  };
}

function renderScreen(overrides = {}, props: { locked?: boolean } = {}) {
  const box = { form: baseForm(overrides) };
  function Harness() {
    const [form, setForm] = useState(box.form);
    box.form = form;
    return (
      <VehicleDrive
        form={form}
        update={(patch) => setForm((f) => ({ ...f, ...patch }))}
        onNext={() => {}}
        orgVehicleDefaults={null}
        {...props}
      />
    );
  }
  render(<Harness />);
  return { read: () => box.form };
}

const slider = () => screen.getByRole('slider');

describe('ScreenVehicleDrive — remittance lock', () => {
  it('leaves the odometer slider editable by default', () => {
    renderScreen();

    expect(slider()).toBeEnabled();
  });

  it('renders the odometer slider read-only when locked, with the reason', () => {
    renderScreen({}, { locked: true });

    expect(slider()).toBeDisabled();
    expect(screen.getByText(/Locked — package remitted/)).toBeInTheDocument();
  });

  it('still shows the committed odometer reading', () => {
    renderScreen({ mileage: 62000 }, { locked: true });

    // The reading is echoed in more than one place on this screen (the badge
    // above the slider and the driving-estimate copy below it), so assert on
    // the slider's own value and on at least one rendered echo.
    expect(slider()).toHaveValue('62000');
    expect(screen.getAllByText('62,000').length).toBeGreaterThan(0);
  });

  it('does not seed a committed odometer over the org-config estimate', () => {
    // Unlocked, an untouched slider (still at MILEAGE_INITIAL_DEFAULT) gets
    // seeded from vehicle age. Locked, that write would be rejected by blinker,
    // so the seed must not fire even when the value looks untouched.
    const { read } = renderScreen({ mileage: 50000, year: 2015 }, { locked: true });

    expect(read().mileage).toBe(50000);
  });
});
