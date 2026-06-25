import { useState } from 'react';
import type { CameraPreset, CameraState, CameraUiSettings } from '@xyst/core';
import { TOGGLEABLE, effectiveHidden } from '../panelVisibility.js';
import { BUILTIN_LOOKS, DEFAULT_LOOK } from '../viewAssist.js';

type ViewAssist = NonNullable<CameraUiSettings['viewAssist']>;

/** Per-camera customization popover: the live-view LUT and which control sections are shown. */
export function CameraSettings({ state, presets, onClose }: { state: CameraState; presets: CameraPreset[]; onClose: () => void }) {
  const id = state.id;
  const ui = state.ui ?? {};
  const save = (next: CameraUiSettings) => void window.xyst.setUiSettings(id, next);

  const hidden = effectiveHidden(state);
  const toggleControl = (cid: string) => {
    const set = new Set(hidden);
    if (set.has(cid)) set.delete(cid); else set.add(cid);
    save({ ...ui, hiddenControls: [...set] });
  };

  const va = ui.viewAssist;
  const base: ViewAssist = { enabled: false, look: DEFAULT_LOOK, intensity: 1, ...va };
  const setVa = (patch: Partial<ViewAssist>) => save({ ...ui, viewAssist: { ...base, ...patch } });
  const loadCube = async () => {
    const r = await window.xyst.importLut();
    if (r) setVa({ look: 'cube', cube: r, enabled: true });
  };

  const items = TOGGLEABLE.filter((it) => it.avail(state.controls));

  // Preset creation lives here (the panel only shows recall chips). Captures the current manual
  // exposure set under a name; recall happens from the chips on the panel. `presets` is passed down
  // from CameraPanel (which already subscribes) so we don't open a second subscription.
  const [presetName, setPresetName] = useState('');
  const [savingPreset, setSavingPreset] = useState(false);
  const savePreset = async () => {
    const label = presetName.trim() || `Preset ${presets.length + 1}`;
    setSavingPreset(true);
    try { await window.xyst.savePreset(id, label); setPresetName(''); }
    finally { setSavingPreset(false); }
  };

  return (
    <div className="cam-settings" role="dialog" aria-label="Camera panel settings">
      <div className="cam-settings__head">
        <span>Panel settings</span>
        <button type="button" className="cam-settings__close" onClick={onClose} aria-label="Close">×</button>
      </div>

      <section className="cam-settings__sec">
        <div className="cam-settings__title">View assist (live preview)</div>
        <label className="cam-settings__row">
          <input type="checkbox" checked={base.enabled} onChange={(e) => setVa({ enabled: e.target.checked })} />
          <span>Apply LUT to preview</span>
        </label>
        <label className="cam-settings__field">
          <span>Look</span>
          <select className="input" value={base.look} onChange={(e) => setVa({ look: e.target.value })}>
            {BUILTIN_LOOKS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            {va?.cube && <option value="cube">{va.cube.name}</option>}
          </select>
        </label>
        <div className="cam-settings__row">
          <button type="button" className="btn" onClick={loadCube}>{va?.cube ? 'Replace .cube…' : 'Load .cube…'}</button>
        </div>
        <label className="cam-settings__field">
          <span>Intensity {Math.round(base.intensity * 100)}%</span>
          <input type="range" min={0} max={100} value={Math.round(base.intensity * 100)}
            onChange={(e) => setVa({ intensity: Number(e.target.value) / 100 })} />
        </label>
      </section>

      <section className="cam-settings__sec">
        <div className="cam-settings__title">Presets</div>
        <div className="presets__row">
          <input className="input" value={presetName} placeholder="Preset name"
            onChange={(e) => setPresetName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void savePreset(); }} />
          <button type="button" className="btn" disabled={savingPreset} onClick={savePreset}>Save</button>
        </div>
        <div className="cam-settings__hint">
          {presets.length > 0
            ? `${presets.length} saved — recall from the chips on the panel.`
            : 'Saves the current exposure (ISO, shutter, iris, WB, ND) under a name.'}
        </div>
      </section>

      <section className="cam-settings__sec">
        <div className="cam-settings__title">Visible controls</div>
        {items.map((it) => (
          <label key={it.id} className="cam-settings__row">
            <input type="checkbox" checked={!hidden.has(it.id)} onChange={() => toggleControl(it.id)} />
            <span>{it.label}</span>
          </label>
        ))}
      </section>
    </div>
  );
}
