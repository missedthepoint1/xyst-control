import type { CameraSnapshot, ControlId } from '../types.js';

/** A single Browser Remote HTTP request, captured from the camera. */
export interface R5CRequest {
  method?: 'GET' | 'POST' | 'PUT';
  path: string;                          // e.g. '/api/v1/rec/start'
  query?: Record<string, string | number>;
  body?: string | Record<string, unknown>;
  contentType?: string;
}

export interface R5CEndpoints {
  /** Optional one-shot session login on connect (if the Browser Remote requires it). */
  login?: R5CRequest | null;
  /** GET returning the camera's current state; mapped by parseStatus(). */
  status: R5CRequest | null;
  recordStart: R5CRequest | null;
  recordStop: R5CRequest | null;
  /** Live-view still / MJPEG frame for the video panel. */
  liveView: R5CRequest | null;
  /** Build the request to set a control; return null for controls this body can't do. */
  control: (id: ControlId, value: string | number) => R5CRequest | null;
  /** Pull focus to a normalized point (x,y in 0..1) — Phase 6. */
  touchAf: ((x: number, y: number) => R5CRequest) | null;
}

/**
 * PENDING capture (Phase 4). Fill these in from a HAR capture of the R5 C Browser
 * Remote — see docs/r5c-capture.md and scripts/r5c-capture-analyze.mjs. The moment
 * `status` + `recordStart` + `recordStop` are non-null, the driver connects and polls
 * for real; everything downstream (REST, Stream Deck, UI) lights up unchanged.
 *
 * Example once captured:
 *   status:      { method: 'GET',  path: '/api/v1/status' },
 *   recordStart: { method: 'POST', path: '/api/v1/rec',    body: { action: 'start' } },
 *   control: (id, value) => id === 'iso'
 *     ? { method: 'POST', path: '/api/v1/exposure/iso', body: { value } } : null,
 */
export const R5C_ENDPOINTS: R5CEndpoints = {
  login: null,
  status: null,
  recordStart: null,
  recordStop: null,
  liveView: null,
  control: () => null,
  touchAf: null,
};

/**
 * Map the R5 C status payload (likely JSON) into our snapshot. Fill in once the
 * response shape is known; return whatever fields you can read and the driver merges
 * them — promise only what the camera actually reports (architecture rule 8).
 */
export function parseStatus(_raw: string): CameraSnapshot {
  // TODO(Phase 4): e.g.
  //   const j = JSON.parse(_raw);
  //   return {
  //     model: j.model,
  //     record: { recording: j.rec === 'recording' },
  //     controls: { iso: { id: 'iso', available: true, value: j.iso, list: j.isoList } },
  //   };
  return { record: { recording: false }, controls: {} };
}

/** The driver only goes live once the essential endpoints are captured. */
export function isConfigured(e: R5CEndpoints = R5C_ENDPOINTS): boolean {
  return !!(e.status && e.recordStart && e.recordStop);
}
