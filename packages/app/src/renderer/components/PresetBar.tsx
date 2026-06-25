import type { CameraPreset } from '@xyst/core';

// Recall chips for saved presets. Creating presets (name + Save) lives in the panel's gear settings
// (CameraSettings) to keep the panel itself focused on quick recall during a show.
export function PresetBar({ cameraId, presets }: { cameraId: string; presets: CameraPreset[] }) {
  if (presets.length === 0) return null;
  return (
    <div className="presets">
      <div className="chips">
        {presets.map((p) => (
          <span key={p.id} className="chip">
            <button className="chip__name" title="Recall"
              onClick={() => window.xyst.recallPreset(cameraId, p.id)}>{p.name}</button>
            <button className="chip__del" title="Delete"
              onClick={() => window.xyst.deletePreset(cameraId, p.id)}>×</button>
          </span>
        ))}
      </div>
    </div>
  );
}
