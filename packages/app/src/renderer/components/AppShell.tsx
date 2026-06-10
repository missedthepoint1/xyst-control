import type { ReactNode } from 'react';

export function AppShell({ children, onRecAll, onStopAll }: {
  children: ReactNode; onRecAll: () => void; onStopAll: () => void;
}) {
  return (
    <div className="app">
      <header className="app__header">
        <div className="brand">
          <span className="brand__mark">XYST CONTROL</span>
          <span className="brand__sub">camera control</span>
        </div>
        <div className="toolbar">
          <button className="btn btn--rec" onClick={onRecAll}><span className="dot" /> REC ALL</button>
          <button className="btn btn--ghost" onClick={onStopAll}><span className="sq" /> STOP ALL</button>
        </div>
      </header>
      <main className="app__body">{children}</main>
    </div>
  );
}
