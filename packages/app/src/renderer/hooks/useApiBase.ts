import { useEffect, useState } from 'react';

let cached = '';
export function useApiBase(): string {
  const [base, setBase] = useState(cached);
  useEffect(() => {
    if (cached) return;
    void window.xyst.getApiBase().then((b) => { cached = b; setBase(b); });
  }, []);
  return base;
}
