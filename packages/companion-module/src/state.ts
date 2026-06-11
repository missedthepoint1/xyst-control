import type { CameraPreset, CameraState, ControlId, FocusPoint } from '@xyst/core';

export interface VariableDef { variableId: string; name: string }
export type VariableValues = Record<string, string | number | undefined>;
export interface Choice { id: string; label: string }

/** Controls that carry a readable value (action-only ids like wbAction are excluded). */
const VAR_CONTROLS: ControlId[] = [
  'iso', 'gain', 'shutter', 'shutterAngle', 'iris', 'wb', 'wbKelvin', 'nd',
  'focus', 'faceDetect', 'colorbar', 'isoAuto', 'ndExtended', 'wbCC', 'awbHold',
  'afMode', 'afSpeed', 'afResponse', 'afLock', 'osdOutput',
];
const vid = (cameraId: string, suffix: string): string =>
  `${cameraId.replace(/[^A-Za-z0-9]+/g, '_')}_${suffix}`;

export class CameraStore {
  private cams = new Map<string, CameraState>();
  private presets = new Map<string, CameraPreset[]>();

  setCameras(list: CameraState[]): void {
    this.cams = new Map(list.map((c) => [c.id, c]));
  }
  applyState(id: string, state: CameraState): void { this.cams.set(id, state); }
  setPresets(id: string, presets: CameraPreset[]): void { this.presets.set(id, presets); }
  setFocusPoints(id: string, points: FocusPoint[]): void { const c = this.cams.get(id); if (c) c.focusPoints = points; }

  list(): CameraState[] { return [...this.cams.values()]; }
  cameraChoices(): Choice[] { return this.list().map((c) => ({ id: c.id, label: c.name ?? c.id })); }
  isRecording(id: string): boolean { return this.cams.get(id)?.record.recording ?? false; }
  isConnected(id: string): boolean { return this.cams.get(id)?.status === 'connected'; }
  anyRecording(): boolean { return this.list().some((c) => c.record.recording); }

  /** Current value of a control, as a string (for the control-equals feedback). */
  controlValue(id: string, control: ControlId): string {
    const v = this.cams.get(id)?.controls[control]?.value;
    return v === undefined ? '' : String(v);
  }

  controlList(id: string, control: ControlId): Array<string | number> {
    return this.cams.get(id)?.controls[control]?.list ?? [];
  }

  /** Presets/focus-points flattened across cameras, labelled "Camera — name", keyed by
   *  their (unique) id so a single dropdown + global recall covers every camera. */
  allPresetChoices(): Choice[] {
    const out: Choice[] = [];
    for (const c of this.list()) {
      const label = c.name ?? c.id;
      for (const p of this.presets.get(c.id) ?? []) out.push({ id: p.id, label: `${label} — ${p.name}` });
    }
    return out;
  }
  allFocusPointChoices(): Choice[] {
    const out: Choice[] = [];
    for (const c of this.list()) {
      const label = c.name ?? c.id;
      for (const p of c.focusPoints ?? ([] as FocusPoint[])) out.push({ id: p.id, label: `${label} — ${p.name}` });
    }
    return out;
  }

  variableDefinitions(): VariableDef[] {
    const defs: VariableDef[] = [];
    for (const c of this.list()) {
      const label = c.name ?? c.id;
      defs.push(
        { variableId: vid(c.id, 'name'), name: `${label} name` },
        { variableId: vid(c.id, 'status'), name: `${label} status` },
        { variableId: vid(c.id, 'model'), name: `${label} model` },
        { variableId: vid(c.id, 'recording'), name: `${label} recording` },
        { variableId: vid(c.id, 'exposure'), name: `${label} exposure mode` },
        { variableId: vid(c.id, 'battery'), name: `${label} battery` },
        { variableId: vid(c.id, 'remaining'), name: `${label} record minutes left` },
      );
      for (const ctl of VAR_CONTROLS) defs.push({ variableId: vid(c.id, ctl), name: `${label} ${ctl}` });
    }
    return defs;
  }

  variableValues(): VariableValues {
    const vals: VariableValues = {};
    for (const c of this.list()) {
      vals[vid(c.id, 'name')] = c.name;
      vals[vid(c.id, 'status')] = c.status;
      vals[vid(c.id, 'model')] = c.model;
      vals[vid(c.id, 'recording')] = c.record.recording ? 'rec' : 'off';
      vals[vid(c.id, 'exposure')] = c.exposureMode;
      vals[vid(c.id, 'battery')] = c.power?.percent != null ? `${c.power.percent}%`
        : c.power?.volt != null ? `${c.power.volt}V` : undefined;
      vals[vid(c.id, 'remaining')] = c.record.remainingMinutes;
      for (const ctl of VAR_CONTROLS) vals[vid(c.id, ctl)] = c.controls[ctl]?.value;
    }
    return vals;
  }
}
