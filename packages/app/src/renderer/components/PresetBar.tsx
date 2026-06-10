import { useState } from 'react';
import type { CameraPreset } from '@xyst/core';

export function PresetBar({ cameraId, presets }: { cameraId: string; presets: CameraPreset[] }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const label = name.trim() || `Preset ${presets.length + 1}`;
    setBusy(true);
    try { await window.xyst.savePreset(cameraId, label); setName(''); }
    finally { setBusy(false); }
  };

  return (
    <div className="presets">
      <div className="presets__row">
        <input
          className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Preset name"
        />
        <button className="btn" disabled={busy} onClick={save}>Save</button>
      </div>
      {presets.length > 0 && (
        <div className="chips">
          {presets.map((p) => (
            <span key={p.id} className="chip">
              <button className="chip__name" title="Recall"
                onClick={() => window.xyst.recallPreset(cameraId, p.id)}>{p.name}</button>
              <button className="chip__del" title="Delete"
                onClick={() => window.xyst.deletePreset(cameraId, p.id)}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
