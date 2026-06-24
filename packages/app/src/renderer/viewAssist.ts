// App-side view assist for the live preview: re-grade a flat log JPEG to a viewable look without
// touching the camera (the protocol "overview" JPEG follows the recording gamma, so a log body
// sends a washed-out frame). Two flavours: built-in looks (a per-channel 1D tone curve + a global
// saturation lift — fast, approximate) and an imported .cube (a real 3D LUT, trilinearly sampled).
// `intensity` blends the graded result back toward the original frame. Applied to preview only.

export interface Lut3D { size: number; data: Float32Array } // size^3 RGB triplets, R fastest

export interface BuiltinLook { id: string; label: string; lut1d: Uint8ClampedArray; saturation: number }

/** A resolved transform ready to apply: either a 1D look (+saturation) or a 3D LUT. */
export interface ViewAssistTransform { lut1d?: Uint8ClampedArray; lut3d?: Lut3D; saturation?: number }

/** What VideoPanel needs to render view assist: the resolved transform + blend strength. */
export interface ResolvedViewAssist { transform: ViewAssistTransform; intensity: number }

/** Canon C-Log2 transfer: decode a normalised code value (0..1) to scene-linear. */
function clog2Decode(y: number): number {
  const a = 0.281863093, b = 87.09937546, c = 0.035388128;
  return y < c ? -(10 ** ((c - y) / a) - 1) / b : (10 ** ((y - c) / a) - 1) / b;
}

/** C-Log2 decode -> Reinhard highlight rolloff -> ~709 display gamma (tuned vs the C80's canon709). */
function buildClog2Rec709(gain = 1.8): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const lin = Math.max(0, clog2Decode(v / 255) * gain);
    const displayLinear = lin / (1 + lin);
    lut[v] = Math.round((displayLinear ** (1 / 2.2)) * 255);
  }
  return lut;
}

/** A neutral filmic-ish contrast S-curve — a generic view assist for any flat/low-contrast feed. */
function buildGenericContrast(power = 1.4): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const x = v / 255;
    const y = x <= 0.5 ? 0.5 * (2 * x) ** power : 1 - 0.5 * (2 * (1 - x)) ** power;
    lut[v] = Math.round(y * 255);
  }
  return lut;
}

export const BUILTIN_LOOKS: BuiltinLook[] = [
  { id: 'clog2_709', label: 'Canon C-Log2 → 709', lut1d: buildClog2Rec709(), saturation: 1.35 },
  { id: 'generic', label: 'Generic contrast', lut1d: buildGenericContrast(), saturation: 1.2 },
];

export const DEFAULT_LOOK = 'clog2_709';

/** Resolve a built-in look id to a transform (ignores 'cube', which is loaded separately). */
export function builtinTransform(lookId: string): ViewAssistTransform | undefined {
  const look = BUILTIN_LOOKS.find((l) => l.id === lookId);
  return look ? { lut1d: look.lut1d, saturation: look.saturation } : undefined;
}

/** Parse Adobe .cube text into a 3D LUT. Returns null if it isn't a usable 3D cube. */
export function parseCube(text: string): Lut3D | null {
  let size = 0;
  const data: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const sizeMatch = /^LUT_3D_SIZE\s+(\d+)/i.exec(line);
    if (sizeMatch) { size = Number(sizeMatch[1]); continue; }
    if (/^(TITLE|DOMAIN_MIN|DOMAIN_MAX|LUT_1D_SIZE|LUT_3D_INPUT_RANGE)/i.test(line)) continue;
    const nums = line.split(/\s+/).map(Number);
    if (nums.length === 3 && nums.every((n) => Number.isFinite(n))) data.push(nums[0]!, nums[1]!, nums[2]!);
  }
  if (!size || data.length !== size * size * size * 3) return null;
  return { size, data: Float32Array.from(data) };
}

/** Trilinear sample of a 3D LUT at (r,g,b) in 0..1, writing the result (0..1) into `out`. */
function sampleCube(lut: Lut3D, r: number, g: number, b: number, out: [number, number, number]): void {
  const N = lut.size, d = lut.data, m = N - 1;
  const fr = r * m, fg = g * m, fb = b * m;
  const r0 = Math.floor(fr), g0 = Math.floor(fg), b0 = Math.floor(fb);
  const r1 = Math.min(r0 + 1, m), g1 = Math.min(g0 + 1, m), b1 = Math.min(b0 + 1, m);
  const dr = fr - r0, dg = fg - g0, db = fb - b0;
  const at = (ri: number, gi: number, bi: number, ch: number) => d[(ri + gi * N + bi * N * N) * 3 + ch]!;
  for (let ch = 0; ch < 3; ch++) {
    const c00 = at(r0, g0, b0, ch) * (1 - dr) + at(r1, g0, b0, ch) * dr;
    const c10 = at(r0, g1, b0, ch) * (1 - dr) + at(r1, g1, b0, ch) * dr;
    const c01 = at(r0, g0, b1, ch) * (1 - dr) + at(r1, g0, b1, ch) * dr;
    const c11 = at(r0, g1, b1, ch) * (1 - dr) + at(r1, g1, b1, ch) * dr;
    const c0 = c00 * (1 - dg) + c10 * dg;
    const c1 = c01 * (1 - dg) + c11 * dg;
    out[ch] = c0 * (1 - db) + c1 * db;
  }
}

/**
 * Re-grade a loaded preview frame into `canvas` in place: draw it, run the transform over the
 * pixels, blend back toward the original by (1 - intensity). No-op until the image has decoded.
 *
 * `maxWidth` caps the grading resolution: the per-pixel cost scales with area, so for a multiview
 * tile (displayed far smaller than a 1080p frame) we grade a downscaled copy and let CSS scale the
 * canvas up — e.g. 1920→960 is a 4× cut in readback + loop work with no visible loss. Omit it for
 * the full-size single-camera view, which grades at native resolution.
 */
export function applyViewAssist(
  img: HTMLImageElement, canvas: HTMLCanvasElement, t: ViewAssistTransform, intensity: number,
  maxWidth?: number,
): void {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  if (!iw || !ih) return;
  const scale = maxWidth && iw > maxWidth ? maxWidth / iw : 1;
  const w = Math.max(1, Math.round(iw * scale)), h = Math.max(1, Math.round(ih * scale));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  ctx.drawImage(img, 0, 0, w, h);
  const frame = ctx.getImageData(0, 0, w, h);
  const p = frame.data;
  const k = Math.max(0, Math.min(1, intensity));
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < p.length; i += 4) {
    const r0 = p[i]!, g0 = p[i + 1]!, b0 = p[i + 2]!;
    let rg: number, gg: number, bg: number;
    if (t.lut3d) {
      sampleCube(t.lut3d, r0 / 255, g0 / 255, b0 / 255, out);
      rg = out[0] * 255; gg = out[1] * 255; bg = out[2] * 255;
    } else if (t.lut1d) {
      const lut = t.lut1d, s = t.saturation ?? 1;
      rg = lut[r0]!; gg = lut[g0]!; bg = lut[b0]!;
      const avg = (rg + gg + bg) / 3;
      rg = avg + (rg - avg) * s; gg = avg + (gg - avg) * s; bg = avg + (bg - avg) * s;
    } else { continue; }
    // Uint8ClampedArray clamps on assignment.
    p[i] = r0 + (rg - r0) * k;
    p[i + 1] = g0 + (gg - g0) * k;
    p[i + 2] = b0 + (bg - b0) * k;
  }
  ctx.putImageData(frame, 0, 0);
}
