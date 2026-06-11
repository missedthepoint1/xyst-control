import type { ControlState } from '@xyst/core';
import { ControlSelect } from './ControlSelect.js';

// diaphragm value is the F-number x100 (e.g. 400 -> f/4, 280 -> f/2.8).
const fstop = (v: string | number) => {
  const f = Number(v) / 100;
  return `f/${Number.isInteger(f) ? f : f.toFixed(1)}`;
};

export function IrisControl({ c, onSet }: { c: ControlState; onSet: (v: number) => void }) {
  return (
    <ControlSelect label="Iris" value={c.value} options={c.list ?? []}
      format={fstop} onChange={(v) => onSet(Number(v))} />
  );
}
