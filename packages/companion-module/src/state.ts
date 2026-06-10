import type { CameraState, ControlId } from '@xyst/core';

export interface VariableDef { variableId: string; name: string }
export type VariableValues = Record<string, string | number | undefined>;
export interface Choice { id: string; label: string }

const CONTROLS: ControlId[] = ['iso', 'shutter', 'iris', 'wb', 'wbKelvin', 'nd'];
const vid = (cameraId: string, suffix: string): string =>
  `${cameraId.replace(/[^A-Za-z0-9]+/g, '_')}_${suffix}`;

export class CameraStore {
  private cams = new Map<string, CameraState>();

  setCameras(list: CameraState[]): void {
    this.cams = new Map(list.map((c) => [c.id, c]));
  }
  applyState(id: string, state: CameraState): void { this.cams.set(id, state); }

  list(): CameraState[] { return [...this.cams.values()]; }
  cameraChoices(): Choice[] { return this.list().map((c) => ({ id: c.id, label: c.name ?? c.id })); }
  isRecording(id: string): boolean { return this.cams.get(id)?.record.recording ?? false; }

  variableDefinitions(): VariableDef[] {
    const defs: VariableDef[] = [];
    for (const c of this.list()) {
      const label = c.name ?? c.id;
      defs.push(
        { variableId: vid(c.id, 'name'), name: `${label} name` },
        { variableId: vid(c.id, 'status'), name: `${label} status` },
        { variableId: vid(c.id, 'model'), name: `${label} model` },
        { variableId: vid(c.id, 'recording'), name: `${label} recording` },
      );
      for (const ctl of CONTROLS) defs.push({ variableId: vid(c.id, ctl), name: `${label} ${ctl}` });
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
      for (const ctl of CONTROLS) vals[vid(c.id, ctl)] = c.controls[ctl]?.value;
    }
    return vals;
  }
}
