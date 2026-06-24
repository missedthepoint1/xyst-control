import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { VideoSource } from '@xyst/core';
import { quadrantPosition, imageAreaInTile, type TileFit } from '@xyst/core/video';
import { applyViewAssist, type ResolvedViewAssist } from '../viewAssist.js';
import { useCaptureStream, retryCapture } from '../captureStreams.js';
import { useVideoInputs, resolveDeviceId } from '../videoDevices.js';
import { useApiToken, withToken } from '../hooks/useApiToken.js';
/** Inline crop offsets to bring one quadrant of a 4K frame into view; sizing/fit live in CSS. */
function quadStyle(q: 0 | 1 | 2 | 3): CSSProperties {
  const { col, row } = quadrantPosition(q);
  return { left: `${-col * 100}%`, top: `${-row * 100}%` };
}

type DetectBox = { type: 'face' | 'eye' | 'object'; x: number; y: number; w: number; h: number; main: boolean; track: boolean };
type Guide = { status: boolean; level: number; angle: number; dir: string; x: number; y: number; w: number; h: number };
export type OsdInfo = {
  iso?: string; shutter?: string; iris?: string; wb?: string; nd?: string;
  tc?: string; rec: boolean; remaining?: number; battery?: string;
};

export function VideoPanel({ cameraId, source, recording, apiBase, name, osd, showOsd = true, showTc = true, viewAssist = null, tile = false, onSelect, onFocus }: {
  cameraId: string; source?: VideoSource; recording: boolean; apiBase: string;
  name?: string; osd?: OsdInfo; showOsd?: boolean; showTc?: boolean; viewAssist?: ResolvedViewAssist | null;
  tile?: boolean; onSelect?: () => void; onFocus?: (x: number, y: number) => void;
}) {
  const type = source?.type ?? 'none';
  const token = useApiToken();
  const wrapRef = useRef<HTMLDivElement>(null);
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
  // Tile + media pixel sizes feed imageAreaInTile so overlays track the DISPLAYED image, not the
  // raw tile (which is rarely the media's aspect ratio in the popout grid). setIfChanged keeps the
  // per-frame load callbacks from churning React once the size is known.
  const [tileSize, setTileSize] = useState<{ w: number; h: number } | null>(null);
  const [mediaSize, setMediaSize] = useState<{ w: number; h: number } | null>(null);
  const setIfChanged = (set: typeof setMediaSize, w: number, h: number) =>
    set((p) => (p && p.w === w && p.h === h ? p : { w, h }));

  useEffect(() => {
    if (type !== 'protocol' || !apiBase || !token) return;
    const img = imgRef.current; if (!img) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => { if (!stopped) img.src = withToken(`${apiBase}/api/cameras/${cameraId}/preview.jpg?t=${Date.now()}`, token); };
    const onLoad = () => {
      // Only re-render on the off→on transition; setErr(false) every frame (~11/s) would otherwise
      // churn React continuously once the feed is healthy. Returning the same value bails the update.
      setErr((e) => (e ? false : e));
      if (img.naturalWidth) setIfChanged(setMediaSize, img.naturalWidth, img.naturalHeight);
      // Re-grade in a try/catch so a readback failure (e.g. a tainted canvas) can never stop the
      // poll loop; schedule the next frame regardless. Tiles grade downscaled (see applyViewAssist).
      if (vaRef.current && canvasRef.current) {
        try { applyViewAssist(img, canvasRef.current, vaRef.current.transform, vaRef.current.intensity, tile ? 960 : undefined); }
        catch { /* leave the drawn frame */ }
      }
      timer = setTimeout(load, 90);
    };
    const onError = () => { setErr(true); timer = setTimeout(load, 1000); };
    img.addEventListener('load', onLoad); img.addEventListener('error', onError);
    load();
    return () => { stopped = true; if (timer) clearTimeout(timer); img.removeEventListener('load', onLoad); img.removeEventListener('error', onError); img.removeAttribute('src'); };
  }, [type, apiBase, cameraId, token, tile]);

  // In the multiview TAB, tiles set onSelect and the detection boxes / guide / OSD are all gated by
  // !onSelect below — so polling /meta there would fetch + parse + re-render at 150ms for output that
  // is never shown. Skip the poll in that mode (the popout multiview has no onSelect and still polls).
  const selectable = !!onSelect;
  useEffect(() => {
    if (type === 'none' || !apiBase || !token || !showOsd || selectable) { setBoxes([]); setGuide(null); return; }
    let stopped = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const r = await fetch(withToken(`${apiBase}/api/cameras/${cameraId}/meta?t=${Date.now()}`, token));
        if (r.ok) { const m = await r.json() as { detect?: DetectBox[]; fguide?: Guide }; if (!stopped) { setBoxes(m.detect ?? []); setGuide(m.fguide ?? null); } }
        else { if (!stopped) { setBoxes([]); setGuide(null); } }
      } catch { if (!stopped) { setBoxes([]); setGuide(null); } }
      if (!stopped) timer = setTimeout(poll, 150);
    };
    poll();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [type, apiBase, cameraId, showOsd, token, selectable]);

  const isDeviceSource = type === 'capture' || type === 'quad';
  // Resolve to the device's CURRENT id (it churns on cable/link changes) — match by saved id,
  // then by stable label. A re-enumeration fires devicechange → new id → the stream reopens itself.
  const devices = useVideoInputs();
  const liveDeviceId = isDeviceSource ? resolveDeviceId(source, devices) : undefined;
  const capture = useCaptureStream(liveDeviceId);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = capture.stream;
    // The device feed's intrinsic size (full 16:9 capture, or the 4K quad feed) drives overlay
    // geometry — read it once the stream's metadata arrives, and on each resolution change.
    const onMeta = () => { if (v.videoWidth) setIfChanged(setMediaSize, v.videoWidth, v.videoHeight); };
    v.addEventListener('loadedmetadata', onMeta); v.addEventListener('resize', onMeta); onMeta();
    return () => { v.srcObject = null; v.removeEventListener('loadedmetadata', onMeta); v.removeEventListener('resize', onMeta); };
  }, [capture.stream, type]);
  // Reset the cached media size when the source type changes so a stale aspect ratio (e.g. the
  // protocol JPEG's) never lingers onto a device feed before its metadata loads.
  useEffect(() => { setMediaSize(null); }, [type]);
  // Track the tile's rendered px so overlay geometry follows window/grid resizes live.
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const update = () => setIfChanged(setTileSize, el.clientWidth, el.clientHeight);
    update();
    const ro = new ResizeObserver(update); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const captureErr = isDeviceSource && capture.status === 'error';
  // 4K was requested but the link could only deliver 1080p — quad tiles are then ~960×540, so
  // flag it. Clicking retries 4K (e.g. after the operator reseats the cable into a SuperSpeed port).
  const captureDegraded = isDeviceSource && capture.status === 'live' && capture.degraded;

  // Where the camera's normalized active-image space sits inside the tile, given the current fit.
  // Overlays and the tap inverse both go through this so a tap lands exactly where a box is drawn.
  const fit: TileFit = type === 'quad' ? 'cover-quad' : 'contain';
  const quad = quadrantPosition(source?.quadrant ?? 0);
  const area = imageAreaInTile({
    fit, mediaW: mediaSize?.w ?? 0, mediaH: mediaSize?.h ?? 0,
    tileW: tileSize?.w ?? 0, tileH: tileSize?.h ?? 0, col: quad.col, row: quad.row,
  });

  const tap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (onSelect) { onSelect(); return; }
    // Recompute the fit rect from live element sizes (not the lagging state) so the tap is exact.
    const rect = e.currentTarget.getBoundingClientRect();
    const media = imgRef.current ?? videoRef.current;
    let mw = 0, mh = 0;
    if (media instanceof HTMLImageElement) { mw = media.naturalWidth; mh = media.naturalHeight; }
    else if (media instanceof HTMLVideoElement) { mw = media.videoWidth; mh = media.videoHeight; }
    const a = imageAreaInTile({ fit, mediaW: mw, mediaH: mh, tileW: rect.width, tileH: rect.height, col: quad.col, row: quad.row });
    const fx = (e.clientX - rect.left) / rect.width, fy = (e.clientY - rect.top) / rect.height; // tap as tile fraction
    const nx = (fx - a.ox) / a.sw, ny = (fy - a.oy) / a.sh; // -> normalized active-image coords
    if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return; // tapped outside the active image
    void window.xyst.setFocusPoint(cameraId, nx, ny);
    onFocus?.(nx, ny);
    setMark({ x: fx * 100, y: fy * 100 });
    setTimeout(() => setMark(null), 1500);
  };

  if (type === 'none' && !onSelect) return null;

  return (
    <>
    <div ref={wrapRef} className={`video${recording ? ' video--rec' : ''}${onSelect ? ' video--tile' : ''}`} onClick={tap}>
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
      {type === 'quad' && (
        <video ref={videoRef} className="video__img video__img--quad"
          style={quadStyle(source?.quadrant ?? 0)} autoPlay muted playsInline />
      )}
      {(type === 'none' || err || captureErr) && (
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
      {captureDegraded && (
        <button type="button" className="video__degraded"
          title={`4K unavailable on this link — capture dropped to ${capture.height}p${type === 'quad' ? ` (≈${Math.round(capture.height / 2)}p per tile)` : ''}. Click to retry 4K.`}
          onClick={(e) => { e.stopPropagation(); if (liveDeviceId) retryCapture(liveDeviceId); }}>
          {/* Per-TILE resolution: a quad tile is one quadrant, so it's half the capture height
              (1080p capture → 540p tile; 4K capture → 1080p tile). */}
          ⚠ {type === 'quad' ? Math.round(capture.height / 2) : capture.height}p
        </button>
      )}
      {mark && <span className="video__af" style={{ left: `${mark.x}%`, top: `${mark.y}%` }} />}
      {!onSelect && showOsd && boxes.map((b, i) => (
        <div key={i}
          className={`det det--${b.type}${b.track ? ' det--track' : ''}${b.main ? ' det--main' : ''}`}
          style={{
            left: `${(area.ox + (b.x / 9999 - (b.w / 10000) / 2) * area.sw) * 100}%`,
            top: `${(area.oy + (b.y / 9999 - (b.h / 10000) / 2) * area.sh) * 100}%`,
            width: `${(b.w / 10000) * area.sw * 100}%`,
            height: `${(b.h / 10000) * area.sh * 100}%`,
          }} />
      ))}
      {!onSelect && showOsd && guide?.status && (
        <div className={`fguide${guide.angle <= 5 ? ' fguide--ok' : ''}`}
          style={{
            left: `${(area.ox + (guide.x / 9999 - (guide.w / 10000) / 2) * area.sw) * 100}%`,
            top: `${(area.oy + (guide.y / 9999 - (guide.h / 10000) / 2) * area.sh) * 100}%`,
            width: `${(guide.w / 10000) * area.sw * 100}%`,
            height: `${(guide.h / 10000) * area.sh * 100}%`,
          }}>
          <span className="fguide__dir">{guide.angle <= 5 ? '● focus' : guide.dir === 'front' ? '◂ front ▸' : '▸ back ◂'}</span>
        </div>
      )}
      {!onSelect && showOsd && osd && (
        <div className="osd">
          <div className="osd__top">
            {osd.rec && <span className="osd__rec"><span className="osd__dot" /> REC{osd.remaining != null ? ` · ${osd.remaining}m` : ''}</span>}
            {showTc && osd.tc && <span className="osd__tc">{osd.tc}</span>}
          </div>
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
