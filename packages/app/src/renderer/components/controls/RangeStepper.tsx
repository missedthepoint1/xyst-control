export function RangeStepper({ label, value, min, max, step = 1, format, onChange }: {
  label: string; value: number | undefined; min: number; max: number; step?: number;
  format?: (v: number) => string; onChange: (v: number) => void;
}) {
  const v = value ?? min;
  const set = (d: number) => {
    const nv = Math.min(max, Math.max(min, v + d * step));
    if (nv !== v) onChange(nv);
  };
  const display = value === undefined ? '–' : (format ? format(value) : String(value));
  return (
    <label className="ctl ctl--step">
      <span className="ctl__label">{label}</span>
      <div className="stepper">
        <button type="button" className="stepper__btn" onClick={() => set(-1)} disabled={v <= min}>−</button>
        <span className="stepper__val">{display}</span>
        <button type="button" className="stepper__btn" onClick={() => set(1)} disabled={v >= max}>+</button>
      </div>
    </label>
  );
}
