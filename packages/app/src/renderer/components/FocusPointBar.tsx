import { useState } from 'react';
import type { FocusPoint } from '@xyst/core';
import { useFocusPoints } from '../hooks/useFocusPoints.js';

export function FocusPointBar({ cameraId, lastFocus }: {
  cameraId: string; lastFocus: { x: number; y: number } | null;
}) {
  const { points } = useFocusPoints(cameraId);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!lastFocus) return;
    const label = name.trim() || `Focus ${points.length + 1}`;
    setBusy(true);
    try { await window.xyst.saveFocusPoint(cameraId, label, lastFocus.x, lastFocus.y); setName(''); }
    finally { setBusy(false); }
  };

  return (
    <div className="presets presets--fp">
      <div className="presets__row">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Focus point name" />
        <button className="btn" disabled={busy || !lastFocus} onClick={save} title={lastFocus ? '' : 'Tap the preview first'}>Save point</button>
      </div>
      {points.length > 0 && (
        <div className="chips">
          {points.map((p) => (
            <span key={p.id} className="chip">
              <button className="chip__name" title="Recall (rack focus here)" onClick={() => window.xyst.recallFocusPoint(cameraId, p.id)}>◎ {p.name}</button>
              <button className="chip__del" title="Delete" onClick={() => window.xyst.deleteFocusPoint(cameraId, p.id)}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
