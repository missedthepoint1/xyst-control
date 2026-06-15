import { EventEmitter } from 'node:events';
import type { CameraDriver } from '../driver.js';
import type { CameraProfile, CameraSnapshot, CameraState, ConnectionStatus, ControlId, ControlSettings, PreviewFrame } from '../types.js';
import { ccapiBinary, ccapiJson } from './client.js';
import { interpretCcapi, type CcapiRaw } from './interpret.js';

export interface CcapiDriverOptions {
  pollMs?: number;
  timeoutMs?: number;
  /** CCAPI version segment for the control endpoints (default 'ver100'). */
  apiVersion?: string;
  /** Live view frame size requested from the body: 'small' (~320) or 'medium' (~1024). */
  liveviewSize?: 'small' | 'medium';
}

/** ControlId -> CCAPI shooting/settings setting name. Only the mapped controls are offered. */
const SETTING: Partial<Record<ControlId, string>> = {
  iso: 'iso', shutter: 'tv', iris: 'av', wb: 'wb', wbKelvin: 'colortemperature',
};

/**
 * Canon EOS R6 Mark III (and other CCAPI bodies) — Camera Control API driver. CCAPI is a
 * documented REST/JSON API, so unlike the XC and R5 C drivers nothing is reverse-engineered:
 * the body's own `shooting/settings` (value + `ability`) drives capability discovery, exactly
 * like the XC driver uses `info.cgi`. Covers connect, record, ISO/shutter/iris/WB, and live view
 * (JPEG-per-poll via `shooting/liveview/flip`).
 *
 * Verified against a live EOS R6 Mark III (firmware 1.0.0): capability discovery from
 * `shooting/settings` (value + `ability`), `deviceinformation`, and `recbutton` (POST; GET → 405).
 * Transport is HTTPS/443 with a self-signed cert (handled in `client.ts`), NOT `http:8080`.
 *  - movie record is `POST shooting/control/recbutton {action:'start'|'stop'}` (recording state
 *    is tracked locally — CCAPI v1 has no simple "am I recording" read).
 *  - Auth caveat: this body's Digest uses a *static nonce* and enforces the nonce-count, so the
 *    one-shot `nc:1` digest in `client.ts` only authenticates a single request before the camera
 *    rejects replays. Run with the camera's CCAPI auth disabled until digest is made stateful
 *    (persist the challenge + increment `nc`). Connecting also requires the body to be off its
 *    "Waiting to connect" pairing screen.
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
  private readonly liveviewSize: 'small' | 'medium';
  private raw: CcapiRaw = { iso: new Map(), tv: new Map(), av: new Map() };
  private recording = false;
  private timer?: NodeJS.Timeout;
  private polling = false;
  private controlInFlight = false;
  private liveviewActive = false;

  constructor(private profile: CameraProfile, opts: CcapiDriverOptions = {}) {
    super();
    this.id = profile.id;
    this.pollMs = opts.pollMs ?? 750;
    this.timeoutMs = opts.timeoutMs ?? 4000;
    this.base = `/ccapi/${opts.apiVersion ?? 'ver100'}`;
    this.liveviewSize = opts.liveviewSize ?? 'medium';
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
    await this.stopLiveview();
    this.setStatus('disconnected');
  }

  /**
   * Live view (Phase 5). CCAPI serves a JPEG-per-poll preview, mirroring the XC `image.cgi`
   * path: arm the body's live view once (lazily, only when a frame is actually requested — video
   * stays decoupled from control, rule 5), then GET `shooting/liveview/flip` for the latest
   * complete frame. If the body has torn live view down (mode change / sleep), re-arm once and retry.
   */
  async getPreview(): Promise<PreviewFrame> {
    if (!this.liveviewActive) await this.startLiveview();
    try {
      return await this.flip();
    } catch (err) {
      // The body returns `503 {"message":"Live view not started"}` only when live view truly
      // isn't running (it can drop after the camera sleeps or changes mode) — re-arm once for
      // that. For ANY other failure (notably: the operator is in the camera's own menu, which
      // stalls frame delivery) do NOT re-POST liveview: re-arming would yank them back out of
      // the menu. Surface the gap instead and let the next poll retry.
      if (this.liveviewActive && /live view not started/i.test(String(err))) {
        this.liveviewActive = false;
        await this.startLiveview();
        return this.flip();
      }
      throw err;
    }
  }

  /**
   * Release live view so the operator can use the camera body (its menu is locked out while
   * live view streams). Called by the manager when the video source leaves 'protocol', and on
   * disconnect. Selecting "Live view" again re-arms lazily on the next frame request.
   */
  async stopPreview(): Promise<void> {
    await this.stopLiveview();
  }

  private flip(): Promise<PreviewFrame> {
    return ccapiBinary(this.profile.host, `${this.base}/shooting/liveview/flip`, {
      auth: this.profile.auth, timeoutMs: this.timeoutMs,
    });
  }

  private async startLiveview(): Promise<void> {
    // cameradisplay:'keep' — drive live view over CCAPI without commandeering the body's own
    // screen, so the camera stays usable as the operator left it.
    await ccapiJson(this.profile.host, `${this.base}/shooting/liveview`, {
      method: 'POST', body: { cameradisplay: 'keep', liveviewsize: this.liveviewSize },
      auth: this.profile.auth, timeoutMs: this.timeoutMs,
    });
    this.liveviewActive = true;
  }

  private async stopLiveview(): Promise<void> {
    if (!this.liveviewActive) return;
    this.liveviewActive = false;
    try {
      await ccapiJson(this.profile.host, `${this.base}/shooting/liveview`, {
        method: 'POST', body: { cameradisplay: 'keep', liveviewsize: 'off' },
        auth: this.profile.auth, timeoutMs: this.timeoutMs,
      });
    } catch { /* best-effort teardown — the body drops live view on disconnect anyway */ }
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
