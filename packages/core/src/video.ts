import type { Quadrant } from './types.js';

/** Grid position of a quadrant: col/row are each 0 or 1. Pure; used for CSS crop offsets. */
export function quadrantPosition(q: Quadrant): { col: 0 | 1; row: 0 | 1 } {
  return { col: (q % 2) as 0 | 1, row: (Math.floor(q / 2)) as 0 | 1 };
}

/** How the media is fitted into its tile (mirrors the CSS object-fit per source type). */
export type TileFit = 'contain' | 'cover-quad';

/**
 * Rectangle (fractions of the tile, top-left origin) that the camera's normalized active-image
 * space (0..1 in both axes) occupies once the media is drawn into a tile. A normalized point
 * (nx, ny) lands at tile fraction (ox + nx*sw, oy + ny*sh); invert to turn a tap back into
 * normalized coords. Overlays (face/eye boxes, focus guide, AF mark) must be placed through this
 * so they track the *displayed image*, not the raw tile — otherwise they drift whenever the tile
 * isn't the media's native aspect ratio (the popout's grid cells rarely are).
 *
 * - `contain` (protocol JPEG / capture device): letterbox/pillarbox, image centred and shrunk.
 * - `cover-quad` (4K Web Presenter split 2×2): the feed is `object-fit: cover` at 200%, so any
 *   non-16:9 tile scales+crops the feed; the shown quadrant (col,row) is offset accordingly.
 *
 * Returns identity ({0,0,1,1}) when a dimension is unknown (0) so callers fall back to raw tile %.
 */
export function imageAreaInTile(opts: {
  fit: TileFit;
  mediaW: number; mediaH: number; // media intrinsic px (active image area, or full quad feed)
  tileW: number; tileH: number;   // tile px
  col?: 0 | 1; row?: 0 | 1;        // shown quadrant, cover-quad only
}): { ox: number; oy: number; sw: number; sh: number } {
  const { fit, mediaW, mediaH, tileW, tileH } = opts;
  const identity = { ox: 0, oy: 0, sw: 1, sh: 1 };
  if (mediaW <= 0 || mediaH <= 0 || tileW <= 0 || tileH <= 0) return identity;
  const r = mediaW / mediaH; // media aspect ratio
  const a = tileW / tileH;   // tile aspect ratio
  if (fit === 'contain') {
    if (r >= a) { const sh = a / r; return { ox: 0, oy: (1 - sh) / 2, sw: 1, sh }; } // letterbox
    const sw = r / a; return { ox: (1 - sw) / 2, oy: 0, sw, sh: 1 };                 // pillarbox
  }
  // cover-quad: the feed fills a 2×2-tile box via cover, then quadrant (col,row) is shown.
  const col = opts.col ?? 0, row = opts.row ?? 0;
  if (r >= a) { const sw = r / a; return { ox: (1 - col) * (1 - sw), oy: 0, sw, sh: 1 }; } // crop sides
  const sh = a / r; return { ox: 0, oy: (1 - row) * (1 - sh), sw: 1, sh };                 // crop top/bottom
}
