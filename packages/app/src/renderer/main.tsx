import { createRoot } from 'react-dom/client';
import { useState, useEffect, type CSSProperties } from 'react';
import type { CameraState } from '@xyst/core';
import './theme.css';
import './app.css';
import { AppShell, type GridCols } from './components/AppShell.js';
import { CameraPanel } from './components/CameraPanel.js';
import { AddCameraForm } from './components/AddCameraForm.js';
import { Multiview } from './components/Multiview.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { useCameras } from './hooks/useCameras.js';
import { usePref } from './hooks/usePref.js';
import { useReorder } from './hooks/useReorder.js';

// A second window opened with ?popout=multiview renders just the fullscreen multiview.
const isPopout = new URLSearchParams(window.location.search).get('popout') === 'multiview';

// Per-feed quick controls overlaid on each popout tile — capability-gated focus mode (AF/MF)
// and a Track toggle (subject/face tracking), the Canon equivalents of the reference's AF/MF + Track.
function FeedControls({ s }: { s: CameraState }) {
  const c = s.controls;
  const set = (control: string, value: string) =>
    Promise.resolve().then(() => window.xyst.setControl(s.id, control, value)).catch(() => {});
  // The body's tracking value (e.g. ppl_catch / facecatch); fall back to the first non-off option.
  const list = (c.faceDetect?.list ?? []).map(String);
  const trackVal = list.find((v) => v.includes('catch')) ?? list.find((v) => v !== 'off');
  const tracking = c.faceDetect?.value != null && c.faceDetect.value !== 'off';
  if (!c.focus?.available && !(c.faceDetect?.available && trackVal)) return null;
  return (
    <div className="feedctl">
      {c.focus?.available && (
        <div className="feedctl__seg">
          <button className={c.focus.value === 'auto' ? 'is-on' : ''} onClick={() => set('focus', 'auto')}>AF</button>
          <button className={c.focus.value === 'manual' ? 'is-on' : ''} onClick={() => set('focus', 'manual')}>MF</button>
        </div>
      )}
      {c.faceDetect?.available && trackVal && (
        <div className="feedctl__seg">
          <button className={tracking ? 'is-on' : ''}
            onClick={() => set('faceDetect', tracking ? 'off' : trackVal)}>Track</button>
        </div>
      )}
    </div>
  );
}

function PopoutMultiview() {
  const { states } = useCameras();
  const cols = Math.max(1, Math.ceil(Math.sqrt(states.length || 1)));
  const anyRec = states.some((s) => s.record.recording);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') window.close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="popout" style={{ '--mv-cols': cols } as CSSProperties}>
      <header className="popout__bar">
        <div className="brand">
          <span className="brand__mark">XYST CONTROL</span>
          <span className="brand__sub">multiview</span>
        </div>
        <div className="popout__actions">
          <button className={`btn ${anyRec ? 'btn--stop' : 'btn--rec'}`} onClick={() => window.xyst.recordAll(!anyRec)}>
            {anyRec ? <><span className="sq" /> STOP ALL</> : <><span className="dot" /> REC ALL</>}
          </button>
          <button className="btn btn--ghost" onClick={() => window.close()} title="Exit fullscreen (Esc)">Exit ✕</button>
        </div>
      </header>
      <Multiview states={states} labels={false} readOnly
        tileExtra={(s) => (
          <>
            <span className="feedlabel">{s.name ?? s.model ?? s.id}</span>
            <FeedControls s={s} />
          </>
        )}
        onSelect={() => {}} onReorder={() => {}} onRename={() => {}} />
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
