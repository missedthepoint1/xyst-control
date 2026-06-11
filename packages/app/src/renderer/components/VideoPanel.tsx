import { useEffect, useRef, useState } from 'react';
import type { VideoSource } from '@xyst/core';

export function VideoPanel({ cameraId, source, recording, apiBase }: {
  cameraId: string; source?: VideoSource; recording: boolean; apiBase: string;
}) {
  const type = source?.type ?? 'none';
  const imgRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState(false);

  // Protocol JPEG: poll image.cgi via the app API, one frame at a time.
  useEffect(() => {
    if (type !== 'protocol' || !apiBase) return;
    const img = imgRef.current;
    if (!img) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => { if (!stopped) img.src = `${apiBase}/api/cameras/${cameraId}/preview.jpg?t=${Date.now()}`; };
    const onLoad = () => { setErr(false); timer = setTimeout(load, 90); };
    const onError = () => { setErr(true); timer = setTimeout(load, 1000); };
    img.addEventListener('load', onLoad);
    img.addEventListener('error', onError);
    load();
    return () => { stopped = true; if (timer) clearTimeout(timer); img.removeEventListener('load', onLoad); img.removeEventListener('error', onError); img.removeAttribute('src'); };
  }, [type, apiBase, cameraId]);

  // Capture device via getUserMedia.
  useEffect(() => {
    if (type !== 'capture' || !source?.deviceId) return;
    let cancelled = false;
    let stream: MediaStream | undefined;
    navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: source.deviceId } } })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
        setErr(false);
      })
      .catch(() => setErr(true));
    return () => { cancelled = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [type, source?.deviceId]);

  if (type === 'none') return null;

  return (
    <div className={`video${recording ? ' video--rec' : ''}`}>
      {type === 'protocol' && <img ref={imgRef} className="video__img" alt="" />}
      {type === 'capture' && <video ref={videoRef} className="video__img" autoPlay muted playsInline />}
      {err && <div className="video__placeholder">No signal</div>}
      {recording && <span className="video__tally"><span className="video__dot" /> REC</span>}
    </div>
  );
}
