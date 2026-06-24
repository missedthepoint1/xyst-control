import { useEffect, useState, useCallback, useRef } from 'react';
import type { CameraState } from '@xyst/core';

export function useCameras() {
  const [states, setStates] = useState<Record<string, CameraState>>({});
  // Bumped by every live push AND at the start of each refresh; a refresh whose generation is stale
  // by the time it resolves had a push land mid-await, so it must not full-replace and clobber it.
  const gen = useRef(0);

  const refresh = useCallback(async () => {
    const myGen = (gen.current += 1);
    const all = (await window.xyst.states()) as CameraState[] | undefined;
    if (myGen !== gen.current) return; // a newer push (or refresh) intervened — keep the live state
    setStates(Object.fromEntries((all ?? []).filter(Boolean).map((s) => [s.id, s])));
  }, []);

  useEffect(() => {
    void refresh();
    // Ignore an undefined push (e.g. a state event for a camera with no driver) so it
    // never lands in the map and crashes consumers that read `.record`/`.id`.
    const off = window.xyst.onState((id, state) => {
      gen.current += 1;
      setStates((prev) => (state ? { ...prev, [id]: state as CameraState } : prev));
    });
    const offRemoved = window.xyst.onRemoved((id) => {
      gen.current += 1;
      setStates((prev) => { const n = { ...prev }; delete n[id]; return n; });
    });
    return () => { off(); offRemoved(); };
  }, [refresh]);

  return { states: Object.values(states).filter(Boolean) as CameraState[], refresh };
}
