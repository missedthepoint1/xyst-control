import { EventEmitter } from 'node:events';
import type { CameraDriver } from '../driver.js';
import type {
  CameraProfile, CameraState, CameraSnapshot, ConnectionStatus, ControlId,
} from '../types.js';
import { xcRequest } from './client.js';
import { interpretInfo } from './interpret.js';
import { buildControlParams, buildRecordParams } from './commands.js';

export interface XCDriverOptions {
  pollMs?: number;
  timeoutMs?: number;
}

export class XCProtocolDriver extends EventEmitter implements CameraDriver {
  readonly id: string;
  private _status: ConnectionStatus = 'disconnected';
  private snapshot: CameraSnapshot = { record: { recording: false }, controls: {} };
  private timer?: NodeJS.Timeout;
  private polling = false;
  private lastError?: string;
  private readonly pollMs: number;
  private readonly timeoutMs: number;

  constructor(private profile: CameraProfile, opts: XCDriverOptions = {}) {
    super();
    this.id = profile.id;
    this.pollMs = opts.pollMs ?? 750;
    this.timeoutMs = opts.timeoutMs ?? 4000;
    // Safety net: prevent Node from throwing on unhandled 'error' events.
    // Consumers can still add their own listener and will receive events too.
    this.on('error', () => {});
  }

  get status(): ConnectionStatus { return this._status; }

  getState(): CameraState {
    return {
      id: this.id,
      status: this._status,
      updatedAt: Date.now(),
      lastError: this.lastError,
      ...this.snapshot,
    };
  }

  async connect(): Promise<void> {
    this.setStatus('connecting');
    try {
      await this.refresh();
      this.setStatus('connected');
      this.startPolling();
    } catch (err) {
      this.fail(err);
      this.startPolling(); // keep trying to recover
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.setStatus('disconnected');
  }

  async startRecording(): Promise<void> { await this.control(buildRecordParams(true)); }
  async stopRecording(): Promise<void> { await this.control(buildRecordParams(false)); }

  async setControl(id: ControlId, value: string | number): Promise<void> {
    await this.control(buildControlParams(id, value));
  }

  // --- internals ---

  private async control(params: Record<string, string>): Promise<void> {
    const { map } = await xcRequest(this.profile.host, 'control.cgi', params, {
      auth: this.profile.auth, timeoutMs: this.timeoutMs,
    });
    // control.cgi echoes changed items; fold them in, then do a full refresh
    this.applyPartial(map);
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    const { map } = await xcRequest(this.profile.host, 'info.cgi', {}, {
      auth: this.profile.auth, timeoutMs: this.timeoutMs,
    });
    this.lastError = undefined;
    this.snapshot = interpretInfo(map);
    this.emit('state', this.getState());
  }

  private applyPartial(map: Record<string, string>): void {
    // Lightweight merge so the UI feels instant before the refresh lands.
    const merged = interpretInfo(map);
    // Only adopt record state if the echo actually reported it — interpretInfo
    // always returns a record object (defaulting recording:false), so merging it
    // unconditionally would briefly clobber a known-good REC state.
    if ('f.rec.status' in map) {
      this.snapshot.record = { ...this.snapshot.record, ...merged.record };
    }
    this.snapshot.controls = { ...this.snapshot.controls, ...merged.controls };
  }

  private startPolling(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), this.pollMs);
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      await this.refresh();
      if (this._status !== 'connected') this.setStatus('connected');
    } catch (err) {
      this.fail(err);
    } finally {
      this.polling = false;
    }
  }

  private fail(err: unknown): void {
    this.lastError = err instanceof Error ? err.message : String(err);
    this.setStatus('error');
    this.emit('error', err instanceof Error ? err : new Error(this.lastError));
  }

  private setStatus(s: ConnectionStatus): void {
    if (this._status === s) return;
    this._status = s;
    this.emit('status', s);
  }
}
