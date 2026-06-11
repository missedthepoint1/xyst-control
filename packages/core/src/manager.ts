import { EventEmitter } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { CameraDriver } from './driver.js';
import type { CameraProfile, CameraState, ControlId, ControlSettings, CameraPreset } from './types.js';
import { XCProtocolDriver, type XCDriverOptions } from './xc/driver.js';
import { R5CBrowserRemoteDriver } from './r5c/driver.js';

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
  getAllStates(): CameraState[] { return [...this.drivers.values()].map((d) => d.getState()); }

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
    const driver: CameraDriver = profile.driver === 'r5c'
      ? new R5CBrowserRemoteDriver(profile)
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
