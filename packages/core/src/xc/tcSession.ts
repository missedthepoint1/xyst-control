import { xcRequest } from './client.js';
import type { CameraAuth } from '../types.js';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface TcSessionOptions {
  host: string;
  auth?: CameraAuth;
  timeoutMs?: number;
  /** How often to read the running timecode (also the session keepalive cadence). */
  pollMs?: number;
  /** Called with the live "HH:MM:SS:FF" on each read, or undefined when the session is down. */
  onValue: (value: string | undefined) => void;
}

/**
 * Maintains a dedicated, READ-ONLY XC session purely to read the running timecode.
 *
 * Why a session at all: the live `f.timecode` value is only exposed inside an open session with
 * `f.timecode.info=on` — sessionless `info.cgi` returns only the static preset (`f.timecode.set`).
 * This runs ALONGSIDE the driver's sessionless control path and is fully fail-soft: any error just
 * clears the value (the OSD chip hides) and retries; it never touches control or live view
 * (architecture rules 5 & 6). The ~1s poll doubles as the keepalive (a session is cleared after 60s
 * of no requests); a `501 Unknown Connection ID` (or any failure) drops the id and reopens next tick.
 */
export class XcTimecodeSession {
  private sid?: string;
  private stopped = true;

  constructor(private readonly opts: TcSessionOptions) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    const sid = this.sid;
    this.sid = undefined;
    this.opts.onValue(undefined);
    if (sid) void this.req('close.cgi', { s: sid }).catch(() => {});
  }

  private req(command: string, params: Record<string, string>) {
    return xcRequest(this.opts.host, command, params, { auth: this.opts.auth, timeoutMs: this.opts.timeoutMs });
  }

  private async ensureSession(): Promise<void> {
    if (this.sid) return;
    const open = await this.req('open.cgi', { v: 'null' }); // video-less session
    const sid = open.map['s'];
    if (!sid) throw new Error('timecode session: no session id in open.cgi response');
    this.sid = sid;
    // Enable timecode telemetry FOR THIS SESSION so the live `f.timecode` field is reported. This is
    // a per-session flag — it must be set with the session id, not sessionlessly.
    await this.req('control.cgi', { s: sid, 'f.timecode.info': 'on' });
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.ensureSession();
        const r = await this.req('info.cgi', { s: this.sid as string, item: 'f.timecode' });
        const value = r.map['f.timecode'];
        if (!this.stopped) this.opts.onValue(value || undefined);
      } catch {
        // Session expired/invalid/unreachable — drop it, surface "no value", reopen next tick.
        this.sid = undefined;
        if (!this.stopped) this.opts.onValue(undefined);
      }
      await delay(this.opts.pollMs ?? 1000);
    }
  }
}
