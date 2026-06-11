import { EventEmitter } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { CameraDriver } from './driver.js';
import type { CameraProfile, CameraState, ControlId, ControlSettings, CameraPreset, FocusPoint } from './types.js';
import { XCProtocolDriver, type XCDriverOptions } from './xc/driver.js';
import { R5CBrowserRemoteDriver } from './r5c/driver.js';
import { CcapiDriver } from './ccapi/driver.js';

interface ConfigFile { cameras: CameraProfile[] }

export class CameraManager extends EventEmitter {
  private profiles = new Map<string, CameraProfile>();
  private drivers = new Map<string, CameraDriver>();
  constructor(private configPath: string, private driverOpts: XCDriverOptions = {}) {
    super();
  }

  async load(): Promise<void> {
    const raw = await readFile(this.configPath, 'utf8').catch(() => '{"cameras":[]}');
    let cfg: ConfigFile;
    try {
      cfg = JSON.parse(raw) as ConfigFile;
    } catch (err) {
      throw new Error(`invalid camera config at ${this.configPath}: ${(err as Error).message}`);
    }
    for (const p of cfg.cameras ?? []) {
      this.profiles.set(p.id, p);
      this.makeDriver(p);
    }
  }

  listProfiles(): CameraProfile[] { return [...this.profiles.values()]; }
  getState(id: string): CameraState | undefined { return this.drivers.get(id)?.getState(); }
  // Order follows the profile order (persisted), so rename/reorder are reflected everywhere.
  getAllStates(): CameraState[] {
    return this.listProfiles()
      .map((p) => this.drivers.get(p.id)?.getState())
      .filter((s): s is CameraState => !!s);
  }

  async connect(id: string): Promise<void> { await this.driver(id).connect(); }
  async connectAll(): Promise<void> {
    await Promise.allSettled([...this.drivers.values()].map((d) => d.connect()));
  }
  async disconnectAll(): Promise<void> {
    await Promise.allSettled([...this.drivers.values()].map((d) => d.disconnect()));
  }

  async startRecording(id: string): Promise<void> { await this.driver(id).startRecording(); }
  async stopRecording(id: string): Promise<void> { await this.driver(id).stopRecording(); }
  async setControl(id: string, control: ControlId, value: string | number): Promise<void> {
    await this.driver(id).setControl(control, value);
  }

  /**
   * Move a control to its next/previous valid value (dir = +1 / -1). List-aware for
   * stepped controls (ISO, shutter, iris, ND, Kelvin…) and clamped for ranged ones
   * (WB CC, AF speed/response). Lives here so REST + Companion never re-implement it.
   */
  async stepControl(id: string, control: ControlId, dir: 1 | -1): Promise<void> {
    const state = this.getState(id);
    if (!state) throw new Error(`no camera with id ${id}`);
    const c = state.controls[control];
    if (!c || c.available === false) throw new Error(`control ${control} not available`);
    let next: string | number | undefined;
    if (c.list && c.list.length) {
      const i = c.list.findIndex((v) => String(v) === String(c.value));
      next = c.list[Math.max(0, Math.min(c.list.length - 1, (i < 0 ? 0 : i) + dir))];
    } else if (typeof c.value === 'number') {
      const min = c.min ?? Number.NEGATIVE_INFINITY, max = c.max ?? Number.POSITIVE_INFINITY;
      next = Math.max(min, Math.min(max, c.value + dir));
    }
    if (next === undefined) throw new Error(`control ${control} is not steppable`);
    await this.setControl(id, control, next);
  }
  async recordAll(start: boolean): Promise<void> {
    await Promise.allSettled([...this.drivers.values()].map(
      (d) => (start ? d.startRecording() : d.stopRecording())));
  }

  listPresets(cameraId: string): CameraPreset[] {
    return this.profiles.get(cameraId)?.presets ?? [];
  }

