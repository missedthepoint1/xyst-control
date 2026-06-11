import type { ControlState } from '@xyst/core';
import type { CameraState } from '@xyst/core';
import { RecButton } from './RecButton.js';
import { IsoControl } from './controls/IsoControl.js';
import { ShutterControl } from './controls/ShutterControl.js';
import { IrisControl } from './controls/IrisControl.js';
import { WbControl } from './controls/WbControl.js';
import { NdControl } from './controls/NdControl.js';
import { ControlSegment } from './controls/ControlSegment.js';
import { usePresets } from '../hooks/usePresets.js';
import { PresetBar } from './PresetBar.js';

export function CameraPanel({ state }: { state: CameraState }) {
  const id = state.id;
  const set = (control: string, value: string | number) =>
    window.xyst.setControl(id, control, value);
  const c = state.controls;
  const segOpts = (ctl: ControlState | undefined, labels: Record<string, string>) =>
    (ctl?.list ?? []).map((v) => ({ value: v, label: labels[String(v)] ?? String(v) }));
  const { presets } = usePresets(state.id);
  const rec = state.record.recording;

  return (
    <section className={`card panel${rec ? ' is-rec' : ''}`}>
      <button className="panel__remove" title="Remove camera" onClick={() => window.xyst.removeCamera(id)}>×</button>
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
        {c.iso?.available && <IsoControl c={c.iso} onSet={(v) => set('iso', v)} />}
        {c.shutter?.available && (
          <ShutterControl shutter={c.shutter} angle={c.shutterAngle}
            onSetMode={(m) => set('shutterMode', m)}
            onSetSpeed={(v) => set('shutter', v)}
            onSetAngle={(v) => set('shutterAngle', v)} />
        )}
        {c.iris?.available && <IrisControl c={c.iris} onSet={(v) => set('iris', v)} />}
        {c.wb?.available && (
          <WbControl
            wb={c.wb} kelvin={c.wbKelvin}
            onSetWb={(v) => set('wb', v)} onSetKelvin={(v) => set('wbKelvin', v)}
          />
        )}
        {c.nd?.available && <NdControl c={c.nd} onSet={(v) => set('nd', v)} />}
      </div>

      {(c.focus?.available || c.faceDetect?.available || c.colorbar?.available) && (
        <div className="switches">
          {c.focus?.available && (
            <ControlSegment label="Focus" value={c.focus.value}
              options={segOpts(c.focus, { auto: 'AF', manual: 'MF' })}
              onChange={(v) => set('focus', v)} />
          )}
          {c.faceDetect?.available && (
            <ControlSegment label="Face" value={c.faceDetect.value}
              options={segOpts(c.faceDetect, { off: 'Off', faceonly: 'Face', facecatch: 'Track' })}
              onChange={(v) => set('faceDetect', v)} />
          )}
          {c.colorbar?.available && (
            <ControlSegment label="Bars" value={c.colorbar.value}
              options={segOpts(c.colorbar, { off: 'Off', on: 'On' })}
              onChange={(v) => set('colorbar', v)} />
          )}
        </div>
      )}

      <PresetBar cameraId={state.id} presets={presets} />
    </section>
  );
}
