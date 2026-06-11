import type { CameraPreset, CameraState, ControlId, FocusPoint } from '@xyst/core';

export class XystApiClient {
  constructor(private base: string) {}

  private async req(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`API ${method} ${path} -> ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : undefined;
  }

  getCameras(): Promise<CameraState[]> { return this.req('GET', '/api/cameras') as Promise<CameraState[]>; }

  recordStart(id: string): Promise<unknown> { return this.req('POST', `/api/cameras/${id}/record/start`); }
  recordStop(id: string): Promise<unknown> { return this.req('POST', `/api/cameras/${id}/record/stop`); }
  recordAll(start: boolean): Promise<unknown> { return this.req('POST', `/api/record/${start ? 'start' : 'stop'}`); }

  setControl(id: string, control: ControlId, value: string | number): Promise<unknown> {
    return this.req('POST', `/api/cameras/${id}/controls/${control}`, { value });
  }
  stepControl(id: string, control: ControlId, dir: 1 | -1): Promise<unknown> {
    return this.req('POST', `/api/cameras/${id}/controls/${control}/step`, { dir });
  }

  listPresets(id: string): Promise<CameraPreset[]> {
    return this.req('GET', `/api/cameras/${id}/presets`) as Promise<CameraPreset[]>;
  }
  savePreset(id: string, name: string): Promise<unknown> {
    return this.req('POST', `/api/cameras/${id}/presets`, { name });
  }
  recallPreset(presetId: string): Promise<unknown> { return this.req('POST', `/api/presets/${presetId}/recall`); }
  recallPresetForCamera(id: string, presetId: string): Promise<unknown> {
    return this.req('POST', `/api/cameras/${id}/presets/${presetId}/recall`);
  }

  listFocusPoints(id: string): Promise<FocusPoint[]> {
    return this.req('GET', `/api/cameras/${id}/focus-points`) as Promise<FocusPoint[]>;
  }
  setFocus(id: string, x: number, y: number): Promise<unknown> {
    return this.req('POST', `/api/cameras/${id}/focus`, { x, y });
  }
  recallFocusPoint(id: string, pointId: string): Promise<unknown> {
    return this.req('POST', `/api/cameras/${id}/focus-points/${pointId}/recall`);
  }
  recallFocusPointById(pointId: string): Promise<unknown> {
    return this.req('POST', `/api/focus-points/${pointId}/recall`);
  }
}
