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

  it('iris sets manual exposure and the abstract value', () => {
    expect(buildControlParams('iris', 200)).toEqual({
      'c.1.exp': 'manual',
      'c.1.me.iris': '200',
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
