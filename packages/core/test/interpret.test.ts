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

  it('exposes iris as an f-stop list from the lens aperture (diaphragm)', () => {
    expect(snap.controls.iris?.available).toBe(true);
    expect(snap.controls.iris?.value).toBe(400); // f/4 (F-number x100)
    expect(snap.controls.iris?.list).toContain(280); // f/2.8
    expect(snap.controls.iris?.list).toContain(1100); // f/11
  });

  it('reads the multi-cam control params and power', () => {
    expect(snap.controls.isoAuto?.value).toBe('manual');
    expect(snap.controls.ndExtended?.value).toBe('off');
    expect(snap.controls.wbCC?.min).toBe(-20);
    expect(snap.controls.awbHold?.value).toBe('off');
    expect(snap.controls.wbAction?.list).toEqual(['one_shot_a', 'one_shot_b']);
    expect(snap.controls.afMode?.value).toBe('continuous');
    expect(snap.controls.afSpeed?.max).toBe(2);
    expect(snap.controls.afResponse?.min).toBe(-3);
    expect(snap.controls.afLock?.value).toBe('off');
    expect(snap.controls.focusAction?.list).toContain('one_shot');
    expect(snap.power?.source).toBe('battery');
    expect(snap.power?.volt).toBe(14);
  });

  it('surfaces subject tracking (touch-to-select) with its on/off + mode lists', () => {
    expect(snap.controls.focusTracking?.available).toBe(true);
    expect(snap.controls.focusTracking?.value).toBe('off');
    expect(snap.controls.focusTracking?.list).toEqual(['off', 'on']);
    expect(snap.controls.focusTracking?.mode).toBe('mode1');
    expect(snap.controls.focusTracking?.modeList).toEqual(['mode1', 'mode2']);
  });

  it('marks a control unavailable when the camera did not advertise it', () => {
    const snap2 = interpretInfo({ 'c.1.type': 'X', 'f.rec.status': 'rec' });
    expect(snap2.controls.iso).toBeUndefined();
    expect(snap2.record.recording).toBe(true);
  });

  it('reads timecode CONFIG (run/mode/drop-frame); the running value is session-only', () => {
    expect(snap.timecode?.run).toBe('freerun');
    expect(snap.timecode?.dropFrame).toBe(false);
    expect(snap.timecode?.mode).toBe('preset');
    // f.timecode.set is the static PRESET, not the running TC — interpret never sets value.
    expect(snap.timecode?.value).toBeUndefined();
  });

  it('emits no timecode when the body does not advertise timecode config', () => {
    expect(interpretInfo({ 'c.1.type': 'X' }).timecode).toBeUndefined();
    // The preset alone (f.timecode.set) is not the live value, so it produces no timecode object.
    expect(interpretInfo({ 'f.timecode.set': '01:00:05:12' }).timecode).toBeUndefined();
  });

  it('a config-only timecode delta omits the unrelated sub-fields (so merge preserves them)', () => {
    const delta = interpretInfo({ 'f.timecode.run': 'recrun' });
    expect(delta.timecode).toEqual({ run: 'recrun' });
    expect(delta.timecode?.dropFrame).toBeUndefined();
    expect(delta.timecode?.mode).toBeUndefined();
  });

  it('reads shutter angle, focus, face-detect and colorbar', () => {
    expect(snap.controls.shutterAngle?.value).toBe(18000); // 180 deg
    expect(snap.controls.shutterAngle?.list).toContain(36000); // 360 deg
    expect(snap.controls.focus?.value).toBe('manual');
    expect(snap.controls.focus?.list).toEqual(['auto', 'manual']);
    expect(snap.controls.faceDetect?.value).toBe('off');
    expect(snap.controls.colorbar?.value).toBe('off');
  });
});
