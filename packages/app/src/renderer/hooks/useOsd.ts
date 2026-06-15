import { useEffect, useState } from 'react';

/**
 * App-level "show OSD on the multiview feeds" toggle. Reads the initial value over IPC and stays
 * in sync with changes from any source (the popout, the panel, or Companion via the REST API).
 */
export function useOsd(): [boolean, (value: boolean) => void] {
  const [osd, setOsd] = useState(false);
  useEffect(() => {
    let alive = true;
    window.xyst.getOsd().then((v) => { if (alive) setOsd(v); }).catch(() => {});
    const off = window.xyst.onOsd((v) => setOsd(v));
    return () => { alive = false; off(); };
  }, []);
  return [osd, (value: boolean) => { void window.xyst.setOsd(value); }];
}
