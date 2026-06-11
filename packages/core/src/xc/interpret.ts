import type { CameraSnapshot, ControlState, ControlId } from '../types.js';

type Map = Record<string, string>;

const num = (v: string | undefined): number | undefined => {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Split a comma list, coercing each item to a number when fully numeric. */
const list = (v: string | undefined): Array<string | number> | undefined => {
  if (v === undefined) return undefined;
  return v.split(',').map((s) => {
    const t = s.trim();
    const n = Number(t);
    return t !== '' && Number.isFinite(n) ? n : t;
  });
};

export function interpretInfo(map: Map): CameraSnapshot {
  const controls: Partial<Record<ControlId, ControlState>> = {};

  if ('c.1.me.iso' in map) {
    controls.iso = {
      id: 'iso',
      available: true,
      value: num(map['c.1.me.iso']),
      list: list(map['c.1.me.iso.list']),
      mode: map['c.1.me.iso.mode'],
      modeList: list(map['c.1.me.iso.mode.list'])?.map(String),
    };
  }
  if ('c.1.me.gain' in map) {
    controls.gain = {
      id: 'gain',
      available: true,
      value: num(map['c.1.me.gain']),
      min: num(map['c.1.me.gain.min']),
      max: num(map['c.1.me.gain.max']),
      unit: 'dB',
    };
  }
  if ('c.1.me.shutter' in map) {
    controls.shutter = {
      id: 'shutter',
      available: true,
      value: num(map['c.1.me.shutter']) ?? map['c.1.me.shutter'],
      list: list(map['c.1.me.shutter.list']),
      mode: map['c.1.me.shutter.mode'],
      modeList: list(map['c.1.me.shutter.mode.list'])?.map(String),
    };
  }
  if ('c.1.me.angle' in map) {
    controls.shutterAngle = {
      id: 'shutterAngle',
      available: true,
      value: num(map['c.1.me.angle']),
      list: list(map['c.1.me.angle.list']),
      unit: 'deg',
    };
  }
  // Iris uses the lens aperture (F-number x100, e.g. 400 = f/4), advertised as a
  // discrete list. The abstract `c.1.me.iris` value is for PTZ servo bodies; cinema
  // bodies report a real F-number via `c.1.me.diaphragm`. Offered only when a
  // compatible lens advertises a list.
  if ('c.1.me.diaphragm' in map && 'c.1.me.diaphragm.list' in map) {
    controls.iris = {
      id: 'iris',
      available: true,
      value: num(map['c.1.me.diaphragm']),
      list: list(map['c.1.me.diaphragm.list']),
      unit: 'f',
    };
  }
  if ('c.1.wb' in map) {
    controls.wb = {
      id: 'wb',
      available: true,
      value: map['c.1.wb'],
      list: list(map['c.1.wb.list']),
    };
  }
  if ('c.1.wb.kelvin' in map) {
    controls.wbKelvin = {
      id: 'wbKelvin',
      available: true,
      value: num(map['c.1.wb.kelvin']),
      list: list(map['c.1.wb.kelvin.list']),
      unit: 'K',
    };
  }
  if ('c.1.nd.filter' in map) {
    controls.nd = {
      id: 'nd',
      available: true,
      value: num(map['c.1.nd.filter']),
      list: list(map['c.1.nd.filter.list']),
      mode: map['c.1.nd.mode'],
    };
  }
  if ('c.1.focus' in map) {
    controls.focus = {
      id: 'focus',
      available: true,
      value: map['c.1.focus'],
      list: list(map['c.1.focus.list']),
    };
  }
  if ('c.1.focus.detect' in map) {
    controls.faceDetect = {
      id: 'faceDetect',
      available: true,
      value: map['c.1.focus.detect'],
      list: list(map['c.1.focus.detect.list']),
    };
  }
  if ('c.1.colorbar' in map) {
    controls.colorbar = {
      id: 'colorbar',
      available: true,
      value: map['c.1.colorbar'],
      list: list(map['c.1.colorbar.list']),
    };
  }

  return {
    model: map['c.1.type'],
    exposureMode: map['c.1.exp'],
    record: {
      recording: map['f.rec.status'] === 'rec',
      media1: map['f.rec.media1.status'],
      media2: map['f.rec.media2.status'],
      remainingMinutes: num(map['f.rec.media1.remainingtime']),
    },
    controls,
  };
}
