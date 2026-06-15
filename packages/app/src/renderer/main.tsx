import { createRoot } from 'react-dom/client';
import { useState, useEffect, type CSSProperties } from 'react';
import type { CameraState } from '@xyst/core';
import './theme.css';
import './app.css';
import { AppShell, type GridCols } from './components/AppShell.js';
import { CameraPanel } from './components/CameraPanel.js';
import { AddCameraForm } from './components/AddCameraForm.js';
import { Multiview } from './components/Multiview.js';
import { VideoPanel } from './components/VideoPanel.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { useCameras } from './hooks/useCameras.js';
import { useApiBase } from './hooks/useApiBase.js';
import { useOsd } from './hooks/useOsd.js';
import { buildOsd } from './osdInfo.js';
import { usePref } from './hooks/usePref.js';
import { useReorder } from './hooks/useReorder.js';

// A second window opened with ?popout=multiview renders just the fullscreen multiview.
const isPopout = new URLSearchParams(window.location.search).get('popout') === 'multiview';

// Per-feed quick controls overlaid on each popout tile — capability-gated focus mode (AF/MF).
function FeedControls({ s }: { s: CameraState }) {
  const c = s.controls;
  if (!c.focus?.available) return null;
  const set = (value: string) =>
    Promise.resolve().then(() => window.xyst.setControl(s.id, 'focus', value)).catch(() => {});
  return (
    <div className="feedctl">
      <div className="feedctl__seg">
        <button className={c.focus.value === 'auto' ? 'is-on' : ''} onClick={() => set('auto')}>AF</button>
        <button className={c.focus.value === 'manual' ? 'is-on' : ''} onClick={() => set('manual')}>MF</button>
      </div>
    </div>
  );
}

function PopoutMultiview() {
  const { states } = useCameras();
  const apiBase = useApiBase();
  const [osd, setOsd] = useOsd();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const idKey = [...states.map((s) => s.id)].sort().join('|');
  // Box count: how many feed tiles to show (1..8). 0 = auto (match the number of cameras).
  const [boxPref, setBoxPref] = useState(0);
  const boxCount = Math.min(8, boxPref || Math.max(states.length, 1));
  // Per-tile camera assignment; keep valid existing choices, fill new/invalid slots by cycling.
  const [assign, setAssign] = useState<string[]>([]);
  useEffect(() => {
    setAssign((prev) => Array.from({ length: boxCount }, (_, i) => {
      const cur = prev[i];
      if (cur && states.some((s) => s.id === cur)) return cur;
      return states[i % Math.max(states.length, 1)]?.id ?? '';
    }));
  }, [boxCount, idKey]);
  // Square grid so every cell is 16:9 inside the 16:9 window (feeds fill, no letterbox):
  // 1→1×1, 2-4→2×2, 5-8→3×3 (empty cells instead of black bars on every feed).
  const grid = boxCount <= 1 ? 1 : boxCount <= 4 ? 2 : 3;
  const cols = grid, rows = grid;
  return (
    <div className="popout" style={{ '--mv-cols': cols, '--mv-rows': rows } as CSSProperties}>
      <div className="popout-tools">
        <button type="button" className="popout-gear" aria-label="Multiview settings"
          onClick={() => setSettingsOpen((o) => !o)}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
          </svg>
        </button>
      </div>
      {settingsOpen && (
        <div className="popout-settings">
          <div className="cam-settings__title">Multiview settings</div>
          <label className="cam-settings__field">
            <span>Cameras</span>
            <select className="input" value={boxCount} onChange={(e) => setBoxPref(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n} {n === 1 ? 'camera' : 'cameras'}</option>)}
            </select>
          </label>
          <label className="cam-settings__row">
            <input type="checkbox" checked={osd} onChange={(e) => setOsd(e.target.checked)} />
            <span>Show OSD on all feeds</span>
          </label>
        </div>
      )}
      <div className="multiview multiview--popout">
        {assign.map((cid, i) => {
          const s = states.find((x) => x.id === cid);
          return (
            <div className="mvtile" key={i}>
              {s && (
                <VideoPanel cameraId={s.id} source={s.video} apiBase={apiBase}
                  recording={s.record.recording} showOsd={osd} osd={osd ? buildOsd(s) : undefined} />
              )}
              <select className="feedsel" value={cid} aria-label="Camera for this tile"
                onChange={(e) => setAssign((a) => a.map((x, j) => (j === i ? e.target.value : x)))}>
                {states.map((c) => <option key={c.id} value={c.id}>{c.name ?? c.model ?? c.id}</option>)}
              </select>
              {s && <FeedControls s={s} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function App() {
  const { states, refresh } = useCameras();
  const [view, setView] = usePref<'panels' | 'multiview'>('view', 'panels');
  const [single, setSingle] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [cols, setCols] = usePref<GridCols>('cols', 'full');
  const [labels, setLabels] = usePref<boolean>('labels', true);

  const selected = single ? states.find((s) => s.id === single) : undefined;
  const anyRec = states.some((s) => s.record.recording);
  const ids = states.map((s) => s.id);
  // Wrap IPC calls so a failure (e.g. a stale preload/main bundle that still lacks these
  // handlers) logs a clear error instead of white-screening the app via an unhandled throw.
  const commitOrder = (next: string[]) => {
    Promise.resolve().then(() => window.xyst.reorderCameras(next)).then(refresh)
      .catch((e) => console.error('reorderCameras failed', e));
  };
  const rename = (id: string, name: string) => {
    Promise.resolve().then(() => window.xyst.renameCamera(id, name))
      .catch((e) => console.error('renameCamera failed', e));
  };
  const { overId, handleProps, itemProps } = useReorder(ids, commitOrder);

  return (
    <AppShell
      view={view}
      onView={(v) => { setSingle(null); setView(v); }}
      cols={cols}
      onCols={setCols}
      labels={labels}
      onLabels={() => setLabels(!labels)}
      onAdd={() => setAdding(true)}
      recActive={anyRec}
      onToggleRec={() => window.xyst.recordAll(!anyRec)}
      onPopout={() => window.xyst.openMultiview()}
    >
      {selected ? (
        <div className="single">
          <button className="btn btn--ghost single__back" onClick={() => setSingle(null)}>← Multiview</button>
          <CameraPanel state={selected} labels={labels} onRename={(name) => rename(selected.id, name)} />
        </div>
      ) : view === 'multiview' ? (
        <Multiview states={states} labels={labels} onSelect={(id) => setSingle(id)} onReorder={commitOrder} onRename={rename} />
      ) : states.length === 0 ? (
        <div className="empty">
          <div className="empty__title">No cameras connected</div>
          <div className="empty__sub">Add a camera to start controlling it.</div>
          <button className="btn btn--accent" onClick={() => setAdding(true)}><span className="plus-ic">+</span> Add camera</button>
        </div>
      ) : (
        states.map((s) => (
          <CameraPanel key={s.id} state={s} labels={labels} onRename={(name) => rename(s.id, name)}
            dragHandleProps={handleProps(s.id)} dragItemProps={itemProps(s.id)} isOver={overId === s.id} />
        ))
      )}
      {adding && (
        <div className="modal" onClick={() => setAdding(false)}>
          <div className="modal__card" onClick={(e) => e.stopPropagation()}>
            <button className="modal__close" onClick={() => setAdding(false)} aria-label="Close">×</button>
            <AddCameraForm onAdded={() => { refresh(); setAdding(false); }} />
          </div>
        </div>
      )}
    </AppShell>
  );
}
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>{isPopout ? <PopoutMultiview /> : <App />}</ErrorBoundary>,
);
