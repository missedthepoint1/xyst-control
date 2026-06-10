import type { CameraState } from '@xyst/core';
import { RecButton } from './RecButton.js';
import { IsoControl } from './controls/IsoControl.js';
import { ShutterControl } from './controls/ShutterControl.js';
import { IrisControl } from './controls/IrisControl.js';
import { WbControl } from './controls/WbControl.js';
import { NdControl } from './controls/NdControl.js';
import { usePresets } from '../hooks/usePresets.js';
import { PresetBar } from './PresetBar.js';

export function CameraPanel({ state }: { state: CameraState }) {
  const id = state.id;
  const set = (control: string, value: string | number) =>
    window.xyst.setControl(id, control, value);
  const { presets } = usePresets(state.id);
  const rec = state.record.recording;

  return (
    <section className={`card panel${rec ? ' is-rec' : ''}`}>
      <header className="panel__head">
        <div>
          <div className="panel__title">{state.model ?? state.name ?? id}</div>
          <div className={`status status--${state.status}`}>
            <span className="dot" />
            {state.status}{state.lastError ? ` · ${state.lastError}` : ''}
          </div>
        </div>
        <RecButton recording={rec} onToggle={() => window.xyst.record(id, !rec)} />
      </header>

      <div className="controls">
        {state.controls.iso?.available && <IsoControl c={state.controls.iso} onSet={(v) => set('iso', v)} />}
        {state.controls.shutter?.available && <ShutterControl c={state.controls.shutter} onSet={(v) => set('shutter', v)} />}
        {state.controls.iris?.available && <IrisControl c={state.controls.iris} onSet={(v) => set('iris', v)} />}
        {state.controls.wb?.available && (
          <WbControl
            wb={state.controls.wb} kelvin={state.controls.wbKelvin}
            onSetWb={(v) => set('wb', v)} onSetKelvin={(v) => set('wbKelvin', v)}
          />
        )}
        {state.controls.nd?.available && <NdControl c={state.controls.nd} onSet={(v) => set('nd', v)} />}
      </div>
      <PresetBar cameraId={state.id} presets={presets} />
    </section>
  );
}
