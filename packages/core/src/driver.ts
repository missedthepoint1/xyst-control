import { EventEmitter } from 'node:events';
import type { CameraState, ControlId, ConnectionStatus, ControlSettings } from './types.js';

export interface CameraDriverEvents {
  state: (state: CameraState) => void;
  status: (status: ConnectionStatus) => void;
  error: (err: Error) => void;
}

export interface CameraDriver extends EventEmitter {
  readonly id: string;
  readonly status: ConnectionStatus;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getState(): CameraState;
  startRecording(): Promise<void>;
  stopRecording(): Promise<void>;
  setControl(id: ControlId, value: string | number): Promise<void>;
  /** Apply several controls together (capability-aware) in one request. */
  applySettings(settings: ControlSettings): Promise<void>;
  /** Fetch a single preview frame (protocol JPEG). Optional — not all drivers support it. */
  getPreview?(): Promise<import('./types.js').PreviewFrame>;
}
