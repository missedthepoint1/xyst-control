export function RecButton({ recording, onToggle }: { recording: boolean; onToggle: () => void }) {
  return (
    <button className={`rec-btn${recording ? ' is-rec' : ''}`} onClick={onToggle}>
      <span className="ic" />
      {recording ? 'RECORDING' : 'RECORD'}
    </button>
  );
}
