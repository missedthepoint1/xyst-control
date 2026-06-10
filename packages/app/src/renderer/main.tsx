import { createRoot } from 'react-dom/client';
import './theme.css';
import './app.css';
import { AppShell } from './components/AppShell.js';
import { CameraPanel } from './components/CameraPanel.js';
import { AddCameraForm } from './components/AddCameraForm.js';
import { useCameras } from './hooks/useCameras.js';

function App() {
  const { states, refresh } = useCameras();
  return (
    <AppShell
      onRecAll={() => window.xyst.recordAll(true)}
      onStopAll={() => window.xyst.recordAll(false)}
    >
      {states.map((s) => <CameraPanel key={s.id} state={s} />)}
      <AddCameraForm onAdded={refresh} />
    </AppShell>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
