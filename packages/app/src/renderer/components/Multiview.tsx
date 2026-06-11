import type { CameraState } from '@xyst/core';
import { VideoPanel } from './VideoPanel.js';
import { useApiBase } from '../hooks/useApiBase.js';

export function Multiview({ states, onSelect }: {
  states: CameraState[]; onSelect: (id: string) => void;
}) {
  const apiBase = useApiBase();
  if (states.length === 0) return <div className="multiview__empty">No cameras. Switch to Panels to add one.</div>;
  return (
    <div className="multiview">
      {states.map((s) => (
        <VideoPanel key={s.id} cameraId={s.id} source={s.video} apiBase={apiBase}
          recording={s.record.recording} name={s.model ?? s.name ?? s.id}
          onSelect={() => onSelect(s.id)} />
      ))}
    </div>
  );
}
