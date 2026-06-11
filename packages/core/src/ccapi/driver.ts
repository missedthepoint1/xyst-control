import { EventEmitter } from 'node:events';
import type { CameraDriver } from '../driver.js';
import type { CameraProfile, CameraSnapshot, CameraState, ConnectionStatus, ControlId, ControlSettings } from '../types.js';
import { ccapiJson } from './client.js';
import { interpretCcapi, type CcapiRaw } from './interpret.js';

export interface CcapiDriverOptions {
  pollMs?: number;
  timeoutMs?: number;
  /** CCAPI version segment for the control endpoints (default 'ver100'). */
  apiVersion?: string;
}

/** ControlId -> CCAPI shooting/settings setting name. Only the mapped controls are offered. */
const SETTING: Partial<Record<ControlId, string>> = {
  iso: 'iso', shutter: 'tv', iris: 'av', wb: 'wb', wbKelvin: 'colortemperature',
};

/**
 * Canon EOS R6 Mark III (and other CCAPI bodies) — Camera Control API driver. CCAPI is a
 * documented REST/JSON API, so unlike the XC and R5 C drivers nothing is reverse-engineered:
 * the body's own `shooting/settings` (value + `ability`) drives capability discovery, exactly
 * like the XC driver uses `info.cgi`. v1 covers connect, record, and ISO/shutter/iris/WB.
 *
 * Verify-on-hardware assumptions (documented but untested against a real R6 III here):
 *  - movie record is `POST shooting/control/recbutton {action:'start'|'stop'}` (recording state
 *    is tracked locally — CCAPI v1 has no simple "am I recording" read).
 *  - host must include the CCAPI port the camera displays (e.g. `192.168.1.50:8080`).
 */
export class CcapiDriver extends EventEmitter implements CameraDriver {
  readonly id: string;
  private _status: ConnectionStatus = 'disconnected';
  private snapshot: CameraSnapshot = { record: { recording: false }, controls: {} };
  private snapshotAt = 0;
  private lastError?: string;
  private readonly pollMs: number;
  private readonly timeoutMs: number;
  private readonly base: string;
  private raw: CcapiRaw = { iso: new Map(), tv: new Map(), av: new Map() };
  private recording = false;
  private timer?: NodeJS.Timeout;
  private polling = false;
  private controlInFlight = false;

  constructor(private profile: CameraProfile, opts: CcapiDriverOptions = {}) {
    super();
    this.id = profile.id;
    this.pollMs = opts.pollMs ?? 750;
    this.timeoutMs = opts.timeoutMs ?? 4000;
    this.base = `/ccapi/${opts.apiVersion ?? 'ver100'}`;
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
    this.setStatus('connecting');
    try {
      await ccapiJson(this.profile.host, '/ccapi', { auth: this.profile.auth, timeoutMs: this.timeoutMs }); // reachability + is-CCAPI
      await this.refresh();
      this.setStatus('connected');
    } catch (err) {
      this.fail(err);
    }
    this.startPolling();
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.setStatus('disconnected');
  }

  async startRecording(): Promise<void> { await this.recButton('start'); }
  async stopRecording(): Promise<void> { await this.recButton('stop'); }

  async setControl(id: ControlId, value: string | number): Promise<void> {
    const name = SETTING[id];
    if (!name) throw new Error(`CCAPI: control '${id}' not supported`);
    const payload = this.payloadFor(id, value);
    this.controlInFlight = true;
    try {
      await ccapiJson(this.profile.host, `${this.base}/shooting/settings/${name}`, {
        method: 'PUT', body: { value: payload }, auth: this.profile.auth, timeoutMs: this.timeoutMs,
      });
      await this.refresh();
    } finally {
      this.controlInFlight = false;
    }
  }

  async applySettings(settings: ControlSettings): Promise<void> {
    for (const [id, value] of Object.entries(settings)) {
      if (value !== undefined && SETTING[id as ControlId]) await this.setControl(id as ControlId, value);
    }
  }

  // --- internals ---

  /** Translate a UI (normalised) control value back to the exact CCAPI string the body accepts. */
  private payloadFor(id: ControlId, value: string | number): string | number {
    if (id === 'iso') return this.raw.iso.get(Number(value)) ?? String(value);
    if (id === 'shutter') return this.raw.tv.get(Number(value)) ?? `1/${value}`;
    if (id === 'iris') {
      const p = this.raw.av.get(Number(value));
      if (!p) throw new Error(`CCAPI: no aperture matching ${value}`);
      return p;
    }
    if (id === 'wbKelvin') return Number(value);
    return String(value); // wb and any string-valued setting
  }

  private async recButton(action: 'start' | 'stop'): Promise<void> {
    this.controlInFlight = true;
    try {
      await ccapiJson(this.profile.host, `${this.base}/shooting/control/recbutton`, {
        method: 'POST', body: { action }, auth: this.profile.auth, timeoutMs: this.timeoutMs,
      });
      this.recording = action === 'start';
      await this.refresh();
    } finally {
      this.controlInFlight = false;
    }
  }

  private async refresh(): Promise<void> {
    const [settings, device, battery] = await Promise.all([
      ccapiJson<Record<string, never>>(this.profile.host, `${this.base}/shooting/settings`, { auth: this.profile.auth, timeoutMs: this.timeoutMs }),
      ccapiJson<{ productname?: string }>(this.profile.host, `${this.base}/deviceinformation`, { auth: this.profile.auth, timeoutMs: this.timeoutMs }).catch(() => undefined),
      ccapiJson<{ level?: string | number; kind?: string }>(this.profile.host, `${this.base}/devicestatus/battery`, { auth: this.profile.auth, timeoutMs: this.timeoutMs }).catch(() => undefined),
    ]);
    const { snapshot, raw } = interpretCcapi(settings, device, battery);
    snapshot.record.recording = this.recording;
    this.snapshot = snapshot;
    this.raw = raw;
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
