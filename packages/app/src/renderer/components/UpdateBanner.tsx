import { useState } from 'react';
import { useUpdateStatus } from '../hooks/useUpdateStatus.js';

/**
 * Non-intrusive update banner. Shows only once an update is fully downloaded; the operator
 * chooses when to restart. "Later" hides it for this session; "Skip" suppresses this version
 * permanently. Nothing ever restarts on its own.
 */
export function UpdateBanner() {
  const status = useUpdateStatus();
  const [dismissed, setDismissed] = useState(false);
  if (status.state !== 'downloaded' || dismissed) return null;
  return (
    <div className="update-banner" role="status">
      <span className="update-banner__msg">Update {status.version} ready</span>
      <button className="btn btn--accent" onClick={() => window.xyst.installUpdate()}>Install &amp; Restart</button>
      <button className="btn btn--ghost" onClick={() => { void window.xyst.skipUpdate(status.version); setDismissed(true); }}>Skip this version</button>
      <button className="btn btn--ghost" onClick={() => setDismissed(true)}>Later</button>
    </div>
  );
}
