import { useEffect, useState, useCallback } from 'react';
import type { CameraState } from '@xyst/core';

export function useCameras() {
  const [states, setStates] = useState<Record<string, CameraState>>({});

  const refresh = useCallback(async () => {
    const all = (await window.xyst.states()) as CameraState[];
    setStates(Object.fromEntries(all.map((s) => [s.id, s])));
  }, []);

  useEffect(() => {
    void refresh();
    const off = window.xyst.onState((id, state) =>
      setStates((prev) => ({ ...prev, [id]: state as CameraState })));
    return off;
  }, [refresh]);

  return { states: Object.values(states), refresh };
}
