import { useState, type ReactNode } from 'react';
import type { CameraState } from '@xyst/core';
import { VideoPanel } from './VideoPanel.js';
import { useApiBase } from '../hooks/useApiBase.js';
import { useReorder } from '../hooks/useReorder.js';

export function Multiview({ states, labels = true, readOnly = false, tileExtra, onSelect, onReorder, onRename }: {
  states: CameraState[]; labels?: boolean; readOnly?: boolean;
  /** Optional overlay rendered inside each tile (e.g. per-feed quick controls in the popout). */
  tileExtra?: (s: CameraState) => ReactNode;
  onSelect: (id: string) => void;
  onReorder: (orderedIds: string[]) => void; onRename: (id: string, name: string) => void;
}) {
  const apiBase = useApiBase();
  const { overId, handleProps, itemProps } = useReorder(states.map((s) => s.id), onReorder);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  if (states.length === 0) return <div className="multiview__empty">No cameras. Switch to Panels to add one.</div>;

  const commit = (s: CameraState) => {
    setEditId(null);
    const v = draft.trim();
    if (v && v !== (s.name ?? '')) onRename(s.id, v);
  };

  return (
    <div className={`multiview${readOnly ? ' multiview--popout' : ''}`}>
      {states.map((s) => {
        const label = s.name ?? s.model ?? s.id;
        // Popout (read-only) tiles are display-only: keep the clean tile visuals (pass an empty
        // onSelect so VideoPanel stays in tile mode) but drop drag-reorder and rename.
        const tileProps = readOnly ? {} : itemProps(s.id);
        return (
          <div key={s.id} className={`mvtile${overId === s.id ? ' is-drop' : ''}`} {...tileProps}>
            <VideoPanel cameraId={s.id} source={s.video} apiBase={apiBase}
              recording={s.record.recording} onSelect={readOnly ? () => {} : () => onSelect(s.id)} />
            {tileExtra?.(s)}
            {!readOnly && (
              <button type="button" className="drag-handle mvtile__grip" title="Drag to reorder" {...handleProps(s.id)}>
                <svg viewBox="0 0 16 16" aria-hidden="true" className="grip-ic">
                  <circle cx="5.5" cy="3.5" r="1.3" /><circle cx="10.5" cy="3.5" r="1.3" />
                  <circle cx="5.5" cy="8" r="1.3" /><circle cx="10.5" cy="8" r="1.3" />
                  <circle cx="5.5" cy="12.5" r="1.3" /><circle cx="10.5" cy="12.5" r="1.3" />
                </svg>
              </button>
            )}
            {labels && (readOnly ? (
              <span className="mvtile__label">{label}</span>
            ) : editId === s.id ? (
              <input className="mvtile__edit" autoFocus value={draft}
                onChange={(e) => setDraft(e.target.value)} onBlur={() => commit(s)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => { if (e.key === 'Enter') commit(s); if (e.key === 'Escape') setEditId(null); }} />
            ) : (
              <button type="button" className="mvtile__label" title="Double-click to rename"
                onDoubleClick={() => { setDraft(s.name ?? s.model ?? ''); setEditId(s.id); }}>{label}</button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
