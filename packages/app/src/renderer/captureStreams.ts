import { useEffect, useState } from 'react';

export type CaptureStatus = 'idle' | 'opening' | 'live' | 'error';
export interface Snapshot {
  status: CaptureStatus;
  stream: MediaStream | null;
  /** True when 4K was requested but the link could only deliver 1080p (see negotiate). */
  degraded: boolean;
  /** Actual DECODED frame size (0 until live). Not the negotiated size — see probeDecodedSize. */
  width: number;
  height: number;
}
type Listener = (s: Snapshot) => void;

interface Entry {
  stream: MediaStream | null;
  status: CaptureStatus;
  degraded: boolean;
  width: number;
  height: number;
  refs: number;
  listeners: Set<Listener>;
}

const registry = new Map<string, Entry>();

// How long to wait before re-attempting a device that failed to open or dropped, while consumers remain.
const RETRY_MS = 1500;

// We want a 4K capture (so the quad-crop yields true 1080p tiles) but degrade gracefully to 1080p.
const FOURK: MediaTrackConstraints = { width: { ideal: 3840 }, height: { ideal: 2160 } };
const HD: MediaTrackConstraints = { width: { ideal: 1920 }, height: { ideal: 1080 } };
// A healthy decode is well above this; a bandwidth-starved 4K negotiation delivers a degenerate
// ~2×2 frame while still REPORTING 3840×2160 via getSettings — so we gate on the real decode.
const MIN_DECODE_WIDTH = 640;

function snapshot(entry: Entry): Snapshot {
  return entry.status === 'live' && entry.stream
    ? { status: 'live', stream: entry.stream, degraded: entry.degraded, width: entry.width, height: entry.height }
    : { status: entry.status, stream: null, degraded: false, width: 0, height: 0 };
}

function emit(entry: Entry): void {
  const snap = snapshot(entry);
  entry.listeners.forEach((l) => l(snap));
}

// Schedule a reconnect attempt while consumers remain; otherwise drop the entry.
function scheduleReopen(deviceId: string, entry: Entry): void {
  if (entry.refs === 0) { registry.delete(deviceId); return; }
  setTimeout(() => {
    if (registry.get(deviceId) === entry && entry.refs > 0) void open(deviceId, entry);
  }, RETRY_MS);
}

// A live track died (USB unplug / device removed). Fail soft + reconnect symmetrically with open-failure.
// The fresh open() retries 4K first, so a cable reseat that drops then re-adds the device climbs back up.
function onTrackEnded(deviceId: string, entry: Entry): void {
  if (registry.get(deviceId) !== entry) return; // already torn down
  entry.stream?.getTracks().forEach((t) => t.stop());
  entry.stream = null;
  entry.status = 'error';
  entry.degraded = false; entry.width = 0; entry.height = 0;
  emit(entry);
  scheduleReopen(deviceId, entry);
}

// getUserMedia + track.getSettings() can REPORT a resolution the USB link can't actually deliver:
// a bandwidth-starved 4K negotiation reports 3840×2160 but decodes a 2×2 frame. Measure the REAL
// decoded size by briefly attaching the stream to an offscreen video element.
async function probeDecodedSize(stream: MediaStream): Promise<{ width: number; height: number }> {
  const v = document.createElement('video');
  v.muted = true;
  v.srcObject = stream;
  try { await v.play(); } catch { /* a muted stream rarely fails to autoplay; size is read regardless */ }
  if (!v.videoWidth) {
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      v.addEventListener('loadedmetadata', done, { once: true });
      setTimeout(done, 2000); // safety: never hang the open on a stream that never reports metadata
    });
  }
  const size = { width: v.videoWidth, height: v.videoHeight };
  v.srcObject = null; // detach WITHOUT stopping tracks — the stream is kept for real consumers
  return size;
}

// Open at 4K, validating the ACTUAL decode; on a degenerate frame (starved link delivers ~2×2)
// or a refused 4K mode (slow/USB-2 link → OverconstrainedError), fall back to 1080p and flag
// the stream degraded. A throw from the HD fallback propagates to open()'s catch → error state.
async function negotiate(
  deviceId: string,
): Promise<{ stream: MediaStream; degraded: boolean; width: number; height: number }> {
  const get = (extra: MediaTrackConstraints) =>
    navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId }, ...extra } });
  try {
    const stream = await get(FOURK);
    const size = await probeDecodedSize(stream);
    if (size.width >= MIN_DECODE_WIDTH) return { stream, degraded: false, ...size };
    stream.getTracks().forEach((t) => t.stop()); // degenerate 4K — drop and retry at HD
  } catch {
    // 4K refused outright (sub-SuperSpeed link) — fall through to the HD request.
  }
  const stream = await get(HD);
  const size = await probeDecodedSize(stream);
  return { stream, degraded: true, ...size };
}

