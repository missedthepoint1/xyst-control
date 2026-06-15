import { useEffect, useRef, useState } from 'react';
import type { VideoSource } from '@xyst/core';
import { applyViewAssist, type ResolvedViewAssist } from '../viewAssist.js';
type DetectBox = { type: 'face' | 'eye' | 'object'; x: number; y: number; w: number; h: number; main: boolean; track: boolean };
type Guide = { status: boolean; level: number; angle: number; dir: string; x: number; y: number; w: number; h: number };
export type OsdInfo = {
  iso?: string; shutter?: string; iris?: string; wb?: string; nd?: string;
  rec: boolean; remaining?: number; battery?: string;
};

export function VideoPanel({ cameraId, source, recording, apiBase, name, osd, showOsd = true, viewAssist = null, onSelect, onFocus }: {
  cameraId: string; source?: VideoSource; recording: boolean; apiBase: string;
  name?: string; osd?: OsdInfo; showOsd?: boolean; viewAssist?: ResolvedViewAssist | null; onSelect?: () => void; onFocus?: (x: number, y: number) => void;
}) {
  const type = source?.type ?? 'none';
  const imgRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Read the live toggle inside the frame-load callback without restarting the poll loop.
  const vaRef = useRef(viewAssist);
  vaRef.current = viewAssist;
  const [err, setErr] = useState(false);
  const [mark, setMark] = useState<{ x: number; y: number } | null>(null);
  const [boxes, setBoxes] = useState<DetectBox[]>([]);
  const [guide, setGuide] = useState<Guide | null>(null);

  useEffect(() => {
    if (type !== 'protocol' || !apiBase) return;
    const img = imgRef.current; if (!img) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => { if (!stopped) img.src = `${apiBase}/api/cameras/${cameraId}/preview.jpg?t=${Date.now()}`; };
    const onLoad = () => {
      setErr(false);
      // Re-grade in a try/catch so a readback failure (e.g. a tainted canvas) can never stop the
      // poll loop; schedule the next frame regardless.
      if (vaRef.current && canvasRef.current) {
        try { applyViewAssist(img, canvasRef.current, vaRef.current.transform, vaRef.current.intensity); }
        catch { /* leave the drawn frame */ }
      }
      timer = setTimeout(load, 90);
    };
    const onError = () => { setErr(true); timer = setTimeout(load, 1000); };
    img.addEventListener('load', onLoad); img.addEventListener('error', onError);
    load();
    return () => { stopped = true; if (timer) clearTimeout(timer); img.removeEventListener('load', onLoad); img.removeEventListener('error', onError); img.removeAttribute('src'); };
  }, [type, apiBase, cameraId]);

  useEffect(() => {
    if (type === 'none' || !apiBase || !showOsd) { setBoxes([]); setGuide(null); return; }
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
  }, [type, apiBase, cameraId, showOsd]);

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
    <>
    <div className={`video${recording ? ' video--rec' : ''}${onSelect ? ' video--tile' : ''}`} onClick={tap}>
      {type === 'protocol' && (
        <>
          {/* The img is always the frame loader; when view assist is on it's hidden (still loads)
              and the re-graded canvas is shown instead. crossOrigin lets the CORS-enabled preview
              be drawn to a canvas without tainting it (needed for the view-assist pixel readback). */}
          <img ref={imgRef} className="video__img" alt="" crossOrigin="anonymous"
            style={viewAssist ? { display: 'none' } : (err ? { visibility: 'hidden' } : undefined)} />
          {viewAssist && <canvas ref={canvasRef} className="video__img" style={err ? { visibility: 'hidden' } : undefined} />}
        </>
      )}
      {type === 'capture' && <video ref={videoRef} className="video__img" autoPlay muted playsInline />}
      {(type === 'none' || err) && (
        <div className="video__placeholder">
          {type === 'none' ? (
            <svg className="video__ph-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="2.5" y="5" width="19" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          ) : (
            <svg className="video__ph-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 13a11 11 0 0 1 16 0M7 16.5a6 6 0 0 1 10 0M10.5 19.6a1.5 1.5 0 0 1 3 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="3.6" y1="20.4" x2="20.4" y2="3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
          <span className="video__ph-text">{type === 'none' ? 'No video source' : 'No signal'}</span>
        </div>
      )}
      {mark && <span className="video__af" style={{ left: `${mark.x}%`, top: `${mark.y}%` }} />}
      {!onSelect && showOsd && boxes.map((b, i) => (
        <div key={i}
          className={`det det--${b.type}${b.track ? ' det--track' : ''}${b.main ? ' det--main' : ''}`}
          style={{
            left: `${(b.x / 9999 - (b.w / 10000) / 2) * 100}%`,
            top: `${(b.y / 9999 - (b.h / 10000) / 2) * 100}%`,
            width: `${(b.w / 10000) * 100}%`,
            height: `${(b.h / 10000) * 100}%`,
          }} />
      ))}
      {!onSelect && showOsd && guide?.status && (
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
      {!onSelect && showOsd && osd && (
        <div className="osd">
          {osd.rec && <span className="osd__rec"><span className="osd__dot" /> REC{osd.remaining != null ? ` · ${osd.remaining}m` : ''}</span>}
          <div className="osd__bar">
            {osd.iso && <span>{osd.iso}</span>}
            {osd.shutter && <span>{osd.shutter}</span>}
            {osd.iris && <span>{osd.iris}</span>}
            {osd.wb && <span>{osd.wb}</span>}
            {osd.nd && <span>{osd.nd}</span>}
            {osd.battery && <span className="osd__batt">{osd.battery}</span>}
          </div>
        </div>
      )}
      {recording && (onSelect || !osd || !showOsd) && <span className="video__tally"><span className="video__dot" /> REC</span>}
      {name && (onSelect || showOsd) && <span className="video__name">{name}</span>}
    </div>
    </>
  );
}
