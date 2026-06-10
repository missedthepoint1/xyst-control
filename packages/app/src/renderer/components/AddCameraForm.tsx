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

  return (
    <section className="card add">
      <div className="add__title"><span className="plus">+</span> Add camera</div>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
      <input className="input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="IP address" />
      <button className="btn btn--accent" disabled={busy} onClick={add}>{busy ? 'Connecting…' : 'Add + Connect'}</button>
      {error && <div className="err">{error}</div>}
    </section>
  );
}
