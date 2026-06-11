import { useEffect, useState } from 'react';
import type { VideoSource } from '@xyst/core';

export function VideoSourceSelect({ current, onChange, name }: {
  current?: VideoSource; onChange: (v: VideoSource) => void; name?: string;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    // Only real SDI/HDMI capture cards are valid sources — drop the Mac's built-in
    // webcam, which is never a production feed. (Heuristic on label; the built-in
    // reports as FaceTime/MacBook/Built-in.)
    const isBuiltInWebcam = (label: string) => /(macbook|facetime|built[- ]?in)/i.test(label);
    navigator.mediaDevices?.enumerateDevices?.()
      .then((ds) => setDevices(ds.filter((d) => d.kind === 'videoinput' && !isBuiltInWebcam(d.label))))
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
      <option value="protocol">{name ? `${name} — Live view` : 'Live view'}</option>
      {devices.map((d, i) => (
        <option key={d.deviceId} value={`capture:${d.deviceId}`}>{`${d.label || `Capture device ${i + 1}`} (SDI/HDMI · high-res)`}</option>
      ))}
    </select>
  );
}
