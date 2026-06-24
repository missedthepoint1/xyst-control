import { useMemo } from 'react';
import type { CameraState } from '@xyst/core';
import { VideoPanel } from './VideoPanel.js';
import { useViewAssist } from '../hooks/useViewAssist.js';
import { buildOsd } from '../osdInfo.js';

/**
 * VideoPanel for a multiview tile that resolves the camera's view-assist (LUT) per tile.
 * useViewAssist is a hook, so it can't be called inside a tile-list .map(); a component per
 * camera lets the LUT apply in multiview (tab + popout) the same way CameraPanel does in panels.
 *
 * The OSD is built here (memoised on this tile's own state) rather than in the parent's .map(): a
 * state push for ONE camera re-renders the whole popout grid, so building it upstream recomputed
 * every tile's OsdInfo on every push — here only the changed tile recomputes.
 */
export function MultiviewVideo({ state, apiBase, showOsd, showTc, onSelect }: {
  state: CameraState; apiBase: string;
  showOsd?: boolean; showTc?: boolean; onSelect?: () => void;
}) {
  const viewAssist = useViewAssist(state.ui);
  const osd = useMemo(() => (showOsd ? buildOsd(state) : undefined), [showOsd, state]);
  return (
    <VideoPanel cameraId={state.id} source={state.video} apiBase={apiBase}
      recording={state.record.recording} viewAssist={viewAssist} tile
      osd={osd} showOsd={showOsd} showTc={showTc} onSelect={onSelect} />
  );
}
