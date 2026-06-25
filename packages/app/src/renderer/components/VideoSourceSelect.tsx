import type { VideoSource } from '@xyst/core';
import { useVideoInputs, resolveDeviceId, describeCaptureDevice } from '../videoDevices.js';

const QUADS: { q: 0 | 1 | 2 | 3; label: string }[] = [
  { q: 0, label: '◤ Top-left' },
  { q: 1, label: '◥ Top-right' },
  { q: 2, label: '◣ Bottom-left' },
  { q: 3, label: '◢ Bottom-right' },
];

// Only real SDI/HDMI capture cards are valid sources — drop the Mac's built-in webcam,
// which is never a production feed.
const isBuiltInWebcam = (label: string) => /(macbook|facetime|built[- ]?in)/i.test(label);

export function VideoSourceSelect({ current, onChange, name }: {
  current?: VideoSource; onChange: (v: VideoSource) => void; name?: string;
}) {
  // Self-refreshes on devicechange, so a plugged/re-enumerated device appears without a reload.
  const devices = useVideoInputs().filter((d) => !isBuiltInWebcam(d.label));

  // Serialize the current source to the <select> value, using the device's LIVE id (the saved id
  // may be stale after a re-enumeration) so the active selection stays highlighted.
  const liveId = current ? resolveDeviceId(current, devices) : undefined;
  let value = 'none';
  if (current?.type === 'protocol') value = 'protocol';
  else if (current?.type === 'capture') value = `capture:${liveId ?? current.deviceId ?? ''}`;
  else if (current?.type === 'quad') value = `quad:${liveId ?? current.deviceId ?? ''}:${current.quadrant ?? 0}`;

  // Look up the stable label for a selected id so it's saved alongside (enables label-fallback match).
  const labelOf = (id: string) => devices.find((d) => d.deviceId === id)?.label;

  return (
    <select className="select video__src" value={value} onChange={(e) => {
      const v = e.target.value;
      if (v === 'protocol') onChange({ type: 'protocol' });
      else if (v.startsWith('capture:')) {
        const id = v.slice('capture:'.length);
        onChange({ type: 'capture', deviceId: id, deviceLabel: labelOf(id) });
      } else if (v.startsWith('quad:')) {
        const rest = v.slice('quad:'.length);
        const i = rest.lastIndexOf(':');
        const id = rest.slice(0, i);
        onChange({ type: 'quad', deviceId: id, deviceLabel: labelOf(id), quadrant: Number(rest.slice(i + 1)) as 0 | 1 | 2 | 3 });
      } else onChange({ type: 'none' });
    }}>
      <option value="none">No video</option>
      <option value="protocol">{name ? `${name} — Live view` : 'Live view'}</option>
      {devices.map((d, i) => {
        const dev = describeCaptureDevice(d.label, i);
        return (
          <optgroup key={d.deviceId} label={dev.name}>
            <option key="full" value={`capture:${d.deviceId}`}>Full frame (SDI/HDMI · high-res)</option>
            {dev.quad && QUADS.map(({ q, label }) => (
              <option key={q} value={`quad:${d.deviceId}:${q}`}>{label} (quad)</option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}
