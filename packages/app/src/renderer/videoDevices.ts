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
 * Friendly naming + capability hint for known capture devices. Capture cards/dongles enumerate over
 * UVC under opaque chipset labels (e.g. the Blackmagic Web Presenter 4K appears as "ZS17 Camera"),
 * so we map the raw label to a production-friendly name. `quad` marks a device that delivers a single
 * 4K 2×2 multiview to be cropped into four 1080p tiles (the Web Presenter workflow); plain multi-input
 * cards expose each SDI input as its own full-frame device, so they get full-frame only.
 *
 * This is a display/UX convenience, not camera capability discovery — UVC gives us no model query,
 * so a small label table is the standard approach. Patterns are case-insensitive and matched in order.
 */
interface KnownCaptureDevice { match: RegExp; name: string; quad: boolean }

const KNOWN_CAPTURE_DEVICES: KnownCaptureDevice[] = [
  // Blackmagic Web Presenter 4K → opaque "ZS17 Camera" UVC label. Carries a 4K 2×2 multiview.
  { match: /zs17|web ?presenter/i, name: 'Blackmagic Web Presenter 4K', quad: true },
  // Blackmagic DeckLink Duo 2 → 4 independent 3G-SDI inputs, each up to 1080p60. Each input is a
  // separate full-frame capture; there is no 2×2 multiview to crop. (Untested hardware — the macOS
  // label pattern is a best guess; the Web Presenter mapping is confirmed against the live rig.)
  { match: /decklink/i, name: 'Blackmagic DeckLink Duo 2', quad: false },
];

export interface CaptureDeviceInfo { name: string; quad: boolean }

/** Resolve a raw UVC label to its friendly name + whether to offer 2×2 quad-crop sources. */
export function describeCaptureDevice(rawLabel: string, fallbackIndex = 0): CaptureDeviceInfo {
  const known = KNOWN_CAPTURE_DEVICES.find((k) => k.match.test(rawLabel));
  // Unknown device: keep its raw label and offer quad (preserves prior behaviour for any card).
  if (!known) return { name: rawLabel || `Capture device ${fallbackIndex + 1}`, quad: true };
  // Keep a trailing channel/index hint (e.g. "(2)", "#3", "Ch 4") so a multi-input card's feeds stay distinct.
  const ch = rawLabel.match(/(?:#|\(|\bch(?:annel)?\s*)\s*(\d+)/i);
  return { name: ch ? `${known.name} (${ch[1]})` : known.name, quad: known.quad };
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
