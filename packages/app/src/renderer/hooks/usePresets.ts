import { useEffect, useState, useCallback } from 'react';
import type { CameraPreset } from '@xyst/core';

export function usePresets(cameraId: string) {
  const [presets, setPresets] = useState<CameraPreset[]>([]);

  const refresh = useCallback(async () => {
    setPresets((await window.xyst.presets(cameraId)) as CameraPreset[]);
  }, [cameraId]);

  useEffect(() => {
    void refresh();
    const off = window.xyst.onPresets((id, p) => {
      if (id === cameraId) setPresets(p as CameraPreset[]);
    });
    return () => { off(); };
  }, [cameraId, refresh]);

  return { presets, refresh };
}
