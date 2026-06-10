import { EventEmitter } from 'node:events';
import type { CameraDriver } from '../driver.js';
import type { CameraProfile, CameraState, ConnectionStatus, ControlId, ControlSettings } from '../types.js';

/**
 * Canon EOS R5 C — Browser Remote HTTP driver. STUB until the undocumented
 * endpoints are captured (kickoff Phase 4). The endpoint map below is to be
 * filled from a dev-tools HAR capture. Every action throws a clear pending error
 * rather than guessing, so the app never silently misbehaves against a real R5 C.
 */
export const R5C_ENDPOINTS = {
  recordStart: null as string | null,
  recordStop: null as string | null,
  setIso: null as string | null,
  setShutter: null as string | null,
  setIris: null as string | null,
  setWb: null as string | null,
  touchAf: null as string | null, // normalized x/y -> AF (Phase 6)
  liveView: null as string | null,
  status: null as string | null,
} as const;

const PENDING = 'R5 C Browser Remote endpoints pending capture (Phase 4)';

export class R5CBrowserRemoteDriver extends EventEmitter implements CameraDriver {
  readonly id: string;
  private _status: ConnectionStatus = 'disconnected';
  private lastError?: string;

  constructor(private profile: CameraProfile) {
    super();
    this.id = profile.id;
    this.on('error', () => {});
  }

  get status(): ConnectionStatus { return this._status; }

  getState(): CameraState {
    return {
      id: this.id,
      name: this.profile.name,
      status: this._status,
      updatedAt: 0,
      lastError: this.lastError,
      record: { recording: false },
      controls: {},
    };
  }

  async connect(): Promise<void> {
    this.lastError = PENDING;
    this.setStatus('error');
  }
  async disconnect(): Promise<void> { this.setStatus('disconnected'); }

  async startRecording(): Promise<void> { throw new Error(PENDING); }
  async stopRecording(): Promise<void> { throw new Error(PENDING); }
  async setControl(_id: ControlId, _v: string | number): Promise<void> { throw new Error(PENDING); }
  async applySettings(_s: ControlSettings): Promise<void> { throw new Error(PENDING); }

  private setStatus(s: ConnectionStatus): void {
    if (this._status === s) return;
    this._status = s;
    this.emit('status', s);
  }
}
