import type { ReactNode } from 'react';
import { THEMES, type ThemeName } from '../theme.js';

export type GridCols = 'full' | 'two' | 'quad';

export function AppShell({ children, view, onView, cols, onCols, labels, onLabels, onAdd, recActive, onToggleRec, onPopout, theme, onTheme }: {
  children: ReactNode; view: 'panels' | 'multiview'; onView: (v: 'panels' | 'multiview') => void;
  cols: GridCols; onCols: (c: GridCols) => void;
  labels: boolean; onLabels: () => void;
  onAdd: () => void; recActive: boolean; onToggleRec: () => void; onPopout?: () => void;
  theme?: ThemeName; onTheme?: (t: ThemeName) => void;
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
          {view === 'panels' && (
            <div className="seg seg--icons" title="Grid layout">
              <button className={`seg__btn${cols === 'full' ? ' is-active' : ''}`} onClick={() => onCols('full')} title="Full width">
                <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.6" /></svg>
              </button>
              <button className={`seg__btn${cols === 'two' ? ' is-active' : ''}`} onClick={() => onCols('two')} title="Two columns">
                <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="3" width="6" height="10" rx="1.4" /><rect x="8.5" y="3" width="6" height="10" rx="1.4" /></svg>
              </button>
              <button className={`seg__btn${cols === 'quad' ? ' is-active' : ''}`} onClick={() => onCols('quad')} title="Four-up — fit to screen, each panel scrolls">
                <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="1.5" width="6" height="6" rx="1.2" /><rect x="8.5" y="1.5" width="6" height="6" rx="1.2" /><rect x="1.5" y="8.5" width="6" height="6" rx="1.2" /><rect x="8.5" y="8.5" width="6" height="6" rx="1.2" /></svg>
              </button>
            </div>
          )}
          {view === 'multiview' && onPopout && (
            <button className="btn btn--icon" onClick={onPopout} title="Pop out fullscreen multiview">
              <svg viewBox="0 0 24 24" aria-hidden="true" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 4H5a1 1 0 0 0-1 1v4M15 4h4a1 1 0 0 1 1 1v4M9 20H5a1 1 0 0 1-1-1v-4M15 20h4a1 1 0 0 0 1-1v-4" />
              </svg>
            </button>
          )}
          <button className={`btn btn--icon${labels ? ' is-on' : ''}`} onClick={onLabels} title={labels ? 'Hide labels' : 'Show labels'}>
            <svg viewBox="0 0 24 24" aria-hidden="true" strokeLinejoin="round">
              <path d="M3 7a2 2 0 0 1 2-2h7l9 9-7 7-9-9V7Z" />
              <circle cx="7.5" cy="7.5" r="1.3" fill="currentColor" stroke="none" />
            </svg>
          </button>
          {onTheme && (
            <select className="theme-select" value={theme} onChange={(e) => onTheme(e.target.value as ThemeName)} title="Theme">
              {THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          )}
          <button className="btn btn--add" onClick={onAdd} title="Add camera"><span className="plus-ic">+</span> Add</button>
          <button className={`btn ${recActive ? 'btn--stop' : 'btn--rec'}`} onClick={onToggleRec}>
            {recActive ? <><span className="sq" /> STOP ALL</> : <><span className="dot" /> REC ALL</>}
          </button>
        </div>
      </header>
      <main className={`app__body${view === 'panels' && cols === 'quad' ? ' app__body--fit' : ''}`}>
        <div className={`app__grid${view === 'panels' ? ` app__grid--${cols}` : ''}`}>{children}</div>
      </main>
    </div>
  );
}
