import { useState } from 'react';

export function AddCameraForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState('C300 III');
  const [host, setHost] = useState('192.168.100.1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    const id = `cam-${Date.now()}`;
    try {
      await window.xyst.addCamera({ id, name, driver: 'xc', host });
      await window.xyst.connect(id);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const input: React.CSSProperties = {
    background: 'var(--surface-2)', border: '1px solid var(--border)',
    borderRadius: 8, padding: '8px 10px', color: 'var(--text)', width: '100%',
  };

  return (
    <section style={{
      background: 'var(--surface)', border: '1px dashed var(--border)',
      borderRadius: 'var(--radius)', padding: 16, display: 'grid', gap: 10, alignContent: 'start',
    }}>
      <div style={{ fontWeight: 650, color: 'var(--muted)' }}>Add camera</div>
      <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
      <input style={input} value={host} onChange={(e) => setHost(e.target.value)} placeholder="IP address" />
      <button className="btn" disabled={busy} onClick={add}>{busy ? 'Connecting…' : 'Add + Connect'}</button>
      {error && <div style={{ color: 'var(--rec)', fontSize: 12 }}>{error}</div>}
    </section>
  );
}
