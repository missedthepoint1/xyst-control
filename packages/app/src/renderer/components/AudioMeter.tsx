import { useEffect, useRef, useState } from 'react';

/**
 * Stereo audio level meter driven by Web Audio. The camera control protocol carries
 * no audio levels, so this meters the embedded audio from the SDI/HDMI capture feed
 * (or any selected audio input). Bars + peak-hold are animated via refs (rAF), not
 * React state, so the ~60fps updates never re-render the panel.
 */
export function AudioMeter({ deviceId }: { deviceId?: string }) {
  const fills = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const peaks = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!deviceId) return;
    setErr(null);
    let raf = 0; let stopped = false;
    let ctx: AudioContext | undefined; let stream: MediaStream | undefined;

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        const splitter = ctx.createChannelSplitter(2);
        src.connect(splitter);
        const stereo = src.channelCount >= 2;
        const pct = (db: number) => Math.max(0, Math.min(1, (db + 60) / 60)); // -60..0 dBFS → 0..1
        // one entry per visible bar; mono mirrors channel 0 into both bars
        const meters = [0, 1].map((ch) => {
          const analyser = ctx!.createAnalyser();
          analyser.fftSize = 1024;
          splitter.connect(analyser, stereo ? ch : 0);
          return { analyser, buf: new Float32Array(analyser.fftSize), fill: fills[ch]!, peak: peaks[ch]!, hold: 0 };
        });

        const tick = () => {
          if (stopped) return;
          for (const m of meters) {
            m.analyser.getFloatTimeDomainData(m.buf);
            let sum = 0; let pk = 0;
            for (let i = 0; i < m.buf.length; i++) { const v = m.buf[i]!; sum += v * v; const a = Math.abs(v); if (a > pk) pk = a; }
            const rms = Math.sqrt(sum / m.buf.length);
            const lvl = pct(rms > 0 ? 20 * Math.log10(rms) : -100);
            const pkLvl = pct(pk > 0 ? 20 * Math.log10(pk) : -100);
            m.hold = Math.max(m.hold * 0.92, pkLvl); // peak-hold with decay
            // mask covers the UNLIT portion from the top, so the gradient track shows
            // green→red at fixed absolute heights regardless of level.
            const f = m.fill.current; if (f) f.style.transform = `scaleY(${1 - lvl})`;
            const p = m.peak.current; if (p) p.style.bottom = `${m.hold * 100}%`;
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        if (!stopped) setErr('no audio');
      }
    };
    void start();
    return () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); ctx?.close().catch(() => {}); };
  }, [deviceId]);

  if (!deviceId) return null;
  return (
    <div className="ameter" title="Audio levels (L / R)">
      {err ? <span className="ameter__err">{err}</span> : (
        <>
          <div className="ameter__ch"><div ref={fills[0]} className="ameter__mask" /><div ref={peaks[0]} className="ameter__peak" /></div>
          <div className="ameter__ch"><div ref={fills[1]} className="ameter__mask" /><div ref={peaks[1]} className="ameter__peak" /></div>
        </>
      )}
    </div>
  );
}
