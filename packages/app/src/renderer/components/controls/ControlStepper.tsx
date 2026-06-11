export function ControlStepper({ label, value, options, format, onChange }: {
  label: string;
  value: number | undefined;
  options: number[];
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const idx = value === undefined ? -1 : options.indexOf(value);
  const step = (d: number) => {
    if (idx < 0) { if (options[0] !== undefined) onChange(options[0]); return; }
    const ni = Math.min(options.length - 1, Math.max(0, idx + d));
    const nv = options[ni];
    if (nv !== undefined && nv !== value) onChange(nv);
  };
  const display = value === undefined ? '–' : (format ? format(value) : String(value));
  return (
    <label className="ctl ctl--step">
      <span className="ctl__label">{label}</span>
      <div className="stepper">
        <button type="button" className="stepper__btn" onClick={() => step(-1)} disabled={idx <= 0}>−</button>
        <span className="stepper__val">{display}</span>
        <button type="button" className="stepper__btn" onClick={() => step(1)} disabled={idx >= 0 && idx >= options.length - 1}>+</button>
      </div>
    </label>
  );
}
