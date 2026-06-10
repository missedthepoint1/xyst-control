import type { ReactNode } from 'react';

export function AppShell({ children, onRecAll, onStopAll }: {
  children: ReactNode; onRecAll: () => void; onStopAll: () => void;
}) {
  return (
    <div className="app">
      <header className="app__header">
        <span className="app__title">XYST CONTROL</span>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" onClick={onRecAll}>● REC ALL</button>
          <button className="btn btn--ghost" onClick={onStopAll}>■ STOP ALL</button>
        </div>
      </header>
      <main className="app__body">{children}</main>
    </div>
  );
}
