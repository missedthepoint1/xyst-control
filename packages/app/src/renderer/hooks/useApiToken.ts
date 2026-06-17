import { useEffect, useState } from 'react';

let cached = '';
export function useApiToken(): string {
  const [token, setToken] = useState(cached);
  useEffect(() => {
    if (cached) return;
    void window.xyst.getApiToken().then((t) => { cached = t; setToken(t); });
  }, []);
  return token;
}

/** Append the token as a query param (img/EventSource can't set headers). Url already has `?t=`. */
export function withToken(url: string, token: string): string {
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}
