import { useEffect, useState } from 'react';

/** Picks the audio input that feeds the meters (e.g. the SDI/HDMI capture card's audio,
 *  or an audio interface). Labels only appear once mic permission has been granted. */
export function AudioSourceSelect({ deviceId, onChange }: {
  deviceId?: string; onChange: (deviceId?: string) => void;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices?.()
      .then((ds) => setDevices(ds.filter((d) => d.kind === 'audioinput')))
      .catch(() => {});
  }, []);
  return (
    <select className="select video__src" value={deviceId ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">No audio input</option>
      {devices.map((d, i) => (
        <option key={d.deviceId} value={d.deviceId}>{d.label || `Audio input ${i + 1}`}</option>
      ))}
    </select>
  );
}
