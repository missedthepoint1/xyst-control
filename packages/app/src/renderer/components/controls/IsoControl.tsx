import type { ControlState } from '@xyst/core';
import { ControlSelect } from './ControlSelect.js';

export function IsoControl({ c, onSet }: { c: ControlState; onSet: (v: number) => void }) {
  return (
    <ControlSelect
      label="ISO" value={c.value} options={c.list ?? []}
      format={(v) => `ISO ${v}`} onChange={(v) => onSet(Number(v))}
    />
  );
}
