import { useEffect, useRef, useState } from 'react';
import type { VideoSource } from '@xyst/core';
type DetectBox = { type: 'face' | 'eye' | 'object'; x: number; y: number; w: number; h: number; main: boolean; track: boolean };
type Guide = { status: boolean; level: number; angle: number; dir: string; x: number; y: number; w: number; h: number };

export function VideoPanel({ cameraId, source, recording, apiBase, name, onSelect, onFocus }: {
  cameraId: string; source?: VideoSource; recording: boolean; apiBase: string;
  name?: string; onSelect?: () => void; onFocus?: (x: number, y: number) => void;
}) {
  const type = source?.type ?? 'none';
  const imgRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState(false);
  const [mark, setMark] = useState<{ x: number; y: number } | null>(null);
  const [boxes, setBoxes] = useState<DetectBox[]>([]);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [showDetect, setShowDetect] = useState(true);

  useEffect(() => {
    if (type !== 'protocol' || !apiBase) return;
    const img = imgRef.current; if (!img) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => { if (!stopped) img.src = `${apiBase}/api/cameras/${cameraId}/preview.jpg?t=${Date.now()}`; };
    const onLoad = () => { setErr(false); timer = setTimeout(load, 90); };
    const onError = () => { setErr(true); timer = setTimeout(load, 1000); };
    img.addEventListener('load', onLoad); img.addEventListener('error', onError);
    load();
    return () => { stopped = true; if (timer) clearTimeout(timer); img.removeEventListener('load', onLoad); img.removeEventListener('error', onError); img.removeAttribute('src'); };
  }, [type, apiBase, cameraId]);

  useEffect(() => {
    if (type === 'none' || !apiBase || !showDetect) { setBoxes([]); setGuide(null); return; }
    let stopped = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const r = await fetch(`${apiBase}/api/cameras/${cameraId}/meta?t=${Date.now()}`);
        if (r.ok) { const m = await r.json() as { detect?: DetectBox[]; fguide?: Guide }; if (!stopped) { setBoxes(m.detect ?? []); setGuide(m.fguide ?? null); } }
        else { if (!stopped) { setBoxes([]); setGuide(null); } }
      } catch { if (!stopped) { setBoxes([]); setGuide(null); } }
      if (!stopped) timer = setTimeout(poll, 150);
    };
    poll();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [type, apiBase, cameraId, showDetect]);

  useEffect(() => {
    if (type !== 'capture' || !source?.deviceId) return;
    let cancelled = false; let stream: MediaStream | undefined;
    navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: source.deviceId } } })
      .then((s) => { if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; } stream = s; if (videoRef.current) videoRef.current.srcObject = s; setErr(false); })
      .catch(() => setErr(true));
    return () => { cancelled = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [type, source?.deviceId]);

  const tap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (onSelect) { onSelect(); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const media = imgRef.current ?? videoRef.current;
    let nw = 16, nh = 9;
    if (media instanceof HTMLImageElement && media.naturalWidth) { nw = media.naturalWidth; nh = media.naturalHeight; }
    else if (media instanceof HTMLVideoElement && media.videoWidth) { nw = media.videoWidth; nh = media.videoHeight; }
    const cAR = rect.width / rect.height, mAR = nw / nh;
    let dispW: number, dispH: number, offX: number, offY: number;
    if (mAR > cAR) { dispW = rect.width; dispH = rect.width / mAR; offX = 0; offY = (rect.height - dispH) / 2; }
    else { dispH = rect.height; dispW = rect.height * mAR; offY = 0; offX = (rect.width - dispW) / 2; }
    const px = e.clientX - rect.left - offX, py = e.clientY - rect.top - offY;
    if (px < 0 || py < 0 || px > dispW || py > dispH) return; // outside the active image
    const nx = px / dispW, ny = py / dispH;
    void window.xyst.setFocusPoint(cameraId, nx, ny);
    onFocus?.(nx, ny);
    setMark({ x: ((offX + px) / rect.width) * 100, y: ((offY + py) / rect.height) * 100 });
    setTimeout(() => setMark(null), 1500);
  };

  if (type === 'none' && !onSelect) return null;

  return (
    <div className={`video${recording ? ' video--rec' : ''}${onSelect ? ' video--tile' : ''}`} onClick={tap}>
      {type === 'protocol' && <img ref={imgRef} className="video__img" alt="" />}
      {type === 'capture' && <video ref={videoRef} className="video__img" autoPlay muted playsInline />}
      {(type === 'none' || err) && <div className="video__placeholder">{type === 'none' ? 'No video source' : 'No signal'}</div>}
      {mark && <span className="video__af" style={{ left: `${mark.x}%`, top: `${mark.y}%` }} />}
      {!onSelect && boxes.map((b, i) => (
        <div key={i}
          className={`det det--${b.type}${b.track ? ' det--track' : ''}${b.main ? ' det--main' : ''}`}
          style={{
            left: `${(b.x / 9999 - (b.w / 10000) / 2) * 100}%`,
            top: `${(b.y / 9999 - (b.h / 10000) / 2) * 100}%`,
            width: `${(b.w / 10000) * 100}%`,
            height: `${(b.h / 10000) * 100}%`,
          }} />
      ))}
      {!onSelect && guide?.status && (
        <div className={`fguide${guide.angle <= 5 ? ' fguide--ok' : ''}`}
          style={{
            left: `${(guide.x / 9999 - (guide.w / 10000) / 2) * 100}%`,
            top: `${(guide.y / 9999 - (guide.h / 10000) / 2) * 100}%`,
            width: `${(guide.w / 10000) * 100}%`,
            height: `${(guide.h / 10000) * 100}%`,
          }}>
          <span className="fguide__dir">{guide.angle <= 5 ? '● focus' : guide.dir === 'front' ? '◂ front ▸' : '▸ back ◂'}</span>
        </div>
      )}
      {!onSelect && type !== 'none' && (
        <button type="button" className="video__detbtn" title="Toggle face detection overlay"
          onClick={(e) => { e.stopPropagation(); setShowDetect((s) => !s); }}>
          {showDetect ? '◉ Faces' : '○ Faces'}
        </button>
      )}
      {recording && <span className="video__tally"><span className="video__dot" /> REC</span>}
      {name && <span className="video__name">{name}</span>}
    </div>
  );
}
