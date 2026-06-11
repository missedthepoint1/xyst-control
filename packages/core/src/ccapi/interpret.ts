import type { CameraSnapshot, ControlState, ControlId } from '../types.js';

/** A CCAPI setting: current value + the list of values the body accepts right now. */
interface Setting { value?: string | number; ability?: Array<string | number> | { min?: number; max?: number; step?: number } }
type Settings = Record<string, Setting>;

/**
 * Raw maps from the display value we show in the UI (normalised number) back to the
 * exact CCAPI string the camera advertised — so setControl always PUTs a value the body
 * accepts, even though CCAPI's aperture/shutter string formats vary by model.
 */
export interface CcapiRaw {
  iso: Map<number, string>;
  tv: Map<number, string>;
  av: Map<number, string>;
}

const numeric = (s: string | number): number | undefined => {
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

/** "1/100" -> 100 (fraction shutter speeds only; slow/second values are skipped in v1). */
const tvDenom = (s: string | number): number | undefined => {
  const m = String(s).match(/^1\/(\d+(?:\.\d+)?)$/);
  return m ? Number(m[1]) : undefined;
};

/** "f4.0" | "4.0" -> 400 (F-number x100, matching the iris display in the UI). */
const avHundredths = (s: string | number): number | undefined => {
  const d = String(s).match(/(\d+(?:\.\d+)?)/)?.[1];
  return d === undefined ? undefined : Math.round(parseFloat(d) * 100);
};

const asArray = (a: Setting['ability']): Array<string | number> => (Array.isArray(a) ? a : []);

/**
 * Map a CCAPI shooting/settings payload (+ deviceinformation, battery) into our snapshot.
 * Capability-discovered: each control's `list` comes from the setting's `ability`, never a
 * hard-coded model table. Returns the snapshot plus the raw maps setControl needs.
 */
export function interpretCcapi(
  settings: Settings,
  device?: { productname?: string },
  battery?: { level?: string | number; kind?: string },
): { snapshot: CameraSnapshot; raw: CcapiRaw } {
  const controls: Partial<Record<ControlId, ControlState>> = {};
  const raw: CcapiRaw = { iso: new Map(), tv: new Map(), av: new Map() };

  const iso = settings.iso;
  if (iso) {
    const list: number[] = [];
    for (const a of asArray(iso.ability)) {
      const n = typeof a === 'number' ? a : numeric(a);
      if (n !== undefined && String(a).toLowerCase() !== 'auto') { list.push(n); raw.iso.set(n, String(a)); }
    }
    controls.iso = { id: 'iso', available: true, value: numeric(iso.value ?? '') ?? iso.value, list };
  }

  const tv = settings.tv;
  if (tv) {
    const list: number[] = [];
    for (const a of asArray(tv.ability)) {
      const n = tvDenom(a);
      if (n !== undefined) { list.push(n); raw.tv.set(n, String(a)); }
    }
    controls.shutter = { id: 'shutter', available: true, value: tvDenom(tv.value ?? '') ?? tv.value, list, mode: 'speed' };
  }

  const av = settings.av;
  if (av) {
    const list: number[] = [];
    for (const a of asArray(av.ability)) {
      const n = avHundredths(a);
      if (n !== undefined) { list.push(n); raw.av.set(n, String(a)); }
    }
    if (list.length) controls.iris = { id: 'iris', available: true, value: avHundredths(av.value ?? '') ?? av.value, list, unit: 'f' };
  }

  const wb = settings.wb;
  if (wb) {
    controls.wb = { id: 'wb', available: true, value: wb.value, list: asArray(wb.ability) };
  }

  const ct = settings.colortemperature;
  if (ct) {
    const ability = ct.ability;
    const range = !Array.isArray(ability) ? ability : undefined;
    controls.wbKelvin = {
      id: 'wbKelvin', available: true, value: numeric(ct.value ?? ''), unit: 'K',
      min: range?.min, max: range?.max,
      list: Array.isArray(ability) ? ability.map((v) => numeric(v) ?? v) : undefined,
    };
  }

  const power = battery ? {
    source: battery.kind,
    percent: typeof battery.level === 'number' ? battery.level
      : (numeric(battery.level ?? '') ?? undefined),
  } : undefined;

  return {
    snapshot: {
      model: device?.productname,
      exposureMode: typeof settings.shootingmode?.value === 'string' ? settings.shootingmode.value : undefined,
      record: { recording: false }, // recording state is tracked by the driver
      controls,
      power: power && (power.source !== undefined || power.percent !== undefined) ? power : undefined,
    },
    raw,
  };
}
