import { useState } from 'react';
import type { DragEvent } from 'react';

/**
 * Native HTML5 drag-and-drop reordering. Dragging is started only from the handle
 * (handleProps), while the whole item is a drop target (itemProps) — so it never
 * conflicts with clicks/taps on the item body. On drop it commits the new id order.
 */
export function useReorder(ids: string[], onCommit: (orderedIds: string[]) => void) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const handleProps = (id: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      setDragId(id);
      e.dataTransfer.effectAllowed = 'move';
      // setData is required for the drag to actually initiate in Chromium/Firefox.
      e.dataTransfer.setData('text/plain', id);
    },
    onDragEnd: () => { setDragId(null); setOverId(null); },
  });

  const itemProps = (id: string) => ({
    // preventDefault on every dragover while a drag is active — without it the drop
    // event never fires. (Conditioning it on dragId state races the dragstart commit.)
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      if (dragId && dragId !== id && overId !== id) setOverId(id);
    },
    onDragLeave: () => { if (overId === id) setOverId(null); },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOverId(null);
      const moved = dragId;
      setDragId(null);
      if (!moved) return;
      const from = ids.indexOf(moved);
      const to = ids.indexOf(id);
      if (from === -1 || to === -1 || from === to) return;
      const next = ids.slice();
      next.splice(from, 1);
      next.splice(to, 0, moved);
      onCommit(next);
    },
  });

  return { dragId, overId, handleProps, itemProps };
}
