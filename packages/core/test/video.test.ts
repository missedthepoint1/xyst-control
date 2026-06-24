import { describe, it, expect } from 'vitest';
import { quadrantPosition, imageAreaInTile } from '../src/video.js';

describe('quadrantPosition', () => {
  it('maps quadrant indices to grid positions in reading order', () => {
    expect(quadrantPosition(0)).toEqual({ col: 0, row: 0 }); // top-left
    expect(quadrantPosition(1)).toEqual({ col: 1, row: 0 }); // top-right
    expect(quadrantPosition(2)).toEqual({ col: 0, row: 1 }); // bottom-left
    expect(quadrantPosition(3)).toEqual({ col: 1, row: 1 }); // bottom-right
  });
});

// imageAreaInTile maps the camera's normalized active-image space (0..1 in both axes) onto the
// tile it's drawn in, accounting for how the media is fitted. It returns the rect (fractions of
// the tile) the image occupies: a normalized point (nx,ny) lands at (ox + nx*sw, oy + ny*sh).
describe('imageAreaInTile', () => {
  const approx = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);
  const expectRect = (r: { ox: number; oy: number; sw: number; sh: number }, e: typeof r) => {
    approx(r.ox, e.ox); approx(r.oy, e.oy); approx(r.sw, e.sw); approx(r.sh, e.sh);
  };

  describe('contain (protocol / capture)', () => {
    it('fills the tile 1:1 when media and tile aspect ratios match', () => {
      expectRect(imageAreaInTile({ fit: 'contain', mediaW: 1920, mediaH: 1080, tileW: 320, tileH: 180 }),
        { ox: 0, oy: 0, sw: 1, sh: 1 });
    });

    it('letterboxes top/bottom when the media is wider than the tile', () => {
      // 16:9 media in a 16:10 tile (taller) -> full width, shrunk + centred vertically.
      const sh = (320 / 200) / (1920 / 1080); // tileAR / mediaAR
      expectRect(imageAreaInTile({ fit: 'contain', mediaW: 1920, mediaH: 1080, tileW: 320, tileH: 200 }),
        { ox: 0, oy: (1 - sh) / 2, sw: 1, sh });
    });

    it('pillarboxes left/right when the media is narrower than the tile', () => {
      // 16:9 media in a 2:1 tile (wider) -> full height, shrunk + centred horizontally.
      const sw = (1920 / 1080) / (400 / 200); // mediaAR / tileAR
      expectRect(imageAreaInTile({ fit: 'contain', mediaW: 1920, mediaH: 1080, tileW: 400, tileH: 200 }),
        { ox: (1 - sw) / 2, oy: 0, sw, sh: 1 });
    });
  });

  describe('cover-quad (Web Presenter 4K split into quadrants)', () => {
    it('maps a quadrant 1:1 when the tile is exactly 16:9', () => {
      for (const [col, row] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        expectRect(imageAreaInTile({ fit: 'cover-quad', mediaW: 3840, mediaH: 2160, tileW: 320, tileH: 180, col, row }),
          { ox: 0, oy: 0, sw: 1, sh: 1 });
      }
    });

    it('crops the sides (scales x) when the tile is narrower than 16:9', () => {
      // tile 100x100 (AR 1.0), feed 16:9 (1.778) -> cover scales to height, sides cropped.
      const r = 16 / 9, a = 100 / 100;
      // top-left quadrant
      expectRect(imageAreaInTile({ fit: 'cover-quad', mediaW: 3840, mediaH: 2160, tileW: 100, tileH: 100, col: 0, row: 0 }),
        { ox: (1 - 0) * (1 - r / a), oy: 0, sw: r / a, sh: 1 });
      // top-right quadrant: ox collapses to 0
      expectRect(imageAreaInTile({ fit: 'cover-quad', mediaW: 3840, mediaH: 2160, tileW: 100, tileH: 100, col: 1, row: 0 }),
        { ox: 0, oy: 0, sw: r / a, sh: 1 });
    });

    it('crops top/bottom (scales y) when the tile is wider than 16:9', () => {
      // tile 200x100 (AR 2.0), feed 16:9 (1.778) -> cover scales to width, top/bottom cropped.
      const r = 16 / 9, a = 200 / 100;
      // top-left quadrant
      expectRect(imageAreaInTile({ fit: 'cover-quad', mediaW: 3840, mediaH: 2160, tileW: 200, tileH: 100, col: 0, row: 0 }),
        { ox: 0, oy: (1 - 0) * (1 - a / r), sw: 1, sh: a / r });
      // bottom-left quadrant: oy collapses to 0
      expectRect(imageAreaInTile({ fit: 'cover-quad', mediaW: 3840, mediaH: 2160, tileW: 200, tileH: 100, col: 0, row: 1 }),
        { ox: 0, oy: 0, sw: 1, sh: a / r });
    });
  });

  it('falls back to identity when sizes are unknown (zero)', () => {
    expectRect(imageAreaInTile({ fit: 'contain', mediaW: 0, mediaH: 0, tileW: 320, tileH: 180 }),
      { ox: 0, oy: 0, sw: 1, sh: 1 });
    expectRect(imageAreaInTile({ fit: 'cover-quad', mediaW: 3840, mediaH: 2160, tileW: 0, tileH: 0, col: 0, row: 0 }),
      { ox: 0, oy: 0, sw: 1, sh: 1 });
  });
});
