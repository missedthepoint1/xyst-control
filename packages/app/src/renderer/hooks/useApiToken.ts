import { useEffect, useState } from 'react';

let cached = '';
export function useApiToken(): string {
  const [token, setToken] = useState(cached);
  useEffect(() => {
    if (cached) return;
    // Catch so a failed IPC doesn't become an unhandled rejection; log it (a '' token means every
    // authenticated preview/meta/SSE request 401s, which is otherwise invisible).
    window.xyst.getApiToken()
      .then((t) => { cached = t; setToken(t); })
      .catch((err) => console.error('[useApiToken] failed to resolve API token', err));
  }, []);
  return token;
}

/** Append the token as a query param (img/EventSource can't set headers). Url already has `?t=`. */
export function withToken(url: string, token: string): string {
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}
