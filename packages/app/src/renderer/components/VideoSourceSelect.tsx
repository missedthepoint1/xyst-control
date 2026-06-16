import { useEffect, useState } from 'react';
import type { VideoSource } from '@xyst/core';

const QUADS: { q: 0 | 1 | 2 | 3; label: string }[] = [
  { q: 0, label: '◤ Top-left' },
  { q: 1, label: '◥ Top-right' },
  { q: 2, label: '◣ Bottom-left' },
  { q: 3, label: '◢ Bottom-right' },
];

export function VideoSourceSelect({ current, onChange, name }: {
  current?: VideoSource; onChange: (v: VideoSource) => void; name?: string;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    // Only real SDI/HDMI capture cards are valid sources — drop the Mac's built-in
    // webcam, which is never a production feed.
    const isBuiltInWebcam = (label: string) => /(macbook|facetime|built[- ]?in)/i.test(label);
    navigator.mediaDevices?.enumerateDevices?.()
      .then((ds) => setDevices(ds.filter((d) => d.kind === 'videoinput' && !isBuiltInWebcam(d.label))))
      .catch(() => {});
  }, []);

  // Serialize the current source to the <select> value.
  let value = 'none';
  if (current?.type === 'protocol') value = 'protocol';
  else if (current?.type === 'capture') value = `capture:${current.deviceId ?? ''}`;
  else if (current?.type === 'quad') value = `quad:${current.deviceId ?? ''}:${current.quadrant ?? 0}`;

  return (
    <select className="select video__src" value={value} onChange={(e) => {
      const v = e.target.value;
      if (v === 'protocol') onChange({ type: 'protocol' });
      else if (v.startsWith('capture:')) onChange({ type: 'capture', deviceId: v.slice('capture:'.length) });
      else if (v.startsWith('quad:')) {
        const rest = v.slice('quad:'.length);
        const i = rest.lastIndexOf(':');
        onChange({ type: 'quad', deviceId: rest.slice(0, i), quadrant: Number(rest.slice(i + 1)) as 0 | 1 | 2 | 3 });
      } else onChange({ type: 'none' });
    }}>
      <option value="none">No video</option>
      <option value="protocol">{name ? `${name} — Live view` : 'Live view'}</option>
      {devices.map((d, i) => (
        <optgroup key={d.deviceId} label={d.label || `Capture device ${i + 1}`}>
          <option key="full" value={`capture:${d.deviceId}`}>Full frame (SDI/HDMI · high-res)</option>
          {QUADS.map(({ q, label }) => (
            <option key={q} value={`quad:${d.deviceId}:${q}`}>{label} (quad)</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
