import type { ControlState } from '@xyst/core';
import { ControlSelect } from './ControlSelect.js';

// ND value encodes the light reduction: value/100 = ND factor (2^stops).
// 0 = clear, 400 = 1/4 (2 stops), 1600 = 1/16 (4 stops), 6400 = 1/64 (6 stops).
const ndLabel = (v: string | number) => {
  const n = Number(v);
  if (n <= 0) return 'Clear';
  const stops = Math.round(Math.log2(n / 100));
  return `${stops} stop${stops === 1 ? '' : 's'}`;
};

export function NdControl({ c, onSet }: { c: ControlState; onSet: (v: number) => void }) {
  return (
    <ControlSelect label="ND" value={c.value} options={c.list ?? []}
      format={ndLabel} onChange={(v) => onSet(Number(v))} />
  );
}
