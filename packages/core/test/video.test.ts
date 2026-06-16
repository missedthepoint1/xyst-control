import { describe, it, expect } from 'vitest';
import { quadrantPosition } from '../src/video.js';

describe('quadrantPosition', () => {
  it('maps quadrant indices to grid positions in reading order', () => {
    expect(quadrantPosition(0)).toEqual({ col: 0, row: 0 }); // top-left
    expect(quadrantPosition(1)).toEqual({ col: 1, row: 0 }); // top-right
    expect(quadrantPosition(2)).toEqual({ col: 0, row: 1 }); // bottom-left
    expect(quadrantPosition(3)).toEqual({ col: 1, row: 1 }); // bottom-right
  });
});
