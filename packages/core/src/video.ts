import type { Quadrant } from './types.js';

/** Grid position of a quadrant: col/row are each 0 or 1. Pure; used for CSS crop offsets. */
export function quadrantPosition(q: Quadrant): { col: 0 | 1; row: 0 | 1 } {
  return { col: (q % 2) as 0 | 1, row: (Math.floor(q / 2)) as 0 | 1 };
}
