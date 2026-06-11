import { useEffect, useState, useCallback } from 'react';
import type { FocusPoint } from '@xyst/core';

export function useFocusPoints(cameraId: string) {
  const [points, setPoints] = useState<FocusPoint[]>([]);
  const refresh = useCallback(async () => {
    setPoints((await window.xyst.focusPoints(cameraId)) as FocusPoint[]);
  }, [cameraId]);
  useEffect(() => {
    void refresh();
    const off = window.xyst.onFocusPoints((id, p) => { if (id === cameraId) setPoints(p as FocusPoint[]); });
    return () => { off(); };
  }, [cameraId, refresh]);
  return { points, refresh };
}
