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
    <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={name} onChange={(e) => setName(e.target.value)} placeholder="Preset name"
          style={{ flex: 1, background: 'var(--surface-2)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}
        />
        <button className="btn" disabled={busy} onClick={save}>Save</button>
      </div>
      {presets.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {presets.map((p) => (
            <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              borderRadius: 999, padding: '4px 6px 4px 12px' }}>
              <button className="btn--ghost" style={{ border: 'none', padding: 0, background: 'none' }}
                title="Recall" onClick={() => window.xyst.recallPreset(cameraId, p.id)}>{p.name}</button>
              <button className="btn--ghost" title="Delete"
                style={{ border: 'none', padding: '0 4px', background: 'none', color: 'var(--muted)' }}
                onClick={() => window.xyst.deletePreset(cameraId, p.id)}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
