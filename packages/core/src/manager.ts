import { EventEmitter } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import type { CameraDriver } from './driver.js';
import type { CameraProfile, CameraState, ControlId } from './types.js';
import { XCProtocolDriver, type XCDriverOptions } from './xc/driver.js';

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
    const driver = new XCProtocolDriver(profile, this.driverOpts); // r5c added in Phase 4
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
