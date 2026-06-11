export function ControlSegment({ label, value, options, onChange }: {
  label: string;
  value: string | number | undefined;
  options: Array<{ value: string | number; label: string }>;
  onChange: (v: string | number) => void;
}) {
  return (
    <label className="ctl">
      <span className="ctl__label">{label}</span>
      <div className="seg">
        {options.map((o) => (
          <button key={String(o.value)} type="button"
            className={`seg__btn${String(value) === String(o.value) ? ' is-active' : ''}`}
            onClick={() => onChange(o.value)}>{o.label}</button>
        ))}
      </div>
    </label>
  );
}
