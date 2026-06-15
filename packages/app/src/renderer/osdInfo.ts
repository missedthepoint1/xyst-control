import type { CameraState } from '@xyst/core';
import type { OsdInfo } from './components/VideoPanel.js';

const n = (v: unknown) => (typeof v === 'number' ? v : undefined);
const WB_LABELS: Record<string, string> = {
  auto: 'AWB', manual: 'WB Set', wb_a: 'WB A', wb_b: 'WB B', daylight: 'Daylight', tungsten: 'Tungsten', kelvin: 'Kelvin',
};

/** Build the camera-style OSD overlay (ISO/shutter/iris/WB/ND/REC/battery) from discovered state. */
export function buildOsd(state: CameraState): OsdInfo {
  const c = state.controls;
  return {
    iso: c.iso?.value != null ? `ISO ${c.iso.value}`
       : n(c.gain?.value) != null ? `${(n(c.gain!.value)! / 10).toFixed(1)}dB` : undefined,
    shutter: c.shutter?.available
      ? (c.shutter.mode === 'angle' && n(c.shutterAngle?.value) != null
          ? `${Math.round(n(c.shutterAngle!.value)! / 100)}°`
          : c.shutter.value != null ? `1/${c.shutter.value}` : undefined)
      : undefined,
    iris: n(c.iris?.value) != null ? `f/${(n(c.iris!.value)! / 100).toFixed(1)}` : undefined,
    wb: c.wb?.value === 'kelvin'
      ? (n(c.wbKelvin?.value) != null ? `${c.wbKelvin!.value}K` : 'Kelvin')
      : typeof c.wb?.value === 'string' ? (WB_LABELS[c.wb.value] ?? c.wb.value) : undefined,
    nd: n(c.nd?.value) != null ? (n(c.nd!.value)! > 0 ? `ND ${+(Math.log2(n(c.nd!.value)! / 100)).toFixed(1)}` : 'ND Off') : undefined,
    tc: state.timecode?.value,
    rec: state.record.recording,
    remaining: state.record.remainingMinutes,
    battery: state.power?.percent != null ? `${state.power.percent}%`
           : state.power?.volt != null ? `${state.power.volt}V` : undefined,
  };
}
