import { createRoot } from 'react-dom/client';
function Boot() {
  return <div style={{ padding: 24 }}>XYST CONTROL — booting…</div>;
}
createRoot(document.getElementById('root')!).render(<Boot />);
