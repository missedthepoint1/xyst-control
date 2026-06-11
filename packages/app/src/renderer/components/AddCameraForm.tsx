import { useState } from 'react';

export function AddCameraForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState('C300 III');
  const [host, setHost] = useState('192.168.100.1');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    const id = `cam-${Date.now()}`;
    const auth = username || password ? { username, password } : undefined;
    try {
      await window.xyst.addCamera({ id, name, driver: 'xc', host, auth });
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
      <input className="input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="IP address (e.g. 192.168.0.50)" />
      <div className="add__hint">Login — only if the camera has user authentication on</div>
      <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username (optional)" autoComplete="off" />
      <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (optional)" autoComplete="off" />
      <button className="btn btn--accent" disabled={busy} onClick={add}>{busy ? 'Connecting…' : 'Add + Connect'}</button>
      {error && <div className="err">{error}</div>}
    </section>
  );
}
