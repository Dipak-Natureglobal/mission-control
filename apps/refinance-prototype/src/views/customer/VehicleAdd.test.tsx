// VehicleAdd (ScreenVehicleAdd) — YMMT cascade + VIN authority.
//
// These assert the MissionControl parity rules ported from
// MissionControl/src/features/refiApp/vehicle/plateVinForm.tsx:
//
//   * year → make → model is a strict cascade; each level is unreachable
//     until the one above it is set (MC `disableMake`/`disableModel`, :464-465)
//   * changing the year clears make/model/trim (MC :181-191)
//   * any VIN in the field freezes all three rows (MC `vinActive`, :463-465)
//   * editing the VIN blanks the YMMT the previous VIN produced (MC :166-172)
//
// No token is stubbed, so useYmmtOptions stays on the bundled fixture and
// nothing here touches the network.
import { beforeEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { VehicleAdd } from './VehicleAdd';

// Minimal slice of INITIAL_FORM — only the fields ScreenVehicleAdd reads.
function baseForm(overrides = {}) {
  return {
    vin: '',
    vinDecoded: false,
    vinDecodeLoading: false,
    vinDecodeError: null,
    year: null,
    make: '',
    model: '',
    trim: '',
    extraMakes: [],
    extraModels: [],
    extraTrims: [],
    trimCandidates: [],
    trimLookupLoading: false,
    _lastDecodedVin: null,
    ...overrides,
  };
}

// Renders the screen with real state so a pick() patch is observable the way
// the wizard applies it. `read()` hands the latest form back to the test.
function renderScreen(overrides = {}, props: { locked?: boolean } = {}) {
  const box = { form: baseForm(overrides) };
  function Harness() {
    const [form, setForm] = useState(box.form);
    box.form = form;
    return (
      <VehicleAdd
        form={form}
        update={(patch) => setForm((f) => ({ ...f, ...patch }))}
        onNext={() => {}}
        requireVin={false}
        {...props}
      />
    );
  }
  render(<Harness />);
  return { read: () => box.form };
}

// Same harness with NO requireVin prop at all — exercises the component's own
// default rather than the explicit `requireVin={false}` above.
function renderDefault(overrides = {}) {
  const box = { form: baseForm(overrides) };
  function Harness() {
    const [form, setForm] = useState(box.form);
    box.form = form;
    return (
      <VehicleAdd
        form={form}
        update={(patch) => setForm((f) => ({ ...f, ...patch }))}
        onNext={() => {}}
      />
    );
  }
  render(<Harness />);
  return { read: () => box.form };
}

// PickerField renders one button per row, labelled by its uppercase caption.
const row = (label: string) =>
  screen.getByRole('button', { name: new RegExp(`^${label}`, 'i') });

// Picks a value out of the open YmmtPicker modal. Option buttons are labelled
// by the bare value ("2015"), the rows behind them by caption + value
// ("Year 2020"), so an exact-name match is unambiguous.
function chooseInModal(value: string) {
  fireEvent.click(screen.getByRole('button', { name: value, exact: true }));
}

beforeEach(() => {
  localStorage.clear();
});

describe('ScreenVehicleAdd — YMMT cascade', () => {
  it('locks Make until a Year is picked, and Model until a Make is picked', () => {
    renderScreen();

    expect(row('Year')).toBeEnabled();
    expect(row('Make')).toBeDisabled();
    expect(row('Model')).toBeDisabled();
    expect(screen.getByText('Pick a year first')).toBeInTheDocument();
  });

  it('opens Make once a Year is set', () => {
    renderScreen({ year: 2020 });

    expect(row('Make')).toBeEnabled();
    expect(row('Model')).toBeDisabled();
    expect(screen.getByText('Pick a make first')).toBeInTheDocument();
  });

  it('clears make, model and trim when the year changes', () => {
    const { read } = renderScreen({
      year: 2020,
      make: 'Honda',
      model: 'Civic',
      trim: 'Ex',
      extraModels: ['Civic'],
      trimCandidates: ['Ex'],
    });

    fireEvent.click(row('Year'));
    chooseInModal('2015');

    expect(read()).toMatchObject({
      year: 2015,
      make: '',
      model: '',
      trim: '',
      extraModels: [],
      trimCandidates: [],
    });
  });

  it('clears model and trim when the make changes', () => {
    const { read } = renderScreen({ year: 2020, make: 'Honda', model: 'Civic', trim: 'Ex' });

    fireEvent.click(row('Make'));
    chooseInModal('Acura');

    expect(read()).toMatchObject({ make: 'Acura', model: '', trim: '' });
  });
});

describe('ScreenVehicleAdd — VIN authority', () => {
  it('freezes year, make and model while a VIN is present', () => {
    renderScreen({ vin: '1C4PJXAG9SW559532', year: 2020, make: 'Honda', model: 'Civic' });

    expect(row('Year')).toBeDisabled();
    expect(row('Make')).toBeDisabled();
    expect(row('Model')).toBeDisabled();
  });

  it('freezes them on a partial VIN too — not only a complete 17-character one', () => {
    renderScreen({ vin: '1C4PJ', year: 2020 });

    expect(row('Year')).toBeDisabled();
    expect(row('Make')).toBeDisabled();
  });

  it('does not clear a VIN + YMMT hand-off on mount', () => {
    const { read } = renderScreen({
      vin: '1C4PJXAG9SW559532',
      year: 2020,
      make: 'Jeep',
      model: 'Wrangler',
      trim: 'Sport',
    });

    expect(read()).toMatchObject({ year: 2020, make: 'Jeep', model: 'Wrangler', trim: 'Sport' });
  });

  it('blanks the YMMT the previous VIN produced when the VIN is edited', () => {
    const { read } = renderScreen({
      vin: '1C4PJXAG9SW559532',
      vinDecoded: true,
      _lastDecodedVin: '1C4PJXAG9SW559532',
      year: 2020,
      make: 'Jeep',
      model: 'Wrangler',
      trim: 'Sport',
      trimCandidates: ['Sport'],
    });

    fireEvent.change(screen.getByPlaceholderText(/^VIN /), {
      target: { value: '1C4PJXAG9SW55953' },
    });

    expect(read()).toMatchObject({
      year: null,
      make: '',
      model: '',
      trim: '',
      trimCandidates: [],
      vinDecoded: false,
      _lastDecodedVin: null,
    });
  });

  it('keeps the YMMT rows on screen after a decoded VIN is cleared', () => {
    renderScreen(
      { vin: '1C4PJXAG9SW559532', vinDecoded: true, _lastDecodedVin: '1C4PJXAG9SW559532', year: 2020, make: 'Jeep', model: 'Wrangler' },
      // requireVin is what used to unmount the whole block once the clear
      // effect blanked every YMMT field.
      { requireVin: true } as { requireVin?: boolean },
    );

    fireEvent.change(screen.getByPlaceholderText(/^VIN /), { target: { value: '' } });

    expect(row('Year')).toBeInTheDocument();
    expect(row('Year')).toBeEnabled();
  });
});

// requireVin defaults to false: refi standalone is VIN-or-YMMT. A consumer with
// no VIN must be able to finish the step on year/make/model/trim alone. The
// embedders that need the strict gate pass requireVin={true} themselves.
describe('ScreenVehicleAdd — VIN-or-YMMT default', () => {
  const cont = () => screen.getByRole('button', { name: /^Continue/i });

  it('shows every YMMT row with an empty VIN', () => {
    renderDefault();

    expect(row('Year')).toBeInTheDocument();
    expect(row('Make')).toBeInTheDocument();
    expect(row('Model')).toBeInTheDocument();
    expect(row('Trim')).toBeInTheDocument();
  });

  it('enables Continue on a complete YMMT with no VIN', () => {
    renderDefault({ year: 2020, make: 'Jeep', model: 'Wrangler', trim: 'Sport' });

    expect(screen.getByPlaceholderText(/^VIN /)).toHaveValue('');
    expect(cont()).toBeEnabled();
  });

  it('keeps Continue disabled until the trim is picked', () => {
    renderDefault({ year: 2020, make: 'Jeep', model: 'Wrangler' });

    expect(cont()).toBeDisabled();
    expect(screen.getByText('Trim is required to continue.')).toBeInTheDocument();
  });

  it('offers the trim sentinels so a YMMT-only vehicle is never a dead end', () => {
    const { read } = renderDefault({ year: 2020, make: 'Jeep', model: 'Wrangler' });

    fireEvent.click(row('Trim'));
    chooseInModal("I don't know");

    expect(read().trim).toBe("I don't know");
    expect(cont()).toBeEnabled();
  });
});

// The remittance lock: blinker freezes a Vehicle once a ProductPackage on it
// reaches `remitted` (Vehicle#remittance_locked?, app/models/vehicle.rb:264)
// and RemittanceLock raises RemittedRecordError on any write. The UI has to
// match, or the agent edits fields whose save is guaranteed to be rejected.
describe('ScreenVehicleAdd — remittance lock', () => {
  const remitted = {
    vin: '1C4PJXAG9SW559532',
    vinDecoded: true,
    _lastDecodedVin: '1C4PJXAG9SW559532',
    year: 2020,
    make: 'Jeep',
    model: 'Wrangler',
    trim: 'Sport',
  };

  it('renders VIN and every YMMT row read-only, with the reason', () => {
    renderScreen(remitted, { locked: true });

    expect(screen.getByPlaceholderText(/^VIN /)).toBeDisabled();
    expect(row('Year')).toBeDisabled();
    expect(row('Make')).toBeDisabled();
    expect(row('Model')).toBeDisabled();
    expect(row('Trim')).toBeDisabled();
    expect(screen.getByText(/Locked — package remitted/)).toBeInTheDocument();
  });

  it('still shows the committed vehicle values', () => {
    renderScreen(remitted, { locked: true });

    expect(row('Year')).toHaveTextContent('2020');
    expect(row('Make')).toHaveTextContent('Jeep');
    expect(row('Model')).toHaveTextContent('Wrangler');
    expect(row('Trim')).toHaveTextContent('Sport');
  });

  // A remitted package whose decode left `trim` blank. The trim picker is
  // disabled under the lock, so gating Continue on trim would dead-end the
  // screen: required, and unsettable.
  const remittedNoTrim = { ...remitted, trim: '' };

  it('enables Continue on a committed vehicle with no trim', () => {
    renderScreen(remittedNoTrim, { locked: true });

    expect(row('Trim')).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Continue/i })).toBeEnabled();
  });

  it('does not ask for a trim it will not let you pick', () => {
    renderScreen(remittedNoTrim, { locked: true });

    expect(screen.queryByText('Trim is required to continue.')).not.toBeInTheDocument();
  });

  it('does not blank the committed YMMT if the VIN somehow changes', () => {
    const { read } = renderScreen(remitted, { locked: true });

    // The input is disabled, so this cannot happen by hand — it guards the
    // clear effect against a programmatic form patch from the embedder.
    fireEvent.change(screen.getByPlaceholderText(/^VIN /), {
      target: { value: '1C4PJXAG9SW55953' },
    });

    expect(read()).toMatchObject({ year: 2020, make: 'Jeep', model: 'Wrangler', trim: 'Sport' });
  });
});
