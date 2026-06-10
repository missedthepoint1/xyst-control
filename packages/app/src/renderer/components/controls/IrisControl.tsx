import type { ControlState } from '@xyst/core';
import { ControlSlider } from './ControlSlider.js';

export function IrisControl({ c, onSet }: { c: ControlState; onSet: (v: number) => void }) {
  return (
    <ControlSlider
      label="Iris" value={typeof c.value === 'number' ? c.value : undefined}
      min={c.min ?? 0} max={c.max ?? 100} onCommit={onSet}
    />
  );
}
