import { describe, it, expect } from 'vitest';
import { SseParser } from '../src/sse.js';

describe('SseParser', () => {
  it('parses complete events split across chunks', () => {
    const events: Array<{ event: string; data: string }> = [];
    const p = new SseParser((e, d) => events.push({ event: e, data: d }));
    p.push('event: state\ndata: {"camera');
    p.push('Id":"cam-1"}\n\n');
    p.push('event: status\ndata: {}\n\n');
    expect(events).toEqual([
      { event: 'state', data: '{"cameraId":"cam-1"}' },
      { event: 'status', data: '{}' },
    ]);
  });

  it('ignores comment/keepalive lines', () => {
    const events: Array<{ event: string; data: string }> = [];
    const p = new SseParser((e, d) => events.push({ event: e, data: d }));
    p.push(': ping\n\n');
    p.push('event: hello\ndata: {}\n\n');
    expect(events).toEqual([{ event: 'hello', data: '{}' }]);
  });

  it('handles CRLF line endings and multi-line data', () => {
    const events: Array<{ event: string; data: string }> = [];
    const p = new SseParser((e, d) => events.push({ event: e, data: d }));
    p.push('data: line1\r\ndata: line2\r\n\r\n');
    expect(events).toEqual([{ event: 'message', data: 'line1\nline2' }]);
  });
});
