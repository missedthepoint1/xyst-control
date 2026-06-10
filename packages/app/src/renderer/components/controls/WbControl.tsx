import type { ControlState } from '@xyst/core';
import { ControlSelect } from './ControlSelect.js';

export function WbControl({ wb, kelvin, onSetWb, onSetKelvin }: {
  wb: ControlState; kelvin?: ControlState;
  onSetWb: (v: string) => void; onSetKelvin: (v: number) => void;
}) {
  return (
    <>
      <ControlSelect label="WB" value={wb.value} options={wb.list ?? []}
        onChange={(v) => onSetWb(String(v))} />
      {wb.value === 'kelvin' && kelvin?.available && (
        <ControlSelect label="Kelvin" value={kelvin.value} options={kelvin.list ?? []}
          format={(v) => `${v}K`} onChange={(v) => onSetKelvin(Number(v))} />
      )}
    </>
  );
}
