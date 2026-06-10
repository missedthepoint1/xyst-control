import { useState, useEffect } from 'react';

export function ControlSlider({ label, value, min, max, format, onCommit }: {
  label: string; value: number | undefined; min: number; max: number;
  format?: (v: number) => string; onCommit: (v: number) => void;
}) {
  const [local, setLocal] = useState(value ?? min);
  useEffect(() => { if (value !== undefined) setLocal(value); }, [value]);
  const pct = max > min ? ((local - min) / (max - min)) * 100 : 0;
  return (
    <label className="ctl ctl--slider">
      <span className="ctl__label">{label}</span>
      <input
        className="range"
        type="range" min={min} max={max} value={local}
        style={{ ['--pct' as string]: `${pct}%` }}
        onChange={(e) => setLocal(Number(e.target.value))}
        onMouseUp={() => onCommit(local)}
        onTouchEnd={() => onCommit(local)}
      />
      <span className="ctl__value">{format ? format(local) : local}</span>
    </label>
  );
}
