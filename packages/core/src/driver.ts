import { EventEmitter } from 'node:events';
import type { CameraState, ControlId, ConnectionStatus } from './types.js';

export interface CameraDriverEvents {
  state: (patch: Partial<CameraState>) => void;
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
}
