/** Incremental Server-Sent-Events parser. Calls back with (event, data) per block. */
export class SseParser {
  private buf = '';
  private event = 'message';
  private data: string[] = [];

  constructor(private onEvent: (event: string, data: string) => void) {}

  push(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, nl).replace(/\r$/, '');
      this.buf = this.buf.slice(nl + 1);
      this.line(line);
    }
  }

  private line(line: string): void {
    if (line === '') { // dispatch on blank line
      if (this.data.length > 0) this.onEvent(this.event, this.data.join('\n'));
      this.event = 'message';
      this.data = [];
      return;
    }
    if (line.startsWith(':')) return; // comment / keepalive
    const idx = line.indexOf(':');
    const field = idx === -1 ? line : line.slice(0, idx);
    let value = idx === -1 ? '' : line.slice(idx + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.event = value;
    else if (field === 'data') this.data.push(value);
  }
}

export interface SseHandle { close(): void }

/** Subscribe to an SSE endpoint; reconnects on drop until closed. */
export function subscribeEvents(
  url: string,
  onEvent: (event: string, data: string) => void,
  onError?: (err: Error) => void,
): SseHandle {
  let closed = false;
  let ctrl = new AbortController();

  const run = async (): Promise<void> => {
    while (!closed) {
      ctrl = new AbortController();
      try {
        const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'text/event-stream' } });
        if (!res.body) throw new Error(`SSE ${res.status}`);
        const parser = new SseParser(onEvent);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        while (!closed) {
          const { value, done } = await reader.read();
          if (done) break;
          parser.push(dec.decode(value, { stream: true }));
        }
      } catch (err) {
        if (!closed) onError?.(err instanceof Error ? err : new Error(String(err)));
      }
      if (!closed) await new Promise((r) => setTimeout(r, 2000)); // reconnect backoff
    }
  };
  void run();
  return { close: () => { closed = true; ctrl.abort(); } };
}
