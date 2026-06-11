import type { CameraSnapshot, ControlState, ControlId, PowerState } from '../types.js';

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
  if ('c.1.me.iso.mode' in map) {
    controls.isoAuto = { id: 'isoAuto', available: true, value: map['c.1.me.iso.mode'], list: list(map['c.1.me.iso.mode.list']) };
  }
  if ('c.1.nd.filter.extended' in map) {
    controls.ndExtended = { id: 'ndExtended', available: true, value: map['c.1.nd.filter.extended'], list: list(map['c.1.nd.filter.extended.list']) };
  }
  if ('c.1.wb.kelvin.cc' in map) {
    controls.wbCC = { id: 'wbCC', available: true, value: num(map['c.1.wb.kelvin.cc']), min: num(map['c.1.wb.kelvin.cc.min']), max: num(map['c.1.wb.kelvin.cc.max']) };
  }
  if ('c.1.wb.awbhold' in map) {
    controls.awbHold = { id: 'awbHold', available: true, value: map['c.1.wb.awbhold'], list: list(map['c.1.wb.awbhold.list']) };
  }
  if ('c.1.wb.action.list' in map) {
    controls.wbAction = { id: 'wbAction', available: true, list: list(map['c.1.wb.action.list']) };
  }
  if ('c.1.focus.auto' in map) {
    controls.afMode = { id: 'afMode', available: true, value: map['c.1.focus.auto'], list: list(map['c.1.focus.auto.list']) };
  }
  if ('c.1.focus.auto.speed' in map) {
    controls.afSpeed = { id: 'afSpeed', available: true, value: num(map['c.1.focus.auto.speed']), min: num(map['c.1.focus.auto.speed.min']), max: num(map['c.1.focus.auto.speed.max']) };
  }
  if ('c.1.focus.auto.resp' in map) {
    controls.afResponse = { id: 'afResponse', available: true, value: num(map['c.1.focus.auto.resp']), min: num(map['c.1.focus.auto.resp.min']), max: num(map['c.1.focus.auto.resp.max']) };
  }
  if ('c.1.focus.auto.lock' in map) {
    controls.afLock = { id: 'afLock', available: true, value: map['c.1.focus.auto.lock'], list: list(map['c.1.focus.auto.lock.list']) };
  }
  if ('c.1.focus.action.list' in map) {
    controls.focusAction = { id: 'focusAction', available: true, list: list(map['c.1.focus.action.list']) };
  }
  // Camera OSD output (info burned onto the monitor/SDI/HDMI outputs). Set via
  // configuration.cgi, not control.cgi (see driver.setControl). `off` hides it;
  // any `displevelN` value shows it. Offered only when the body advertises it.
  if ('monitoring.osd.framedisplay' in map) {
    controls.osdOutput = {
      id: 'osdOutput',
      available: true,
      value: map['monitoring.osd.framedisplay'],
      list: list(map['monitoring.osd.framedisplay.list']),
    };
  }

  const power: PowerState = {
    source: map['s.power.source'] || undefined,
    volt: map['s.power.volt'] ? Number(map['s.power.volt']) / 10 : undefined,
    percent: map['s.power.percent'] ? num(map['s.power.percent']) : undefined,
    minutes: map['s.power.minute'] ? num(map['s.power.minute']) : undefined,
  };
  const hasPower = power.source !== undefined || power.volt !== undefined;

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
    power: hasPower ? power : undefined,
  };
}
