import { useState } from 'react';
import { usePref } from '../hooks/usePref.js';
import { pushRecentHost } from '../recentHosts.js';

/** Pre-fill so the operator types only the last octet; the LAN is a fixed /24 (see CLAUDE.md). */
const HOST_PREFIX = '192.168.10.';

const BODIES = [
  { id: 'c300', label: 'Canon EOS C300 Mark III', driver: 'xc', name: 'C300 III' },
  { id: 'c80', label: 'Canon EOS C80', driver: 'xc', name: 'C80' },
  // Generic XC entry: the driver is fully capability-discovered, so any Canon cinema body on the
  // XC Protocol (C70, XF605, C500 Mk II, …) works the same — this just saves picking C80 + renaming.
  { id: 'xc', label: 'Canon XC — other body', driver: 'xc', name: 'Canon XC' },
  { id: 'r6iii', label: 'Canon EOS R6 Mark III', driver: 'ccapi', name: 'R6 III' },
] as const;
type BodyId = (typeof BODIES)[number]['id'];

/**
 * Reject a malformed host before we try to connect — a dotted-numeric address with an
 * out-of-range octet (e.g. 10.40.268.59) otherwise resolves as a hostname and fails with a
 * confusing "info.cgi failed" later. Hostnames (anything with a letter, e.g. canon-ab.local)
 * pass through for mDNS. CCAPI hosts may carry an optional :port.
 */
function validateHost(raw: string, driver: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return 'Enter the camera’s IP address.';

  let hostPart = trimmed;
  if (driver === 'ccapi') {
    const lastColon = trimmed.lastIndexOf(':');
    if (lastColon !== -1) {
      hostPart = trimmed.slice(0, lastColon);
      const portStr = trimmed.slice(lastColon + 1);
      const port = Number(portStr);
      if (!/^\d+$/.test(portStr) || port < 1 || port > 65535)
        return `Invalid port “${portStr}” — use 1–65535.`;
    }
  }

  // Looks like a numeric IPv4 (only digits and dots) → validate it strictly. Otherwise treat as a hostname.
  if (/^[\d.]+$/.test(hostPart)) {
    const octets = hostPart.split('.');
    if (octets.length !== 4 || octets.some((o) => !/^\d{1,3}$/.test(o) || Number(o) > 255))
      return `“${hostPart}” isn’t a valid IP address — each part must be 0–255 (e.g. 192.168.0.50).`;
  }
  return null;
}

export function AddCameraForm({ onAdded }: { onAdded: () => void }) {
  const [bodyId, setBodyId] = useState<BodyId>('c300');
  const [name, setName] = useState('C300 III');
  const [host, setHost] = useState(HOST_PREFIX);
  // Previously-used hosts (most-recent-first, capped at 10), offered as a datalist on the IP field.
  const [recentHosts, setRecentHosts] = usePref<string[]>('recentHosts', []);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const body = BODIES.find((b) => b.id === bodyId) ?? BODIES[0];
  const pickBody = (id: BodyId) => {
    setBodyId(id);
    setName(BODIES.find((b) => b.id === id)?.name ?? '');
  };

  const add = async () => {
    const hostError = validateHost(host, body.driver);
    if (hostError) { setError(hostError); return; }
    setBusy(true);
    setError(null);
    const id = `cam-${Date.now()}`;
    const auth = username || password ? { username, password } : undefined;
    try {
      await window.xyst.addCamera({ id, name, driver: body.driver, host, auth });
      // The camera now exists in config = "used" — remember its host even if connect fails below.
      setRecentHosts(pushRecentHost(recentHosts, host));
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
      <label className="add__field">
        <span className="add__label">Camera body</span>
        <select className="input" value={bodyId} onChange={(e) => pickBody(e.target.value as BodyId)}>
          {BODIES.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
      </label>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
      <input className="input" value={host} onChange={(e) => setHost(e.target.value)}
        list={recentHosts.length ? 'recent-hosts' : undefined} autoComplete="off"
        placeholder={body.driver === 'ccapi' ? 'IP:port (e.g. 192.168.0.50:8080)' : 'IP address (e.g. 192.168.0.50)'} />
      {recentHosts.length > 0 && (
        <datalist id="recent-hosts">{recentHosts.map((h) => <option key={h} value={h} />)}</datalist>
      )}
      {body.id === 'xc' && <div className="add__hint">Any Canon cinema body on the XC Protocol (C70, XF605, C500 Mk II…). Controls are read from the camera, so only what this body supports will appear.</div>}
      {body.driver === 'ccapi' && <div className="add__hint">R6 III uses CCAPI — include the port the camera shows, and enable CCAPI on the body.</div>}
      <div className="add__hint">Login — only if the camera has user authentication on</div>
      <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username (optional)" autoComplete="off" />
      <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (optional)" autoComplete="off" />
      <button className="btn btn--accent" disabled={busy} onClick={add}>{busy ? 'Connecting…' : 'Add + Connect'}</button>
      {error && <div className="err">{error}</div>}
    </section>
  );
}
