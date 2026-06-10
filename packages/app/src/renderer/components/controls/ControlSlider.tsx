import { useState, useEffect } from 'react';

export function ControlSlider({ label, value, min, max, format, onCommit }: {
  label: string; value: number | undefined; min: number; max: number;
  format?: (v: number) => string; onCommit: (v: number) => void;
}) {
  const [local, setLocal] = useState(value ?? min);
  useEffect(() => { if (value !== undefined) setLocal(value); }, [value]);
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '88px 1fr 56px', alignItems: 'center', gap: 10 }}>
      <span style={{ color: 'var(--muted)', fontSize: 13 }}>{label}</span>
      <input
        type="range" min={min} max={max} value={local}
        onChange={(e) => setLocal(Number(e.target.value))}
        onMouseUp={() => onCommit(local)}
        onTouchEnd={() => onCommit(local)}
        style={{ accentColor: 'var(--accent)' }}
      />
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {format ? format(local) : local}
      </span>
    </label>
  );
}
