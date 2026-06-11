import { EventEmitter } from 'node:events';
import type { CameraDriver } from '../driver.js';
import type { CameraProfile, CameraSnapshot, CameraState, ConnectionStatus, ControlId, ControlSettings, PreviewFrame } from '../types.js';
import { r5cFetch, r5cFetchBinary } from './client.js';
import { R5C_ENDPOINTS, parseStatus, isConfigured, type R5CEndpoints, type R5CRequest } from './endpoints.js';

const PENDING = 'R5 C Browser Remote endpoints pending capture (Phase 4)';

export interface R5CDriverOptions {
  pollMs?: number;
  timeoutMs?: number;
  endpoints?: R5CEndpoints;
  /** Override the status parser (defaults to the captured parseStatus). */
  parseStatus?: (raw: string) => CameraSnapshot;
}

/**
 * Canon EOS R5 C — Browser Remote HTTP driver. The transport + robustness (timeout,
 * retry, status poll, reconnect) are complete; the only thing missing is the captured
 * endpoint map in `endpoints.ts`. While that's empty the driver fails loud (status
 * 'error', actions throw) rather than guessing against a real R5 C. Fill `R5C_ENDPOINTS`
 * + `parseStatus` from a capture and it goes live with no other changes.
 */
export class R5CBrowserRemoteDriver extends EventEmitter implements CameraDriver {
  readonly id: string;
  private _status: ConnectionStatus = 'disconnected';
  private snapshot: CameraSnapshot = { record: { recording: false }, controls: {} };
  private snapshotAt = 0;
  private lastError?: string;
  private readonly pollMs: number;
  private readonly timeoutMs: number;
  private readonly endpoints: R5CEndpoints;
  private readonly parse: (raw: string) => CameraSnapshot;
  private timer?: NodeJS.Timeout;
  private polling = false;
  private controlInFlight = false;

  constructor(private profile: CameraProfile, opts: R5CDriverOptions = {}) {
    super();
    this.id = profile.id;
    this.pollMs = opts.pollMs ?? 750;
    this.timeoutMs = opts.timeoutMs ?? 4000;
    this.endpoints = opts.endpoints ?? R5C_ENDPOINTS;
    this.parse = opts.parseStatus ?? parseStatus;
    this.on('error', () => {});
  }

  get status(): ConnectionStatus { return this._status; }

  getState(): CameraState {
    return {
      id: this.id,
      name: this.profile.name,
      status: this._status,
      updatedAt: this.snapshotAt,
      lastError: this.lastError,
      video: this.profile.video,
      focusPoints: this.profile.focusPoints,
      ...this.snapshot,
    };
  }

  async connect(): Promise<void> {
    if (!isConfigured(this.endpoints)) {
      this.lastError = PENDING;
      this.setStatus('error');
      return; // fail soft: nothing to talk to yet
    }
    this.setStatus('connecting');
    try {
      if (this.endpoints.login) await this.send(this.endpoints.login);
      await this.refresh();
      this.setStatus('connected');
    } catch (err) {
      this.fail(err);
    }
    this.startPolling(); // keep trying / stay live
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.setStatus('disconnected');
  }

  async startRecording(): Promise<void> { await this.action(this.endpoints.recordStart); }
  async stopRecording(): Promise<void> { await this.action(this.endpoints.recordStop); }

  async setControl(id: ControlId, value: string | number): Promise<void> {
    const req = this.endpoints.control(id, value);
    if (!req) throw new Error(`${PENDING}: control ${id}`);
    await this.action(req);
  }

  async applySettings(settings: ControlSettings): Promise<void> {
    for (const [id, value] of Object.entries(settings)) {
      if (value !== undefined) await this.setControl(id as ControlId, value);
    }
  }

  async getPreview(): Promise<PreviewFrame> {
    if (!this.endpoints.liveView) throw new Error(`${PENDING}: live view`);
    const e = this.endpoints.liveView;
    return r5cFetchBinary(this.profile.host, e.path, { method: e.method, query: e.query, auth: this.profile.auth, timeoutMs: this.timeoutMs });
  }

  async setFocusPoint(x: number, y: number): Promise<void> {
    if (!this.endpoints.touchAf) throw new Error(`${PENDING}: touch AF`);
    await this.action(this.endpoints.touchAf(x, y));
  }

  // --- internals ---

  /** Run a control/record request (null ⇒ pending), then refresh state. */
  private async action(req: R5CRequest | null): Promise<void> {
    if (!req) throw new Error(PENDING);
    this.controlInFlight = true;
    try {
      await this.send(req);
      await this.refresh();
    } finally {
      this.controlInFlight = false;
    }
  }

  private send(req: R5CRequest): Promise<{ status: number; text: string }> {
    return r5cFetch(this.profile.host, req.path, {
      method: req.method, query: req.query, body: req.body, contentType: req.contentType,
      auth: this.profile.auth, timeoutMs: this.timeoutMs,
    });
  }

  private async refresh(): Promise<void> {
    if (!this.endpoints.status) return;
    const { text } = await this.send(this.endpoints.status);
    this.snapshot = this.parse(text);
    this.snapshotAt = Date.now();
    this.lastError = undefined;
    this.emit('state', this.getState());
  }

  private startPolling(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), this.pollMs);
  }

  private async poll(): Promise<void> {
    if (this.polling || this.controlInFlight) return;
    this.polling = true;
    try {
      await this.refresh();
      if (this._status === 'error') this.setStatus('connected');
    } catch (err) {
      this.fail(err);
    } finally {
      this.polling = false;
    }
  }

  private fail(err: unknown): void {
    this.lastError = err instanceof Error ? err.message : String(err);
    this.setStatus('error');
  }

  private setStatus(s: ConnectionStatus): void {
    if (this._status === s) return;
    this._status = s;
    this.emit('status', s);
  }
}
