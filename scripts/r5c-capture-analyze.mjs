#!/usr/bin/env node
// Analyze a HAR capture of the Canon EOS R5 C Browser Remote and draft an endpoint map.
//
// Usage:
//   node scripts/r5c-capture-analyze.mjs <capture.har> [--host 192.168.0.50]
//
// Capture the HAR with Chrome DevTools → Network → (operate the Browser Remote) →
// right-click → "Save all as HAR". See docs/r5c-capture.md for the full procedure.

import { readFileSync } from 'node:fs';

const file = process.argv[2];
const hostArg = (() => { const i = process.argv.indexOf('--host'); return i > 0 ? process.argv[i + 1] : undefined; })();
if (!file) { console.error('usage: node scripts/r5c-capture-analyze.mjs <capture.har> [--host <ip>]'); process.exit(1); }

const har = JSON.parse(readFileSync(file, 'utf8'));
const entries = har?.log?.entries ?? [];

// Keyword → endpoint label. First match wins; checked against method+path+body.
const RULES = [
  ['recordStart', /\b(rec(ord)?|capture).*(start|on|begin)|start.*rec|action=start/i],
  ['recordStop', /\b(rec(ord)?|capture).*(stop|off|end)|stop.*rec|action=stop/i],
  ['control:iso', /\biso\b/i],
  ['control:shutter', /\b(shutter|tv|sspeed)\b/i],
  ['control:iris', /\b(iris|av|aperture|fnumber)\b/i],
  ['control:wb', /\b(wb|whitebalance|white_balance|colortemp|kelvin)\b/i],
  ['control:nd', /\bnd\b/i],
  ['control:gain', /\bgain\b/i],
  ['touchAf', /\b(touch|af|focus)\b/i],
  ['liveView', /\b(liveview|live|image|preview|\.jpg|mjpeg|stream)\b/i],
  ['status', /\b(status|state|info|polling|property|getall)\b/i],
  ['login', /\b(login|auth|session|connect)\b/i],
];

const host = hostArg;
const seen = new Map(); // method+path+label -> sample
for (const e of entries) {
  const url = new URL(e.request.url);
  if (host && url.hostname !== host) continue;
  const method = e.request.method;
  const path = url.pathname;
  const query = url.search;
  const body = e.request.postData?.text ?? '';
  const hay = `${method} ${path}${query} ${body}`;
  const label = RULES.find(([, re]) => re.test(hay))?.[0] ?? 'other';
  const key = `${label}|${method} ${path}`;
  if (!seen.has(key)) {
    seen.set(key, {
      label, method, path, query: query || '', body,
      reqType: e.request.postData?.mimeType ?? '',
      status: e.response?.status, resType: e.response?.content?.mimeType ?? '',
      resSnippet: (e.response?.content?.text ?? '').replace(/\s+/g, ' ').slice(0, 160),
    });
  }
}

const rows = [...seen.values()];
const byLabel = (l) => rows.filter((r) => r.label === l || r.label.startsWith(l + ':'));

console.log(`\n=== R5 C Browser Remote capture: ${rows.length} unique requests${host ? ` to ${host}` : ''} ===\n`);
const order = ['status', 'login', 'recordStart', 'recordStop', 'control', 'liveView', 'touchAf', 'other'];
for (const group of order) {
  const list = group === 'control' ? rows.filter((r) => r.label.startsWith('control:')) : byLabel(group).filter((r) => r.label === group);
  if (!list.length) continue;
  console.log(`── ${group} ──`);
  for (const r of list) {
    console.log(`  [${r.label}] ${r.method} ${r.path}${r.query}`);
    if (r.body) console.log(`      body(${r.reqType}): ${r.body.replace(/\s+/g, ' ').slice(0, 160)}`);
    console.log(`      → ${r.status} ${r.resType}  ${r.resSnippet ? `e.g. ${r.resSnippet}` : ''}`);
  }
  console.log('');
}

// Draft endpoint skeleton to paste into packages/core/src/r5c/endpoints.ts
const pick = (l) => rows.find((r) => r.label === l);
const draft = (r) => r ? `{ method: '${r.method}', path: '${r.path}'${r.query ? `, query: ${JSON.stringify(Object.fromEntries(new URLSearchParams(r.query)))}` : ''}${r.body ? ` /* body seen: ${r.body.replace(/\s+/g, ' ').slice(0, 80)} */` : ''} }` : 'null /* not found in capture */';
console.log('── draft for endpoints.ts (verify against the report above) ──\n');
console.log(`  status:      ${draft(pick('status'))},`);
console.log(`  recordStart: ${draft(pick('recordStart'))},`);
console.log(`  recordStop:  ${draft(pick('recordStop'))},`);
console.log(`  liveView:    ${draft(pick('liveView'))},`);
const ctrls = rows.filter((r) => r.label.startsWith('control:'));
if (ctrls.length) {
  console.log('  control: (id, value) => ({');
  for (const r of ctrls) console.log(`    ${r.label.split(':')[1]}: { method: '${r.method}', path: '${r.path}', body: { value } },`);
  console.log('  }[id] ?? null),');
}
console.log('\nNext: paste the verified values into R5C_ENDPOINTS and implement parseStatus() from the status response shown above.\n');
