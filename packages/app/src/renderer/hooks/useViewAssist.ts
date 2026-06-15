import { useEffect, useState } from 'react';
import type { CameraUiSettings } from '@xyst/core';
import { builtinTransform, parseCube, type ResolvedViewAssist, type Lut3D } from '../viewAssist.js';

/**
 * Resolve a camera's view-assist UI settings into something VideoPanel can apply: a built-in look
 * resolves synchronously; a 'cube' look is loaded + parsed from the stored file via IPC (memoised
 * on the filename). Returns null when view assist is off or its LUT isn't ready/valid.
 */
export function useViewAssist(ui?: CameraUiSettings): ResolvedViewAssist | null {
  const va = ui?.viewAssist;
  const cubeFile = va?.look === 'cube' ? va.cube?.file : undefined;
  const [cube, setCube] = useState<Lut3D | null>(null);

  useEffect(() => {
    if (!cubeFile) { setCube(null); return; }
    let alive = true;
    window.xyst.readLut(cubeFile)
      .then((text) => { if (alive) setCube(parseCube(text)); })
      .catch(() => { if (alive) setCube(null); });
    return () => { alive = false; };
  }, [cubeFile]);

  if (!va?.enabled) return null;
  const transform = va.look === 'cube'
    ? (cube ? { lut3d: cube } : null)
    : builtinTransform(va.look) ?? null;
  if (!transform) return null;
  return { transform, intensity: va.intensity ?? 1 };
}
