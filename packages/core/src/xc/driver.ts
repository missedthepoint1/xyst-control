import { EventEmitter } from 'node:events';
import type { CameraDriver } from '../driver.js';
import type {
  CameraProfile, CameraState, CameraSnapshot, ConnectionStatus, ControlId, ControlSettings,
  ControlState, RecordState,
} from '../types.js';
import { xcRequest, xcRequestBinary } from './client.js';
import { fetchMeta } from './meta.js';
import { interpretInfo } from './interpret.js';
import { buildControlParams, buildRecordParams, buildSettingsParams } from './commands.js';
import { openInfoStream, type InfoStreamHandle } from './stream.js';
import { XcTimecodeSession } from './tcSession.js';

export interface XCDriverOptions {
  pollMs?: number;
  timeoutMs?: number;
  /** Slow reconcile/liveness poll cadence while the stream is healthy. */
  reconcileMs?: number;
  /** Running-timecode session poll cadence (default 1000ms). */
  tcPollMs?: number;
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
  private readonly tcPollMs?: number;
  private stream?: InfoStreamHandle;
  private streaming = false;
  private lastActivityAt = 0;
  private streamRetry?: NodeJS.Timeout;
  private tcSession?: XcTimecodeSession;
  /** Live running timecode from the dedicated TC session, injected into getState(). */
  private liveTimecode?: string;

  constructor(private profile: CameraProfile, opts: XCDriverOptions = {}) {
    super();
    this.id = profile.id;
    this.pollMs = opts.pollMs ?? 750;
    this.timeoutMs = opts.timeoutMs ?? 4000;
    this.reconcileMs = opts.reconcileMs ?? 5000;
    this.tcPollMs = opts.tcPollMs;
    // Safety net: prevent Node from throwing on unhandled 'error' events.
    this.on('error', () => {});
  }

  get status(): ConnectionStatus { return this._status; }

  getState(): CameraState {
    const state: CameraState = {
      id: this.id,
      name: this.profile.name,
      status: this._status,
      updatedAt: this.snapshotAt,
      lastError: this.lastError,
      video: this.profile.video,
      focusPoints: this.profile.focusPoints,
      ...this.snapshot,
    };
    // Inject the live running timecode (from the dedicated TC session) on top of the config that
    // came from the sessionless info.cgi, so a refresh() rebuilding the snapshot doesn't drop it.
    if (this.liveTimecode) state.timecode = { ...state.timecode, value: this.liveTimecode };
    return state;
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
      this.startTimecodeSession();
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
    this.stopTimecodeSession();
    this.setStatus('disconnected');
  }

  // The live timecode runs in its own read-only session (see xc/tcSession.ts). It's fully
  // decoupled from control: if it can't open or drops, the TC chip just hides — control and
  // live view are unaffected.
  private startTimecodeSession(): void {
    if (this.tcSession) return;
    this.tcSession = new XcTimecodeSession({
      host: this.profile.host,
      auth: this.profile.auth,
      timeoutMs: this.timeoutMs,
      pollMs: this.tcPollMs,
      onValue: (value) => {
        if (this.liveTimecode === value) return;
        this.liveTimecode = value;
        this.emit('state', this.getState());
      },
    });
    this.tcSession.start();
  }

  private stopTimecodeSession(): void {
    this.tcSession?.stop();
    this.tcSession = undefined;
    this.liveTimecode = undefined;
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
      // The control.cgi echo already carries the changed keys — apply + surface them now so the
      // command's effect is reflected even if the follow-up read fails.
      this.mergeMap(map);
      this.emit('state', this.getState());
      // The follow-up full read is best-effort reconciliation; a transient failure must NOT turn a
      // command the camera already executed (e.g. REC) into a reported failure. The stream/reconcile
      // poll will catch up regardless.
      await this.refresh().catch(() => {});
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
      // Best-effort read-back (see control()); configuration.cgi already applied on the camera.
      await this.refresh().catch(() => {});
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
    // Merge only the rec sub-fields PRESENT in this delta. interpretInfo always emits a full
    // record object (recording:false by default), so an all-or-nothing spread gated on
    // f.rec.status would drop remaining-time / media-status deltas that the stream sends on their
    // own (they tick independently of the rec flag) — those used to surface only on the 5s reconcile.
    const record: RecordState = { ...this.snapshot.record };
    let recChanged = false;
    if ('f.rec.status' in map) { record.recording = merged.record.recording; recChanged = true; }
    if ('f.rec.media1.status' in map) { record.media1 = merged.record.media1; recChanged = true; }
    if ('f.rec.media2.status' in map) { record.media2 = merged.record.media2; recChanged = true; }
    if ('f.rec.media1.remainingtime' in map) { record.remainingMinutes = merged.record.remainingMinutes; recChanged = true; }
    if (recChanged) this.snapshot.record = record;
    // Merge only the TC sub-fields present in this delta (interpretInfo already omits the rest),
    // so a value-only tick keeps the previously-known run/df/mode.
    if (merged.timecode) {
      this.snapshot.timecode = { ...this.snapshot.timecode, ...merged.timecode };
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
