import { useEffect, useState } from 'react';

export type CaptureStatus = 'idle' | 'opening' | 'live' | 'error';
type Snapshot =
  | { status: 'idle' | 'opening' | 'error'; stream: null }
  | { status: 'live'; stream: MediaStream };
type Listener = (s: Snapshot) => void;

interface Entry {
  stream: MediaStream | null;
  status: CaptureStatus;
  refs: number;
  listeners: Set<Listener>;
}

const registry = new Map<string, Entry>();

// How long to wait before re-attempting a device that failed to open or dropped, while consumers remain.
const RETRY_MS = 1500;

function snapshot(entry: Entry): Snapshot {
  return entry.status === 'live' && entry.stream
    ? { status: 'live', stream: entry.stream }
    : ({ status: entry.status, stream: null } as Snapshot);
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
function onTrackEnded(deviceId: string, entry: Entry): void {
  if (registry.get(deviceId) !== entry) return; // already torn down
  entry.stream?.getTracks().forEach((t) => t.stop());
  entry.stream = null;
  entry.status = 'error';
  emit(entry);
  scheduleReopen(deviceId, entry);
}

async function open(deviceId: string, entry: Entry): Promise<void> {
  entry.status = 'opening';
  emit(entry);
  try {
    // Request 4K explicitly — without the ideal hint the device may negotiate 720p,
    // which would make each quadrant 640×360 instead of a true 1080p.
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId }, width: { ideal: 3840 }, height: { ideal: 2160 } },
    });
    // Everyone left while we were awaiting — discard so we don't leak an open device.
    if (entry.refs === 0) {
      stream.getTracks().forEach((t) => t.stop());
      registry.delete(deviceId);
      entry.status = 'idle';
      return;
    }
    entry.stream = stream;
    entry.status = 'live';
    const track = stream.getVideoTracks()[0];
    const s = track?.getSettings();
    console.info(`[capture] ${deviceId} opened at ${s?.width}×${s?.height}@${s?.frameRate ?? '?'}fps`);
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
    entry = { stream: null, status: 'idle', refs: 0, listeners: new Set() };
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

/** Subscribe to a shared capture device. Opens it once; all callers share the stream. */
export function useCaptureStream(deviceId?: string): Snapshot {
  const [snap, setSnap] = useState<Snapshot>({ status: 'idle', stream: null });
  useEffect(() => {
    if (!deviceId) { setSnap({ status: 'idle', stream: null }); return; }
    return acquire(deviceId, setSnap);
  }, [deviceId]);
  return snap;
}
