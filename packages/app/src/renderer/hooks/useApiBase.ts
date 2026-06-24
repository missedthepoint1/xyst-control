import { useEffect, useState } from 'react';

let cached = '';
export function useApiBase(): string {
  const [base, setBase] = useState(cached);
  useEffect(() => {
    if (cached) return;
    // Catch so a failed IPC doesn't become an unhandled rejection; log it (a '' base means every
    // preview/SSE request silently never loads, which is otherwise invisible).
    window.xyst.getApiBase()
      .then((b) => { cached = b; setBase(b); })
      .catch((err) => console.error('[useApiBase] failed to resolve API base', err));
  }, []);
  return base;
}
