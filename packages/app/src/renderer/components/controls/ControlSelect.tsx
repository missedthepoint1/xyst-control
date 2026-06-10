export function ControlSelect({ label, value, options, format, onChange }: {
  label: string;
  value: string | number | undefined;
  options: Array<string | number>;
  format?: (v: string | number) => string;
  onChange: (v: string | number) => void;
}) {
  return (
    <label className="ctl">
      <span className="ctl__label">{label}</span>
      <select
        className="select"
        value={String(value ?? '')}
        onChange={(e) => {
          const raw = e.target.value;
          const n = Number(raw);
          onChange(raw !== '' && Number.isFinite(n) ? n : raw);
        }}
      >
        {options.map((o) => (
          <option key={String(o)} value={String(o)}>{format ? format(o) : String(o)}</option>
        ))}
      </select>
    </label>
  );
}
