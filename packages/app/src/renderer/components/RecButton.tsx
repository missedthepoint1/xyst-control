export function RecButton({ recording, onToggle }: { recording: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
        borderRadius: 10, border: '1px solid var(--border)', fontWeight: 650,
        background: recording ? 'var(--rec)' : 'var(--surface-2)',
        boxShadow: recording ? '0 0 18px var(--rec-glow)' : 'none',
        color: recording ? '#fff' : 'var(--text)',
      }}
    >
      <span style={{
        width: 12, height: 12, borderRadius: '50%',
        background: recording ? '#fff' : 'var(--rec)',
      }} />
      {recording ? 'RECORDING' : 'RECORD'}
    </button>
  );
}
