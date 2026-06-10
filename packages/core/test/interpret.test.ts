import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseXcBody } from '../src/xc/parse.js';
import { interpretInfo } from '../src/xc/interpret.js';

const fixture = readFileSync(
  fileURLToPath(new URL('./fixtures/info-c300mk3.txt', import.meta.url)),
  'utf8',
);

describe('interpretInfo', () => {
  const snap = interpretInfo(parseXcBody(fixture));

  it('reads model, exposure mode and record state', () => {
    expect(snap.model).toBe('Canon EOS C300 Mark III');
    expect(snap.exposureMode).toBe('manual');
    expect(snap.record.recording).toBe(false);
    expect(snap.record.remainingMinutes).toBe(120);
  });

  it('reads ISO with its discrete list', () => {
    expect(snap.controls.iso?.available).toBe(true);
    expect(snap.controls.iso?.value).toBe(800);
    expect(snap.controls.iso?.list).toContain(102400);
    expect(snap.controls.iso?.mode).toBe('manual');
  });

  it('reads shutter, wb preset+kelvin and nd', () => {
    expect(snap.controls.shutter?.value).toBe(2000);
    expect(snap.controls.shutter?.mode).toBe('speed');
    expect(snap.controls.wb?.value).toBe('kelvin');
    expect(snap.controls.wbKelvin?.value).toBe(5600);
    expect(snap.controls.nd?.value).toBe(400);
    expect(snap.controls.nd?.list).toEqual([0, 400, 1600, 6400]);
  });

  it('exposes iris as a range only when the lens advertises one', () => {
    expect(snap.controls.iris?.available).toBe(true);
    expect(snap.controls.iris?.min).toBe(108);
    expect(snap.controls.iris?.max).toBe(250);
  });

  it('marks a control unavailable when the camera did not advertise it', () => {
    const snap2 = interpretInfo({ 'c.1.type': 'X', 'f.rec.status': 'rec' });
    expect(snap2.controls.iso).toBeUndefined();
    expect(snap2.record.recording).toBe(true);
  });
});
