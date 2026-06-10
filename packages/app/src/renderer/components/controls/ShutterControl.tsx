import type { ControlState } from '@xyst/core';
import { ControlSelect } from './ControlSelect.js';

export function ShutterControl({ c, onSet }: { c: ControlState; onSet: (v: number) => void }) {
  return (
    <ControlSelect
      label="Shutter" value={c.value} options={c.list ?? []}
      format={(v) => `1/${v}`} onChange={(v) => onSet(Number(v))}
    />
  );
}
