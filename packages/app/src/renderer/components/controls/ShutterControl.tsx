import type { ControlState } from '@xyst/core';
import { ControlSelect } from './ControlSelect.js';
import { ControlSegment } from './ControlSegment.js';

const MODE_LABELS: Record<string, string> = { speed: 'Speed', angle: 'Angle', slow: 'Slow', clearscan: 'Clear' };
const MODE_ORDER = ['speed', 'angle', 'slow', 'clearscan'];

export function ShutterControl({ shutter, angle, onSetMode, onSetSpeed, onSetAngle }: {
  shutter: ControlState; angle?: ControlState;
  onSetMode: (m: string) => void; onSetSpeed: (v: number) => void; onSetAngle: (v: number) => void;
}) {
  const mode = shutter.mode ?? 'speed';
  const modes = MODE_ORDER.filter((m) => (shutter.modeList ?? MODE_ORDER).includes(m));
  return (
    <>
      <ControlSegment label="Shutter" value={mode}
        options={modes.map((m) => ({ value: m, label: MODE_LABELS[m] ?? m }))}
        onChange={(v) => onSetMode(String(v))} />
      {mode === 'angle' && angle?.available ? (
        <ControlSelect label="Angle" value={angle.value} options={angle.list ?? []}
          format={(v) => `${Number(v) / 100}°`} onChange={(v) => onSetAngle(Number(v))} />
      ) : (
        <ControlSelect label="Speed" value={shutter.value} options={shutter.list ?? []}
          format={(v) => `1/${v}`} onChange={(v) => onSetSpeed(Number(v))} />
      )}
    </>
  );
}
