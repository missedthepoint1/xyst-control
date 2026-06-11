import { useEffect, useState, useCallback } from 'react';
import type { CameraState } from '@xyst/core';

export function useCameras() {
  const [states, setStates] = useState<Record<string, CameraState>>({});

  const refresh = useCallback(async () => {
    const all = (await window.xyst.states()) as CameraState[] | undefined;
    setStates(Object.fromEntries((all ?? []).filter(Boolean).map((s) => [s.id, s])));
  }, []);

  useEffect(() => {
    void refresh();
    // Ignore an undefined push (e.g. a state event for a camera with no driver) so it
    // never lands in the map and crashes consumers that read `.record`/`.id`.
    const off = window.xyst.onState((id, state) =>
      setStates((prev) => (state ? { ...prev, [id]: state as CameraState } : prev)));
    const offRemoved = window.xyst.onRemoved((id) =>
      setStates((prev) => { const n = { ...prev }; delete n[id]; return n; }));
    return () => { off(); offRemoved(); };
  }, [refresh]);

  return { states: Object.values(states).filter(Boolean) as CameraState[], refresh };
}