async function open(deviceId: string, entry: Entry): Promise<void> {
  entry.status = 'opening';
  emit(entry);
  try {
    const { stream, degraded, width, height } = await negotiate(deviceId);
    // Everyone left while we were awaiting — discard so we don't leak an open device.
    if (entry.refs === 0) {
      stream.getTracks().forEach((t) => t.stop());
      registry.delete(deviceId);
      entry.status = 'idle';
      return;
    }
    entry.stream = stream;
    entry.status = 'live';
    entry.degraded = degraded;
    entry.width = width;
    entry.height = height;
    const track = stream.getVideoTracks()[0];
    console.info(`[capture] ${deviceId} ${degraded ? 'DEGRADED→' : ''}live at ${width}×${height}`);
    emit(entry);
    // Detect mid-show loss of a LIVE device (the catch below only covers the initial open):
    // a USB unplug ends the track; an SDI signal drop mutes it. Recover/reflect both.
    if (track) {
      track.onended = () => onTrackEnded(deviceId, entry);
      track.onmute = () => {
        if (entry.stream === stream && entry.status === 'live') { entry.status = 'error'; emit(entry); }
      };
      track.onunmute = () => {
        if (entry.stream === stream && entry.status === 'error') { entry.status = 'live'; emit(entry); }
      };
    }
  } catch (err) {
    console.warn(`[capture] ${deviceId} failed to open`, err);
    entry.status = 'error';
    entry.degraded = false; entry.width = 0; entry.height = 0;
    // Everyone left while we were awaiting — teardown was deferred (see release), so evict now.
    if (entry.refs === 0) { registry.delete(deviceId); return; }
    emit(entry);
    // Robustness (fail soft + reconnect): keep retrying while consumers remain, so a transient
    // device hiccup at show time recovers on its own instead of stranding the panel on an error.
    scheduleReopen(deviceId, entry);
  }
}

function acquire(deviceId: string, listener: Listener): () => void {
  let entry = registry.get(deviceId);
  if (!entry) {
    entry = { stream: null, status: 'idle', degraded: false, width: 0, height: 0, refs: 0, listeners: new Set() };
    registry.set(deviceId, entry);
  }
  const e = entry;
  e.listeners.add(listener);
  e.refs += 1;
  if (e.status === 'idle') void open(deviceId, e);
  else listener(snapshot(e));
  return () => {
    e.listeners.delete(listener);
    e.refs -= 1;
    // Defer teardown while an open() is in flight: an immediate unmount→remount (and React
    // StrictMode's mount→unmount→mount) would otherwise spawn a second getUserMedia on the same
    // single-consumer device. Leaving the entry in place lets the remount reuse the in-flight open;
    // open() itself evicts the entry if refs are still 0 when it settles.
    if (e.refs === 0 && e.status !== 'opening') {
      e.stream?.getTracks().forEach((t) => t.stop());
      registry.delete(deviceId);
    }
  };
}

/**
 * Force a clean re-open of a shared device — the operator retrying 4K on a degraded feed (e.g.
 * after reseating the cable into a SuperSpeed/TB port). We don't auto-retry 4K on a live stream:
 * that would tear down a working 1080p picture on a timer and risk wedging this single-consumer
 * device. Reconnects recover automatically (onTrackEnded → open); this covers the no-unplug case.
 */
export function retryCapture(deviceId: string): void {
  const entry = registry.get(deviceId);
  if (!entry || entry.refs === 0 || entry.status === 'opening') return;
  const old = entry.stream;
  entry.stream = null;
  // Detach handlers before stopping so the stop doesn't fire onTrackEnded → a competing reopen.
  old?.getVideoTracks().forEach((t) => { t.onended = null; t.onmute = null; t.onunmute = null; });
  old?.getTracks().forEach((t) => t.stop());
  void open(deviceId, entry);
}

/** Subscribe to a shared capture device. Opens it once; all callers share the stream. */
export function useCaptureStream(deviceId?: string): Snapshot {
  const [snap, setSnap] = useState<Snapshot>({ status: 'idle', stream: null, degraded: false, width: 0, height: 0 });
  useEffect(() => {
    if (!deviceId) { setSnap({ status: 'idle', stream: null, degraded: false, width: 0, height: 0 }); return; }
    return acquire(deviceId, setSnap);
  }, [deviceId]);
  return snap;
}
