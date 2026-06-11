import type { ControlId, ControlSettings } from '../types.js';

export function buildRecordParams(start: boolean): Record<string, string> {
  return { 'f.rec': start ? 'on' : 'off' };
}

/**
 * Map a control change to control.cgi params. Manual exposure controls also set
 * c.1.exp=manual so the value sticks (operator-friendly: one action = it changes).
 */
export function buildControlParams(id: ControlId, value: string | number): Record<string, string> {
  const v = String(value);
  switch (id) {
    case 'iso':
      return {
        'c.1.exp': 'manual',
        'c.1.me.isogain.mode': 'iso',
        'c.1.me.iso.mode': 'manual',
        'c.1.me.iso': v,
      };
    case 'gain':
      return {
        'c.1.exp': 'manual',
        'c.1.me.isogain.mode': 'gain',
        'c.1.me.gain.mode': 'manual',
        'c.1.me.gain': v,
      };
    case 'shutter':
      // Phase 1: concrete speed only; slow/clearscan/angle modes are a later refinement.
      return { 'c.1.exp': 'manual', 'c.1.me.shutter.mode': 'speed', 'c.1.me.shutter': v };
    case 'shutterMode':
      return { 'c.1.exp': 'manual', 'c.1.me.shutter.mode': v };
    case 'shutterAngle':
      return { 'c.1.exp': 'manual', 'c.1.me.shutter.mode': 'angle', 'c.1.me.angle': v };
    case 'iris':
      // Lens aperture by F-number (x100, e.g. 400 = f/4).
      return { 'c.1.exp': 'manual', 'c.1.me.diaphragm': v };
    case 'wb':
      return { 'c.1.wb': v };
    case 'wbKelvin':
      return { 'c.1.wb': 'kelvin', 'c.1.wb.kelvin': v };
    case 'nd':
      return { 'c.1.nd.filter': v };
    case 'focus':
      return { 'c.1.focus': v };
    case 'faceDetect':
      return { 'c.1.focus.detect': v };
    case 'colorbar':
      return { 'c.1.colorbar': v };
    case 'isoAuto':
      return { 'c.1.me.iso.mode': v };
    case 'ndExtended':
      return { 'c.1.nd.filter.extended': v };
    case 'wbCC':
      return { 'c.1.wb.kelvin.cc': v };
    case 'awbHold':
      return { 'c.1.wb.awbhold': v };
    case 'wbAction':
      return { 'c.1.wb.action': v };
    case 'afMode':
      return { 'c.1.focus.auto': v };
    case 'afSpeed':
      return { 'c.1.focus.auto.speed': v };
    case 'afResponse':
      return { 'c.1.focus.auto.resp': v };
    case 'afLock':
      return { 'c.1.focus.auto.lock': v };
    case 'focusAction':
      return { 'c.1.focus.action': v };
    case 'osdOutput':
      // Not a control.cgi param — set via configuration.cgi in the driver. Returning
      // {} keeps buildSettingsParams a no-op for it (presets never capture OSD output).
      return {};
  }
}

// Note: callers must not pass both `iso` and `gain` — they are mutually exclusive
// exposure units (both set c.1.me.isogain.mode); the last one wins otherwise.
/** Merge several control changes into a single control.cgi parameter object. */
export function buildSettingsParams(settings: ControlSettings): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, value] of Object.entries(settings)) {
    if (value === undefined) continue;
    Object.assign(out, buildControlParams(id as ControlId, value));
  }
  return out;
}
