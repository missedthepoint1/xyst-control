import type { ControlState } from '@xyst/core';
import { ControlSelect } from './ControlSelect.js';

const ndLabel = (v: string | number) => (Number(v) === 0 ? 'Clear' : `ND ${v}`);

export function NdControl({ c, onSet }: { c: ControlState; onSet: (v: number) => void }) {
  return (
    <ControlSelect label="ND" value={c.value} options={c.list ?? []}
      format={ndLabel} onChange={(v) => onSet(Number(v))} />
  );
}
