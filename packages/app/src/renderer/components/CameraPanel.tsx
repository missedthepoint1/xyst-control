import { useState } from 'react';
import type { ControlState } from '@xyst/core';
import type { CameraState } from '@xyst/core';
import { RecButton } from './RecButton.js';
import { IsoControl } from './controls/IsoControl.js';
import { ShutterControl } from './controls/ShutterControl.js';
import { IrisControl } from './controls/IrisControl.js';
import { WbControl } from './controls/WbControl.js';
import { NdControl } from './controls/NdControl.js';
import { ControlSegment } from './controls/ControlSegment.js';
import { RangeStepper } from './controls/RangeStepper.js';
import { FocusActions } from './controls/FocusActions.js';
import { usePresets } from '../hooks/usePresets.js';
import { PresetBar } from './PresetBar.js';
import { VideoPanel } from './VideoPanel.js';
import { FocusPointBar } from './FocusPointBar.js';
import { VideoSourceSelect } from './VideoSourceSelect.js';
import { useApiBase } from '../hooks/useApiBase.js';

export function CameraPanel({ state }: { state: CameraState }) {
  const id = state.id;
  const set = (control: string, value: string | number) =>
    window.xyst.setControl(id, control, value);
  const c = state.controls;
  const segOpts = (ctl: ControlState | undefined, labels: Record<string, string>) =>
    (ctl?.list ?? []).map((v) => ({ value: v, label: labels[String(v)] ?? String(v) }));
  const { presets } = usePresets(state.id);
  const rec = state.record.recording;
  const [advanced, setAdvanced] = useState(false);
  const [showOsd, setShowOsd] = useState(true);
  const [lastFocus, setLastFocus] = useState<{ x: number; y: number } | null>(null);
  const apiBase = useApiBase();
  const hasVideo = !!state.video && state.video.type !== 'none';

  // Camera-style OSD info rendered ON the live feed (built from discovered state).
  const n = (v: unknown) => (typeof v === 'number' ? v : undefined);
  const wbLabels: Record<string, string> = { auto: 'AWB', manual: 'WB Set', wb_a: 'WB A', wb_b: 'WB B', daylight: 'Daylight', tungsten: 'Tungsten', kelvin: 'Kelvin' };
  const osd = {
    iso: c.iso?.value != null ? `ISO ${c.iso.value}`
       : n(c.gain?.value) != null ? `${(n(c.gain!.value)! / 10).toFixed(1)}dB` : undefined,
    shutter: c.shutter?.available
      ? (c.shutter.mode === 'angle' && n(c.shutterAngle?.value) != null
          ? `${Math.round(n(c.shutterAngle!.value)! / 100)}°`
          : c.shutter.value != null ? `1/${c.shutter.value}` : undefined)
      : undefined,
    iris: n(c.iris?.value) != null ? `f/${(n(c.iris!.value)! / 100).toFixed(1)}` : undefined,
    wb: c.wb?.value === 'kelvin'
      ? (n(c.wbKelvin?.value) != null ? `${c.wbKelvin!.value}K` : 'Kelvin')
      : typeof c.wb?.value === 'string' ? (wbLabels[c.wb.value] ?? c.wb.value) : undefined,
    nd: n(c.nd?.value) != null ? (n(c.nd!.value)! > 0 ? `ND ${+(Math.log2(n(c.nd!.value)! / 100)).toFixed(1)}` : 'ND Off') : undefined,
    rec,
    remaining: state.record.remainingMinutes,
    battery: state.power?.percent != null ? `${state.power.percent}%`
           : state.power?.volt != null ? `${state.power.volt}V` : undefined,
  };

  return (
    <section className={`card panel${rec ? ' is-rec' : ''}`}>
      <VideoSourceSelect current={state.video} name={state.model ?? state.name ?? id} onChange={(v) => window.xyst.setVideoSource(id, v)} />
      <VideoPanel cameraId={id} source={state.video} recording={rec} apiBase={apiBase} osd={osd} showOsd={showOsd} onFocus={(x, y) => setLastFocus({ x, y })} />
      {state.video && state.video.type !== 'none' && (
        <FocusPointBar cameraId={id} lastFocus={lastFocus} />
      )}
      <header className="panel__head">
        <div>
          <div className="panel__title">{state.model ?? state.name ?? id}</div>
          <div className={`status status--${state.status}`}>
            <span className="dot" />
            {state.status}{state.lastError ? ` · ${state.lastError}` : ''}
          </div>
          {(state.record.remainingMinutes !== undefined || state.power?.volt !== undefined) && (
            <div className="meta">
              {state.record.remainingMinutes !== undefined && <span>⏺ {state.record.remainingMinutes} min</span>}
              {state.record.media1 && <span>Card A: {state.record.media1 === 'recordable' ? 'ready' : '—'}</span>}
              {state.power?.volt !== undefined && <span>{state.power.percent !== undefined ? `${state.power.percent}%` : `${state.power.volt}V`}</span>}
            </div>
          )}
        </div>
        <div className="panel__head-right">
          <button className="panel__remove" title="Remove camera" onClick={() => window.xyst.removeCamera(id)}>×</button>
          <div className="head-actions">
            {hasVideo && (
              <button type="button" className={`osd-btn${showOsd ? ' is-on' : ''}`}
                title="Show camera info, face/eye boxes and focus guide on the live view"
                onClick={() => setShowOsd((s) => !s)}>
                <span className="ic" /> OSD
              </button>
            )}
            <RecButton recording={rec} onToggle={() => window.xyst.record(id, !rec)} />
          </div>
        </div>
      </header>

      <div className="controls">
        {c.iso?.available && <IsoControl c={c.iso} onSet={(v) => set('iso', v)} />}
        {c.isoAuto?.available && (
          <ControlSegment label="ISO mode" value={c.isoAuto.value}
            options={segOpts(c.isoAuto, { auto: 'Auto', manual: 'Manual' })}
            onChange={(v) => set('isoAuto', v)} />
        )}
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
        {c.wbCC?.available && (
          <RangeStepper label="WB CC" value={typeof c.wbCC.value === 'number' ? c.wbCC.value : undefined}
            min={c.wbCC.min ?? -20} max={c.wbCC.max ?? 20}
            format={(n) => (n > 0 ? `+${n}` : String(n))} onChange={(v) => set('wbCC', v)} />
        )}
        {c.nd?.available && <NdControl c={c.nd} onSet={(v) => set('nd', v)} />}
        {c.ndExtended?.available && (
          <ControlSegment label="ND adv" value={c.ndExtended.value}
            options={segOpts(c.ndExtended, { off: 'Off', on: 'On' })}
            onChange={(v) => set('ndExtended', v)} />
        )}
      </div>

      {(c.focus?.available || c.faceDetect?.available || c.colorbar?.available || c.focusAction?.available) && (
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
          {c.focusAction?.available && (
            <FocusActions actions={c.focusAction.list ?? []} onAction={(a) => set('focusAction', a)} />
          )}
        </div>
      )}

      {(c.afMode?.available || c.afSpeed?.available || c.afResponse?.available || c.afLock?.available || c.awbHold?.available || c.wbAction?.available) && (
        <div className="advanced">
          <button type="button" className="advanced__toggle" onClick={() => setAdvanced((a) => !a)}>
            {advanced ? '▾' : '▸'} Advanced
          </button>
          {advanced && (
            <div className="advanced__body">
              {c.afMode?.available && (
                <ControlSegment label="AF mode" value={c.afMode.value}
                  options={segOpts(c.afMode, { continuous: 'Continuous', afboosted: 'Boosted' })}
                  onChange={(v) => set('afMode', v)} />
              )}
              {c.afSpeed?.available && (
                <RangeStepper label="AF speed" value={typeof c.afSpeed.value === 'number' ? c.afSpeed.value : undefined}
                  min={c.afSpeed.min ?? -7} max={c.afSpeed.max ?? 2} onChange={(v) => set('afSpeed', v)} />
              )}
              {c.afResponse?.available && (
                <RangeStepper label="AF resp" value={typeof c.afResponse.value === 'number' ? c.afResponse.value : undefined}
                  min={c.afResponse.min ?? -3} max={c.afResponse.max ?? 3} onChange={(v) => set('afResponse', v)} />
              )}
              {c.afLock?.available && (
                <ControlSegment label="AF lock" value={c.afLock.value}
                  options={segOpts(c.afLock, { off: 'Off', on: 'On' })}
                  onChange={(v) => set('afLock', v)} />
              )}
              {c.awbHold?.available && (
                <ControlSegment label="AWB hold" value={c.awbHold.value}
                  options={segOpts(c.awbHold, { off: 'Off', on: 'On' })}
                  onChange={(v) => set('awbHold', v)} />
              )}
              {c.wbAction?.available && (
                <label className="ctl">
                  <span className="ctl__label">Set WB</span>
                  <div className="actions">
                    <button type="button" className="act" onClick={() => set('wbAction', 'one_shot_a')}>Set A</button>
                    <button type="button" className="act" onClick={() => set('wbAction', 'one_shot_b')}>Set B</button>
                  </div>
                </label>
              )}
            </div>
          )}
        </div>
      )}

      <PresetBar cameraId={state.id} presets={presets} />
    </section>
  );
}
