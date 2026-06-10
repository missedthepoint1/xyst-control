// Standalone in-memory XC Protocol "sim camera" for visual/dev runs.
// Serves the C300 III fixture over info.cgi / control.cgi / info.cgi?type=stream
// on 127.0.0.1:8099. Not used in tests (those use packages/core/test/fake-camera.ts).
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const fixture = readFileSync(
  new URL('../packages/core/test/fixtures/info-c300mk3.txt', import.meta.url),
  'utf8',
);
const state = {};
for (const line of fixture.split('\n')) {
  const i = line.indexOf(':=');
  if (i > 0) state[line.slice(0, i).trim()] = line.slice(i + 2).trim();
}

const BOUNDARY = 'xystbnd';
const streams = new Set();
const frame = (map) => {
  const body = Object.entries(map).map(([k, v]) => `${k}:=${v}`).join('\n');
  return `--${BOUNDARY}\r\nContent-Type: text/plain\r\n\r\n${body}\r\n`;
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '', 'http://x');
  const cmd = url.pathname.replace('/-wvhttp-01-/', '');

  if (cmd === 'info.cgi' && url.searchParams.get('type') === 'stream') {
    res.writeHead(200, {
      'content-type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
      'livescope-status': '0',
    });
    streams.add(res);
    req.on('close', () => streams.delete(res));
    res.write(frame(state));
    return;
  }

  if (cmd === 'control.cgi') {
    const changed = {};
    for (const [k, v] of url.searchParams) {
      if (k.startsWith('c.') || k.startsWith('f.')) { state[k] = v; changed[k] = v; }
    }
    const rec = url.searchParams.get('f.rec');
    if (rec === 'on') { state['f.rec.status'] = 'rec'; changed['f.rec.status'] = 'rec'; }
    if (rec === 'off') { state['f.rec.status'] = 'idle'; changed['f.rec.status'] = 'idle'; }
    if (Object.keys(changed).length) for (const s of streams) s.write(frame(changed));
  }

  const body = Object.entries(state).map(([k, v]) => `${k}:=${v}`).join('\n');
  res.writeHead(200, { 'content-type': 'text/plain;charset=utf-8', 'livescope-status': '0' });
  res.end(body);
});

server.listen(8099, '127.0.0.1', () => console.log('sim camera on 127.0.0.1:8099'));