  async savePreset(cameraId: string, name: string): Promise<CameraPreset> {
    const profile = this.profiles.get(cameraId);
    if (!profile) throw new Error(`no camera with id ${cameraId}`);
    const state = this.driver(cameraId).getState();
    const preset: CameraPreset = {
      id: this.nextPresetId(cameraId),
      name,
      exposureMode: state.exposureMode,
      settings: extractSettings(state),
    };
    profile.presets = [...(profile.presets ?? []), preset];
    await this.save();
    this.emit('presets', cameraId, profile.presets);
    return preset;
  }

  async recallPreset(cameraId: string, presetId: string): Promise<void> {
    const preset = this.listPresets(cameraId).find((p) => p.id === presetId);
    if (!preset) throw new Error(`no preset ${presetId} on ${cameraId}`);
    const d = this.driver(cameraId);
    const state = d.getState();
    const applicable: ControlSettings = {};
    for (const [id, value] of Object.entries(preset.settings)) {
      if (state.controls[id as ControlId]?.available) applicable[id as ControlId] = value;
    }
    await d.applySettings(applicable);
  }

  async recallPresetById(presetId: string): Promise<void> {
    for (const [cameraId, profile] of this.profiles) {
      if ((profile.presets ?? []).some((p) => p.id === presetId)) {
        return this.recallPreset(cameraId, presetId);
      }
    }
    throw new Error(`no preset with id ${presetId}`);
  }

  async deletePreset(cameraId: string, presetId: string): Promise<void> {
    const profile = this.profiles.get(cameraId);
    if (!profile) throw new Error(`no camera with id ${cameraId}`);
    const before = profile.presets ?? [];
    const after = before.filter((p) => p.id !== presetId);
    if (after.length === before.length) return; // nothing removed — no write, no event
    profile.presets = after;
    await this.save();
    this.emit('presets', cameraId, profile.presets);
  }

  private nextPresetId(_cameraId: string): string {
    return randomUUID();
  }

  async setFocusPoint(cameraId: string, x: number, y: number): Promise<void> {
    const d = this.drivers.get(cameraId);
    if (!d?.setFocusPoint) throw new Error(`camera ${cameraId} has no focus control`);
    await d.setFocusPoint(x, y);
  }

  listFocusPoints(cameraId: string): FocusPoint[] {
    return this.profiles.get(cameraId)?.focusPoints ?? [];
  }

  async saveFocusPoint(cameraId: string, name: string, x: number, y: number): Promise<FocusPoint> {
    const profile = this.profiles.get(cameraId);
    if (!profile) throw new Error(`no camera with id ${cameraId}`);
    const point: FocusPoint = { id: randomUUID(), name, x, y };
    profile.focusPoints = [...(profile.focusPoints ?? []), point];
    await this.save();
    this.emit('focusPoints', cameraId, profile.focusPoints);
    return point;
  }

  async recallFocusPoint(cameraId: string, pointId: string): Promise<void> {
    const p = this.listFocusPoints(cameraId).find((fp) => fp.id === pointId);
    if (!p) throw new Error(`no focus point ${pointId} on ${cameraId}`);
    await this.setFocusPoint(cameraId, p.x, p.y);
  }

  async recallFocusPointById(pointId: string): Promise<void> {
    for (const [cameraId, profile] of this.profiles) {
      if ((profile.focusPoints ?? []).some((fp) => fp.id === pointId)) {
        return this.recallFocusPoint(cameraId, pointId);
      }
    }
    throw new Error(`no focus point with id ${pointId}`);
  }

  async deleteFocusPoint(cameraId: string, pointId: string): Promise<void> {
    const profile = this.profiles.get(cameraId);
    if (!profile) throw new Error(`no camera with id ${cameraId}`);
    const before = profile.focusPoints ?? [];
    const after = before.filter((fp) => fp.id !== pointId);
    if (after.length === before.length) return;
    profile.focusPoints = after;
    await this.save();
    this.emit('focusPoints', cameraId, profile.focusPoints);
  }

