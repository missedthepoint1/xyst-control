import { describe, it, expect } from 'vitest';
import { buildControlParams, buildRecordParams, buildSettingsParams } from '../src/xc/commands.js';

describe('buildRecordParams', () => {
  it('maps start/stop to f.rec', () => {
    expect(buildRecordParams(true)).toEqual({ 'f.rec': 'on' });
    expect(buildRecordParams(false)).toEqual({ 'f.rec': 'off' });
  });
});

describe('buildControlParams', () => {
  it('ISO forces the body into manual exposure + manual ISO', () => {
    expect(buildControlParams('iso', 800)).toEqual({
      'c.1.exp': 'manual',
      'c.1.me.isogain.mode': 'iso',
      'c.1.me.iso.mode': 'manual',
      'c.1.me.iso': '800',
    });
  });

  it('shutter sets manual exposure and a concrete speed mode', () => {
    expect(buildControlParams('shutter', 2000)).toEqual({
      'c.1.exp': 'manual',
      'c.1.me.shutter.mode': 'speed',
      'c.1.me.shutter': '2000',
    });
  });

  it('iris sets manual exposure and the lens aperture (F-number x100)', () => {
    expect(buildControlParams('iris', 400)).toEqual({
      'c.1.exp': 'manual',
      'c.1.me.diaphragm': '400',
    });
  });

  it('wb preset sets c.1.wb directly', () => {
    expect(buildControlParams('wb', 'daylight')).toEqual({ 'c.1.wb': 'daylight' });
  });

  it('wbKelvin selects kelvin mode then the value', () => {
    expect(buildControlParams('wbKelvin', 5600)).toEqual({
      'c.1.wb': 'kelvin',
      'c.1.wb.kelvin': '5600',
    });
  });

  it('nd sets the filter value', () => {
    expect(buildControlParams('nd', 400)).toEqual({ 'c.1.nd.filter': '400' });
  });

  it('gain forces manual exposure + manual gain in gain mode', () => {
    expect(buildControlParams('gain', 120)).toEqual({
      'c.1.exp': 'manual',
      'c.1.me.isogain.mode': 'gain',
      'c.1.me.gain.mode': 'manual',
      'c.1.me.gain': '120',
    });
  });

  it('shutterMode sets the shutter mode under manual exposure', () => {
    expect(buildControlParams('shutterMode', 'angle')).toEqual({
      'c.1.exp': 'manual', 'c.1.me.shutter.mode': 'angle',
    });
  });
  it('shutterAngle sets angle mode and the angle value (deg x100)', () => {
    expect(buildControlParams('shutterAngle', 18000)).toEqual({
      'c.1.exp': 'manual', 'c.1.me.shutter.mode': 'angle', 'c.1.me.angle': '18000',
    });
  });
  it('focus toggles AF/MF', () => {
    expect(buildControlParams('focus', 'auto')).toEqual({ 'c.1.focus': 'auto' });
  });
  it('faceDetect sets the detect mode', () => {
    expect(buildControlParams('faceDetect', 'facecatch')).toEqual({ 'c.1.focus.detect': 'facecatch' });
  });
  it('colorbar toggles color bars', () => {
    expect(buildControlParams('colorbar', 'on')).toEqual({ 'c.1.colorbar': 'on' });
  });
  it('isoAuto sets ISO auto/manual mode', () => {
    expect(buildControlParams('isoAuto', 'auto')).toEqual({ 'c.1.me.iso.mode': 'auto' });
  });
  it('ndExtended toggles the extended ND range', () => {
    expect(buildControlParams('ndExtended', 'on')).toEqual({ 'c.1.nd.filter.extended': 'on' });
  });
  it('wbCC sets color compensation', () => {
    expect(buildControlParams('wbCC', -5)).toEqual({ 'c.1.wb.kelvin.cc': '-5' });
  });
  it('awbHold toggles AWB hold', () => {
    expect(buildControlParams('awbHold', 'on')).toEqual({ 'c.1.wb.awbhold': 'on' });
  });
  it('wbAction triggers a one-shot AWB set', () => {
    expect(buildControlParams('wbAction', 'one_shot_a')).toEqual({ 'c.1.wb.action': 'one_shot_a' });
  });
  it('afMode/afSpeed/afResponse/afLock map to focus.auto params', () => {
    expect(buildControlParams('afMode', 'afboosted')).toEqual({ 'c.1.focus.auto': 'afboosted' });
    expect(buildControlParams('afSpeed', 2)).toEqual({ 'c.1.focus.auto.speed': '2' });
    expect(buildControlParams('afResponse', -1)).toEqual({ 'c.1.focus.auto.resp': '-1' });
    expect(buildControlParams('afLock', 'on')).toEqual({ 'c.1.focus.auto.lock': 'on' });
  });
  it('focusAction triggers a focus action (one-shot AF / MF push)', () => {
    expect(buildControlParams('focusAction', 'one_shot')).toEqual({ 'c.1.focus.action': 'one_shot' });
  });
});

describe('buildSettingsParams', () => {
  it('merges multiple controls into one param object', () => {
    const params = buildSettingsParams({ iso: 800, nd: 400, wbKelvin: 5600 });
    expect(params).toMatchObject({
      'c.1.exp': 'manual',
      'c.1.me.isogain.mode': 'iso',
      'c.1.me.iso.mode': 'manual',
      'c.1.me.iso': '800',
      'c.1.wb': 'kelvin',
      'c.1.wb.kelvin': '5600',
      'c.1.nd.filter': '400',
    });
  });

  it('returns an empty object for empty settings', () => {
    expect(buildSettingsParams({})).toEqual({});
  });

  it('later controls override shared keys deterministically', () => {
    const params = buildSettingsParams({ iso: 400, shutter: 125 });
    expect(params['c.1.exp']).toBe('manual');
    expect(params['c.1.me.iso']).toBe('400');
    expect(params['c.1.me.shutter']).toBe('125');
  });
});
