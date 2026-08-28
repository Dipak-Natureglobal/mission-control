// DEV CONTROLS sidebar — the standalone (App.jsx) variant.
//
// The chrome (dark sidebar, Section, Segmented, JsonPeek) comes from
// blinker-platform/components. The workflow knobs live in
// HomeProtectionDevControls.jsx so the embed-friendly variant stays in
// sync — this file owns ONLY the two sections that make no sense when
// AgentView is embedded inside mission-control's CoPilotPane (mc owns view
// switching and its own payload mirror).
import { DevPanel, Section, Segmented, JsonPeek } from 'blinker-platform/components';
import { VIEW_KEYS } from './ViewSwitcher.jsx';
import { HomeProtectionDevControls } from './HomeProtectionDevControls.jsx';

export function DevControls({
  open,
  view,
  setView,
  packageState,
  devOptions,
  setDevOptions,
  form,
  updateForm,
  persona = 'agent',
}) {
  return (
    <DevPanel open={open}>
      <Section label="View">
        <Segmented
          value={view}
          onChange={setView}
          options={VIEW_KEYS.map((v) => ({ v, l: v[0].toUpperCase() + v.slice(1) }))}
        />
        <p className="text-xs text-slate-500 mt-2 leading-snug">
          Mirrors <span className="font-mono">?view=</span> in the URL.
        </p>
      </Section>

      <HomeProtectionDevControls
        devOptions={devOptions}
        setDevOptions={setDevOptions}
        form={form}
        updateForm={updateForm}
        persona={persona}
      />

      <Section label="Package state">
        <JsonPeek label="home_protection · phase 1" data={packageState} />
      </Section>
    </DevPanel>
  );
}
