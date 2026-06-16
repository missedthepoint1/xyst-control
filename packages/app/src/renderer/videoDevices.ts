import { useEffect, useState } from 'react';
import type { VideoSource } from '@xyst/core';

/**
 * The current list of video-input (capture) devices, refreshed whenever the set changes
 * (plug/unplug, or a device re-enumerating under a new id after a cable/link change). Shared by
 * the source selector and the live-view panel so both stay current without a manual reload.
 */
export function useVideoInputs(): MediaDeviceInfo[] {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) return;
    let stopped = false;
    const refresh = () => {
      md.enumerateDevices()
        .then((ds) => { if (!stopped) setDevices(ds.filter((d) => d.kind === 'videoinput')); })
        .catch(() => {});
    };
    refresh();
    md.addEventListener?.('devicechange', refresh);
    return () => { stopped = true; md.removeEventListener?.('devicechange', refresh); };
  }, []);
  return devices;
}

/**
 * Resolve a saved source to a CURRENTLY-connected device id. Prefers the exact saved deviceId;
 * if that id is gone (the device re-enumerated), falls back to matching by the stable label.
 * Returns undefined when neither matches — the device isn't connected.
 */
export function resolveDeviceId(
  source: Pick<VideoSource, 'deviceId' | 'deviceLabel'> | undefined,
  devices: MediaDeviceInfo[],
): string | undefined {
  if (!source) return undefined;
  if (source.deviceId && devices.some((d) => d.deviceId === source.deviceId)) return source.deviceId;
  if (source.deviceLabel) {
    const byLabel = devices.find((d) => d.label === source.deviceLabel);
    if (byLabel) return byLabel.deviceId;
  }
  return undefined;
}
