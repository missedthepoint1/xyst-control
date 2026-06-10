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
    case 'iris':
      return { 'c.1.exp': 'manual', 'c.1.me.iris': v };
    case 'wb':
      return { 'c.1.wb': v };
    case 'wbKelvin':
      return { 'c.1.wb': 'kelvin', 'c.1.wb.kelvin': v };
    case 'nd':
      return { 'c.1.nd.filter': v };
  }
}

/** Merge several control changes into a single control.cgi parameter object. */
export function buildSettingsParams(settings: ControlSettings): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, value] of Object.entries(settings)) {
    if (value === undefined) continue;
    Object.assign(out, buildControlParams(id as ControlId, value));
  }
  return out;
}
