import { EventEmitter } from 'node:events';
import type { CameraDriver } from '../driver.js';
import type {
  CameraProfile, CameraState, CameraSnapshot, ConnectionStatus, ControlId, ControlSettings,
  ControlState,
} from '../types.js';
import { xcRequest, xcRequestBinary } from './client.js';
import { fetchMeta } from './meta.js';
import { interpretInfo } from './interpret.js';
import { buildControlParams, buildRecordParams, buildSettingsParams } from './commands.js';
import { openInfoStream, type InfoStreamHandle } from './stream.js';

export interface XCDriverOptions {
  pollMs?: number;
  timeoutMs?: number;
  /** Slow reconcile/liveness poll cadence while the stream is healthy. */
  reconcileMs?: number;
}

export class XCProtocolDriver extends EventEmitter implements CameraDriver {
  readonly id: string;
  private _status: ConnectionStatus = 'disconnected';
  private snapshot: CameraSnapshot = { record: { recording: false }, controls: {} };
  private snapshotAt = 0;
  private timer?: NodeJS.Timeout;
  private polling = false;
  private controlInFlight = false;
  private lastError?: string;
  private readonly pollMs: number;
  private readonly timeoutMs: number;
  private readonly reconcileMs: number;
  private stream?: InfoStreamHandle;
  private streaming = false;
  private lastActivityAt = 0;
  private streamRetry?: NodeJS.Timeout;

  constructor(private profile: CameraProfile, opts: XCDriverOptions = {}) {
    super();
    this.id = profile.id;
    this.pollMs = opts.pollMs ?? 750;
    this.timeoutMs = opts.timeoutMs ?? 4000;
    this.reconcileMs = opts.reconcileMs ?? 5000;
    // Safety net: prevent Node from throwing on unhandled 'error' events.
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

  async getPreview(): Promise<import('../types.js').PreviewFrame> {
    return xcRequestBinary(this.profile.host, 'image.cgi', {}, {
      auth: this.profile.auth, timeoutMs: this.timeoutMs,
    });
  }

  async getMeta(): Promise<import('../types.js').CameraMeta> {
    return fetchMeta(this.profile.host, { auth: this.profile.auth, timeoutMs: this.timeoutMs });
  }

  async connect(): Promise<void> {
    this.setStatus('connecting');
    try {
      await this.refresh();
      this.setStatus('connected');
      this.startPolling();
      this.startStream();
    } catch (err) {
      this.fail(err);
      this.startPolling(); // keep trying to recover
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.streamRetry) clearTimeout(this.streamRetry);
    this.streamRetry = undefined;
    this.stopStream();
    this.setStatus('disconnected');
  }

  async startRecording(): Promise<void> { await this.control(buildRecordParams(true)); }
  async stopRecording(): Promise<void> { await this.control(buildRecordParams(false)); }

  async setControl(id: ControlId, value: string | number): Promise<void> {
    // Camera OSD output lives on configuration.cgi, not control.cgi.
    if (id === 'osdOutput') {
      await this.configure({ 'monitoring.osd.framedisplay': String(value) });
      return;
    }
    await this.control(buildControlParams(id, value));
  }

  async applySettings(settings: ControlSettings): Promise<void> {
    const params = buildSettingsParams(settings);
    if (Object.keys(params).length === 0) return;
    await this.control(params);
  }

  async setFocusPoint(nx: number, ny: number): Promise<void> {
    const clamp = (v: number) => Math.max(0, Math.min(9999, Math.round(v * 9999)));
    await this.control({
      'c.1.focus.frame.pos': 'movable',
      'c.1.focus.frame.1.x': String(clamp(nx)),
      'c.1.focus.frame.1.y': String(clamp(ny)),
      'c.1.focus.action': 'one_shot',
    });
  }

  // --- internals ---

  private async control(params: Record<string, string>): Promise<void> {
    this.controlInFlight = true;
    try {
      const { map } = await xcRequest(this.profile.host, 'control.cgi', params, {
        auth: this.profile.auth, timeoutMs: this.timeoutMs,
      });
      this.mergeMap(map);
      await this.refresh();
    } finally {
      this.controlInFlight = false;
    }
  }

  /** Like control(), but targets configuration.cgi (monitoring/assist settings). */
  private async configure(params: Record<string, string>): Promise<void> {
    this.controlInFlight = true;
    try {
      await xcRequest(this.profile.host, 'configuration.cgi', params, {
        auth: this.profile.auth, timeoutMs: this.timeoutMs,
      });
      await this.refresh();
    } finally {
      this.controlInFlight = false;
    }
  }

  private async refresh(): Promise<void> {
    const { map } = await xcRequest(this.profile.host, 'info.cgi', {}, {
      auth: this.profile.auth, timeoutMs: this.timeoutMs,
    });
    this.lastError = undefined;
    this.snapshot = interpretInfo(map);
    this.snapshotAt = Date.now();
    this.lastActivityAt = Date.now();
    this.emit('state', this.getState());
  }

  /** Merge a partial info map (control echo or stream delta) into the snapshot. */
  private mergeMap(map: Record<string, string>): void {
    const merged = interpretInfo(map);
    if ('c.1.type' in map && merged.model) this.snapshot.model = merged.model;
    if ('c.1.exp' in map && merged.exposureMode) this.snapshot.exposureMode = merged.exposureMode;
    if ('f.rec.status' in map) {
      this.snapshot.record = { ...this.snapshot.record, ...merged.record };
    }
    // Deep-merge each control so a value-only delta keeps the previously-discovered
    // list/min/max/mode (interpretInfo emits `undefined` for keys absent from a delta).
    const controls = { ...this.snapshot.controls };
    for (const [id, c] of Object.entries(merged.controls)) {
      const key = id as ControlId;
      const prev = controls[key];
      if (!prev) { controls[key] = c; continue; }
      const defined = Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined));
      controls[key] = { ...prev, ...defined } as ControlState;
    }
    this.snapshot.controls = controls;
  }

  private startPolling(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), this.pollMs);
  }

  private async poll(): Promise<void> {
    if (this.polling || this.controlInFlight) return;
    // While the stream is healthy, only poll as a slow reconcile/liveness check.
    if (this.streaming && Date.now() - this.lastActivityAt < this.reconcileMs) return;
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

  private startStream(): void {
    if (this.stream) return;
    this.stream = openInfoStream(this.profile.host, { auth: this.profile.auth }, {
      onOpen: () => { this.streaming = true; this.lastActivityAt = Date.now(); },
      onDelta: (map) => this.onStreamDelta(map),
      onError: () => this.onStreamDown(),
    });
  }

  private stopStream(): void {
    this.streaming = false;
    this.stream?.close();
    this.stream = undefined;
  }

  private onStreamDelta(map: Record<string, string>): void {
    this.streaming = true;
    this.lastActivityAt = Date.now();
    this.mergeMap(map);
    this.snapshotAt = Date.now();
    this.lastError = undefined;
    if (this._status === 'error') this.setStatus('connected');
    this.emit('state', this.getState());
  }

  private onStreamDown(): void {
    this.stopStream();
    // Fast polling (the poll loop) covers state until the stream returns.
    if (this.streamRetry) return;
    this.streamRetry = setTimeout(() => {
      this.streamRetry = undefined;
      if (this._status !== 'disconnected') this.startStream();
    }, 2000);
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
