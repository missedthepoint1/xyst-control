import type { ControlState } from '@xyst/core';
import { ControlSelect } from './ControlSelect.js';
import { ControlStepper } from './ControlStepper.js';

export function WbControl({ wb, kelvin, onSetWb, onSetKelvin }: {
  wb: ControlState; kelvin?: ControlState;
  onSetWb: (v: string) => void; onSetKelvin: (v: number) => void;
}) {
  return (
    <>
      <ControlSelect label="WB" value={wb.value} options={wb.list ?? []}
        onChange={(v) => onSetWb(String(v))} />
      {wb.value === 'kelvin' && kelvin?.available && (
        <ControlStepper label="Kelvin"
          value={typeof kelvin.value === 'number' ? kelvin.value : undefined}
          options={(kelvin.list ?? []).map(Number)}
          format={(v) => `${v}K`} onChange={onSetKelvin} />
      )}
    </>
  );
}