  async getPreview(cameraId: string): Promise<import('./types.js').PreviewFrame | undefined> {
    const d = this.drivers.get(cameraId);
    return d?.getPreview ? d.getPreview() : undefined;
  }

  async getMeta(cameraId: string): Promise<import('./types.js').CameraMeta | undefined> {
    const d = this.drivers.get(cameraId);
    return d?.getMeta ? d.getMeta() : undefined;
  }

  async setVideoSource(cameraId: string, video: import('./types.js').VideoSource): Promise<void> {
    const profile = this.profiles.get(cameraId);
    if (!profile) throw new Error(`no camera with id ${cameraId}`);
    profile.video = video;
    await this.save();
    this.emit('state', cameraId, this.getState(cameraId)); // surface the change to the UI
  }

  /** Relabel a camera (the user-facing name); persists and pushes the change to the UI. */
  async renameCamera(cameraId: string, name: string): Promise<void> {
    const profile = this.profiles.get(cameraId);
    if (!profile) throw new Error(`no camera with id ${cameraId}`);
    profile.name = name;
    await this.save();
    this.emit('state', cameraId, this.getState(cameraId));
  }

  /** Reorder cameras to match `orderedIds`; any ids omitted keep their current relative order. */
  async reorderCameras(orderedIds: string[]): Promise<void> {
    const current = this.profiles;
    const next = new Map<string, CameraProfile>();
    for (const id of orderedIds) {
      const p = current.get(id);
      if (p) next.set(id, p);
    }
    for (const [id, p] of current) if (!next.has(id)) next.set(id, p);
    this.profiles = next;
    await this.save();
  }

  async removeCamera(cameraId: string): Promise<void> {
    const driver = this.drivers.get(cameraId);
    if (driver) {
      await driver.disconnect().catch(() => {});
      this.drivers.delete(cameraId);
    }
    this.profiles.delete(cameraId);
    await this.save();
    this.emit('removed', cameraId);
  }

  async addCamera(profile: CameraProfile): Promise<void> {
    if (this.profiles.has(profile.id)) {
      throw new Error(`camera already exists: ${profile.id}`);
    }
    this.profiles.set(profile.id, profile);
    try {
      await this.save();
    } catch (err) {
      this.profiles.delete(profile.id); // roll back so memory matches disk
      throw err;
    }
    this.makeDriver(profile);
  }

  private makeDriver(profile: CameraProfile): void {
    if (this.drivers.has(profile.id)) return;
    const driver: CameraDriver =
      profile.driver === 'r5c' ? new R5CBrowserRemoteDriver(profile)
      : profile.driver === 'ccapi' ? new CcapiDriver(profile)
      : new XCProtocolDriver(profile, this.driverOpts);
    driver.on('state', (s) => this.emit('state', profile.id, s));
    driver.on('status', (st) => this.emit('status', profile.id, st));
    driver.on('error', (e) => this.emit('camera-error', profile.id, e));
    this.drivers.set(profile.id, driver);
  }

  private driver(id: string): CameraDriver {
    const d = this.drivers.get(id);
    if (!d) throw new Error(`no camera with id ${id}`);
    return d;
  }

  private async save(): Promise<void> {
    const cfg: ConfigFile = { cameras: this.listProfiles() };
    await writeFile(this.configPath, JSON.stringify(cfg, null, 2));
  }
}

function extractSettings(state: CameraState): ControlSettings {
  const out: ControlSettings = {};
  // 'gain' is excluded: alternate exposure unit to 'iso' (both write c.1.me.isogain.mode).
  const ids: ControlId[] = ['iso', 'shutter', 'iris', 'wb', 'wbKelvin', 'nd'];
  for (const id of ids) {
    // Only capture Kelvin when WB is actually in kelvin mode — otherwise recall would
    // force c.1.wb=kelvin and clobber a preset/auto WB mode.
    if (id === 'wbKelvin' && state.controls.wb?.value !== 'kelvin') continue;
    const c = state.controls[id];
    if (c?.available && c.value !== undefined) out[id] = c.value;
  }
  return out;
}
