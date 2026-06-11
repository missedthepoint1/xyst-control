import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import './theme.css';
import './app.css';
import { AppShell } from './components/AppShell.js';
import { CameraPanel } from './components/CameraPanel.js';
import { AddCameraForm } from './components/AddCameraForm.js';
import { Multiview } from './components/Multiview.js';
import { useCameras } from './hooks/useCameras.js';

function App() {
  const { states, refresh } = useCameras();
  const [view, setView] = useState<'panels' | 'multiview'>('panels');
  const [single, setSingle] = useState<string | null>(null);

  const selected = single ? states.find((s) => s.id === single) : undefined;

  return (
    <AppShell
      view={view}
      onView={(v) => { setSingle(null); setView(v); }}
      onRecAll={() => window.xyst.recordAll(true)}
      onStopAll={() => window.xyst.recordAll(false)}
    >
      {selected ? (
        <div className="single">
          <button className="btn btn--ghost single__back" onClick={() => setSingle(null)}>← Multiview</button>
          <CameraPanel state={selected} />
        </div>
      ) : view === 'multiview' ? (
        <Multiview states={states} onSelect={(id) => setSingle(id)} />
      ) : (
        <>
          {states.map((s) => <CameraPanel key={s.id} state={s} />)}
          <AddCameraForm onAdded={refresh} />
        </>
      )}
    </AppShell>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
