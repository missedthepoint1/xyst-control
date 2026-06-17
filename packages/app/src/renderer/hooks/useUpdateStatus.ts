import { useEffect, useState } from 'react';

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

export function useUpdateStatus(): UpdateStatus {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  useEffect(() => {
    const off = window.xyst.onUpdateStatus((s) => setStatus(s as UpdateStatus));
    return () => { off(); };
  }, []);
  return status;
}
