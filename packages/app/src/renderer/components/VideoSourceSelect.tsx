import { useEffect, useState } from 'react';
import type { VideoSource } from '@xyst/core';

export function VideoSourceSelect({ current, onChange }: {
  current?: VideoSource; onChange: (v: VideoSource) => void;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices?.()
      .then((ds) => setDevices(ds.filter((d) => d.kind === 'videoinput')))
      .catch(() => {});
  }, []);
  const value = current?.type === 'capture' ? `capture:${current.deviceId ?? ''}` : (current?.type ?? 'none');
  return (
    <select className="select video__src" value={value} onChange={(e) => {
      const v = e.target.value;
      if (v === 'protocol') onChange({ type: 'protocol' });
      else if (v.startsWith('capture:')) onChange({ type: 'capture', deviceId: v.slice('capture:'.length) });
      else onChange({ type: 'none' });
    }}>
      <option value="none">No video</option>
      <option value="protocol">Camera preview (JPEG)</option>
      {devices.map((d, i) => (
        <option key={d.deviceId} value={`capture:${d.deviceId}`}>{d.label || `Capture device ${i + 1}`}</option>
      ))}
    </select>
  );
}
