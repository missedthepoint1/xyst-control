export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type ControlId = 'iso' | 'gain' | 'shutter' | 'iris' | 'wb' | 'wbKelvin' | 'nd';

/** A single discovered control: what it currently is + what values are valid. */
export interface ControlState {
  id: ControlId;
  available: boolean;
  value?: string | number;
  /** Discrete allowed values (e.g. ISO list, ND list, WB presets). */
  list?: Array<string | number>;
  /** Continuous range (e.g. iris abstract value). */
  min?: number;
  max?: number;
  /** Current sub-mode (e.g. shutter.mode = 'speed', wb = 'kelvin'). */
  mode?: string;
  modeList?: string[];
  /** Display hint, e.g. 'K', 'ND', 'dB'. */
  unit?: string;
}

export interface RecordState {
  recording: boolean;
  media1?: string;
  media2?: string;
  remainingMinutes?: number;
}

/** The interpreted result of one info.cgi read. */
export interface CameraSnapshot {
  model?: string;
  exposureMode?: string; // c.1.exp
  record: RecordState;
  controls: Partial<Record<ControlId, ControlState>>;
}

/** The full externally-visible state of a camera. */
export interface CameraState extends CameraSnapshot {
  id: string;
  name: string;
  status: ConnectionStatus;
  updatedAt: number;
  lastError?: string;
}

export interface CameraAuth {
  username?: string;
  password?: string;
}

export interface CameraProfile {
  id: string;
  name: string;
  driver: 'xc' | 'r5c';
  host: string;
  auth?: CameraAuth;
  presets?: CameraPreset[];
}

/** A set of control values to apply together (preset payload / bulk apply). */
export type ControlSettings = Partial<Record<ControlId, string | number>>;

/** An app-managed snapshot of camera settings (NOT a camera-native PTZ preset). */
export interface CameraPreset {
  id: string;
  name: string;
  settings: ControlSettings;
  /** Exposure mode captured at save time (usually 'manual'). */
  exposureMode?: string;
}
