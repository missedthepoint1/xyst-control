import { useEffect, useMemo, useState } from 'react';
import type { ComponentProps } from 'react';
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
import { CameraSettings } from './CameraSettings.js';
import { useApiBase } from '../hooks/useApiBase.js';
import { usePref } from '../hooks/usePref.js';
import { useViewAssist } from '../hooks/useViewAssist.js';
import { effectiveHidden } from '../panelVisibility.js';
import { DEFAULT_LOOK } from '../viewAssist.js';
import { buildOsd } from '../osdInfo.js';

const STATUS_LABEL: Record<string, string> = {
  connected: 'Connected', connecting: 'Connecting…', disconnected: 'Disconnected', error: 'Offline',
};

export function CameraPanel({ state, labels = true, onRename, dragHandleProps, dragItemProps, isOver }: {
  state: CameraState; labels?: boolean; onRename?: (name: string) => void;
  dragHandleProps?: ComponentProps<'button'>; dragItemProps?: ComponentProps<'section'>; isOver?: boolean;
}) {
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
  // Timecode visibility on panels — its own persisted pref, independent of the multiview popout.
  const [showTc, setShowTc] = usePref<boolean>('showTcPanels', true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // View-assist LUT on the live preview, per-camera, persisted in the profile.
  const hidden = effectiveHidden(state);
  const show = (cid: string, available?: boolean) => !!available && !hidden.has(cid);
  const resolvedVa = useViewAssist(state.ui);
  const vaEnabled = !!state.ui?.viewAssist?.enabled;
  const toggleViewAssist = () => {
    const base = { enabled: false, look: DEFAULT_LOOK, intensity: 1, ...state.ui?.viewAssist };
    window.xyst.setUiSettings(id, { ...(state.ui ?? {}), viewAssist: { ...base, enabled: !base.enabled } });
  };
  // Migrate the old localStorage LUT toggle into the profile (one-time per camera).
  useEffect(() => {
    if (!state.ui?.viewAssist && localStorage.getItem(`va:${id}`) === '1') {
      localStorage.removeItem(`va:${id}`);
      window.xyst.setUiSettings(id, { ...(state.ui ?? {}), viewAssist: { enabled: true, look: DEFAULT_LOOK, intensity: 1 } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const [lastFocus, setLastFocus] = useState<{ x: number; y: number } | null>(null);
  const apiBase = useApiBase();
  const hasVideo = !!state.video && state.video.type !== 'none';
  const label = state.name ?? state.model ?? id;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const startEdit = () => { setDraft(state.name ?? state.model ?? ''); setEditing(true); };
  const commitName = () => {
    setEditing(false);
    const v = draft.trim();
    if (v && v !== (state.name ?? '') && onRename) onRename(v);
  };

  // Camera-style OSD info rendered ON the live feed (built from discovered state). Memoised on
  // `state` so it isn't reallocated on unrelated re-renders (and stays a stable prop to VideoPanel).
  const osd = useMemo(() => buildOsd(state), [state]);

  return (
    <section className={`card panel${rec ? ' is-rec' : ''}${isOver ? ' is-drop' : ''}`} {...dragItemProps}>
      <VideoSourceSelect current={state.video} name={label} onChange={(v) => window.xyst.setVideoSource(id, v)} />
      <VideoPanel cameraId={id} source={state.video} recording={rec} apiBase={apiBase} osd={osd} showOsd={showOsd} showTc={showTc} viewAssist={resolvedVa} onFocus={(x, y) => setLastFocus({ x, y })} />
      {state.video && state.video.type !== 'none' && !hidden.has('focusPoints') && (
        <FocusPointBar cameraId={id} lastFocus={lastFocus} />
      )}
      <header className="panel__head">
        <div className="panel__head-left">
          {dragHandleProps && (
            <button type="button" className="drag-handle" title="Drag to reorder" {...dragHandleProps}>
              <svg viewBox="0 0 16 16" aria-hidden="true" className="grip-ic">
                <circle cx="5.5" cy="3.5" r="1.3" /><circle cx="10.5" cy="3.5" r="1.3" />
                <circle cx="5.5" cy="8" r="1.3" /><circle cx="10.5" cy="8" r="1.3" />
                <circle cx="5.5" cy="12.5" r="1.3" /><circle cx="10.5" cy="12.5" r="1.3" />
              </svg>
            </button>
          )}
          <div className="panel__titlewrap">
            {labels && (editing ? (
              <input className="panel__title-edit" autoFocus value={draft}
                onChange={(e) => setDraft(e.target.value)} onBlur={commitName}
                onKeyDown={(e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') setEditing(false); }} />
            ) : (
              <div className="panel__title" title="Click to rename" onClick={startEdit}>{label}</div>
            ))}
            <div className={`status status--${state.status}`} title={state.lastError || undefined}>
              <span className="dot" />
              {STATUS_LABEL[state.status] ?? state.status}
            </div>
            {(state.record.remainingMinutes !== undefined || state.power?.volt !== undefined) && (
              <div className="meta">
                {state.record.remainingMinutes !== undefined && <span>⏺ {state.record.remainingMinutes} min</span>}
                {state.record.media1 && <span>Card A: {state.record.media1 === 'recordable' ? 'ready' : '—'}</span>}
                {state.power?.volt !== undefined && <span>{state.power.percent !== undefined ? `${state.power.percent}%` : `${state.power.volt}V`}</span>}
              </div>
            )}
          </div>
        </div>
        <div className="panel__head-right">
          <button className="panel__remove" title="Remove camera" onClick={() => window.xyst.removeCamera(id)}>×</button>
          <div className="head-actions">
            {state.video?.type === 'protocol' && (
              <button type="button" className={`osd-btn${vaEnabled ? ' is-on' : ''}`}
                title="View assist: re-grade the log preview with the configured LUT (preview only — recording is unchanged)"
                onClick={toggleViewAssist}>
                <span className="ic" /> LUT
              </button>
            )}
            {hasVideo && (
              <button type="button" className={`osd-btn${showOsd ? ' is-on' : ''}`}
                title="Show camera info, face/eye boxes and focus guide on the live view"
                onClick={() => setShowOsd((s) => !s)}>
                <span className="ic" /> OSD
              </button>
            )}
            {hasVideo && showOsd && osd?.tc && (
              <button type="button" className={`osd-btn${showTc ? ' is-on' : ''}`}
                title="Show the running timecode on panels (separate from the multiview popout)"
                onClick={() => setShowTc(!showTc)}>
                <span className="ic" /> TC
              </button>
            )}
            <button type="button" className={`osd-btn icon-btn${settingsOpen ? ' is-on' : ''}`}
              title="Panel settings — LUT and which controls are shown"
              onClick={() => setSettingsOpen((o) => !o)} aria-label="Panel settings">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
              </svg>
            </button>
            <RecButton recording={rec} onToggle={() => window.xyst.record(id, !rec)} />
          </div>
        </div>
      </header>

      {settingsOpen && <CameraSettings state={state} onClose={() => setSettingsOpen(false)} />}

      <div className="controls">
        {show('iso', c.iso?.available) && <IsoControl c={c.iso!} onSet={(v) => set('iso', v)} />}
        {show('isoAuto', c.isoAuto?.available) && (
          <ControlSegment label="ISO mode" value={c.isoAuto!.value}
            options={segOpts(c.isoAuto, { auto: 'Auto', manual: 'Manual' })}
            onChange={(v) => set('isoAuto', v)} />
        )}
        {show('shutter', c.shutter?.available) && (
          <ShutterControl shutter={c.shutter!} angle={c.shutterAngle}
            onSetMode={(m) => set('shutterMode', m)}
            onSetSpeed={(v) => set('shutter', v)}
            onSetAngle={(v) => set('shutterAngle', v)} />
        )}
        {show('iris', c.iris?.available) && <IrisControl c={c.iris!} onSet={(v) => set('iris', v)} />}
        {show('wb', c.wb?.available) && (
          <WbControl
            wb={c.wb!} kelvin={c.wbKelvin}
            onSetWb={(v) => set('wb', v)} onSetKelvin={(v) => set('wbKelvin', v)}
          />
        )}
        {show('wbCC', c.wbCC?.available) && (
          <RangeStepper label="WB CC" value={typeof c.wbCC!.value === 'number' ? c.wbCC!.value : undefined}
            min={c.wbCC!.min ?? -20} max={c.wbCC!.max ?? 20}
            format={(n) => (n > 0 ? `+${n}` : String(n))} onChange={(v) => set('wbCC', v)} />
        )}
        {show('nd', c.nd?.available) && <NdControl c={c.nd!} onSet={(v) => set('nd', v)} />}
        {show('ndExtended', c.ndExtended?.available) && (
          <ControlSegment label="ND adv" value={c.ndExtended!.value}
            options={segOpts(c.ndExtended, { off: 'Off', on: 'On' })}
            onChange={(v) => set('ndExtended', v)} />
        )}
      </div>

      {(show('focus', c.focus?.available) || show('faceDetect', c.faceDetect?.available) || show('colorbar', c.colorbar?.available) || show('focusAction', c.focusAction?.available)) && (
        <div className="switches">
          {show('focus', c.focus?.available) && (
            <ControlSegment label="Focus" value={c.focus!.value}
              options={segOpts(c.focus, { auto: 'AF', manual: 'MF' })}
              onChange={(v) => set('focus', v)} />
          )}
          {show('faceDetect', c.faceDetect?.available) && (
            <ControlSegment label="Face" value={c.faceDetect!.value}
              options={segOpts(c.faceDetect, { off: 'Off', faceonly: 'Face', facecatch: 'Track' })}
              onChange={(v) => set('faceDetect', v)} />
          )}
          {show('colorbar', c.colorbar?.available) && (
            <ControlSegment label="Bars" value={c.colorbar!.value}
              options={segOpts(c.colorbar, { off: 'Off', on: 'On' })}
              onChange={(v) => set('colorbar', v)} />
          )}
          {show('focusAction', c.focusAction?.available) && (
            <FocusActions actions={c.focusAction!.list ?? []} onAction={(a) => set('focusAction', a)} />
          )}
        </div>
      )}

      {!hidden.has('advanced') && (c.afMode?.available || c.afSpeed?.available || c.afResponse?.available || c.afLock?.available || c.awbHold?.available || c.wbAction?.available) && (
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

      {!hidden.has('presets') && <PresetBar cameraId={state.id} presets={presets} />}
    </section>
  );
}
