export function ControlSelect({ label, value, options, format, onChange }: {
  label: string;
  value: string | number | undefined;
  options: Array<string | number>;
  format?: (v: string | number) => string;
  onChange: (v: string | number) => void;
}) {
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '88px 1fr', alignItems: 'center', gap: 10 }}>
      <span style={{ color: 'var(--muted)', fontSize: 13 }}>{label}</span>
      <select
        value={String(value ?? '')}
        onChange={(e) => {
          const raw = e.target.value;
          const n = Number(raw);
          onChange(raw !== '' && Number.isFinite(n) ? n : raw);
        }}
        style={{
          background: 'var(--surface-2)', color: 'var(--text)',
          border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px',
        }}
      >
        {options.map((o) => (
          <option key={String(o)} value={String(o)}>{format ? format(o) : String(o)}</option>
        ))}
      </select>
    </label>
  );
}
