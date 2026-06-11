import type { ReactNode } from 'react';

export function AppShell({ children, view, onView, onRecAll, onStopAll }: {
  children: ReactNode; view: 'panels' | 'multiview'; onView: (v: 'panels' | 'multiview') => void;
  onRecAll: () => void; onStopAll: () => void;
}) {
  return (
    <div className="app">
      <header className="app__header">
        <div className="brand">
          <span className="brand__mark">XYST CONTROL</span>
          <span className="brand__sub">camera control</span>
        </div>
        <div className="toolbar">
          <div className="seg viewseg">
            <button className={`seg__btn${view === 'panels' ? ' is-active' : ''}`} onClick={() => onView('panels')}>Panels</button>
            <button className={`seg__btn${view === 'multiview' ? ' is-active' : ''}`} onClick={() => onView('multiview')}>Multiview</button>
          </div>
          <button className="btn btn--rec" onClick={onRecAll}><span className="dot" /> REC ALL</button>
          <button className="btn btn--ghost" onClick={onStopAll}><span className="sq" /> STOP ALL</button>
        </div>
      </header>
      <main className="app__body">{children}</main>
    </div>
  );
}
