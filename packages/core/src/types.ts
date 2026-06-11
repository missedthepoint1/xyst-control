export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type ControlId =
  | 'iso' | 'gain' | 'shutter' | 'shutterMode' | 'shutterAngle'
  | 'iris' | 'wb' | 'wbKelvin' | 'nd'
  | 'focus' | 'faceDetect' | 'colorbar'
  | 'isoAuto' | 'ndExtended' | 'wbCC' | 'awbHold' | 'wbAction' | 'afMode' | 'afSpeed' | 'afResponse' | 'afLock' | 'focusAction'
  | 'osdOutput';

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

export interface PowerState {
  source?: string;   // 'battery' | 'ac' | ...
  volt?: number;     // volts (e.g. 14.0)
  percent?: number;  // 0..100, if the battery reports it
  minutes?: number;  // remaining, if reported
}

/** The interpreted result of one info.cgi read. */
export interface CameraSnapshot {
  model?: string;
  exposureMode?: string; // c.1.exp
  record: RecordState;
  controls: Partial<Record<ControlId, ControlState>>;
  power?: PowerState;
}

/** The full externally-visible state of a camera. */
export interface CameraState extends CameraSnapshot {
  id: string;
  name: string;
  status: ConnectionStatus;
  updatedAt: number;
  lastError?: string;
  video?: VideoSource;
  audio?: AudioSource;
  focusPoints?: FocusPoint[];
}

export interface CameraAuth {
  username?: string;
  password?: string;
}

/** A single preview frame (JPEG bytes) fetched from a camera. */
export interface PreviewFrame { data: Uint8Array; contentType: string; }

/** Per-camera video source for the live-view panel (decoupled from control). */
export interface VideoSource { type: 'none' | 'protocol' | 'capture'; deviceId?: string; }

/** Per-camera audio input for the meters (embedded SDI/HDMI audio or any input). The
 * XC protocol carries no audio levels, so this is metered in the app via Web Audio. */
export interface AudioSource { deviceId?: string; }

export interface CameraProfile {
  id: string;
  name: string;
  driver: 'xc' | 'r5c';
  host: string;
  auth?: CameraAuth;
  presets?: CameraPreset[];
  focusPoints?: FocusPoint[];
  video?: VideoSource;
  audio?: AudioSource;
}

/** A set of control values to apply together (preset payload / bulk apply). */
export type ControlSettings = Partial<Record<ControlId, string | number>>;

export interface DetectBox {
  type: 'face' | 'eye' | 'object';
  x: number;
  y: number;
  w: number;
  h: number;
  main: boolean;
  track: boolean;
}

export interface FocusGuide {
  status: boolean;
  level: number;
  angle: number;
  dir: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CameraMeta {
  detect: DetectBox[];
  fguide?: FocusGuide;
}

/** An app-managed snapshot of camera settings (NOT a camera-native PTZ preset). */
export interface CameraPreset {
  id: string;
  name: string;
  settings: ControlSettings;
  /** Exposure mode captured at save time (usually 'manual'). */
  exposureMode?: string;
}

/** A named AF position stored per-camera (normalized 0..1 x/y). */
export interface FocusPoint {
  id: string;
  name: string;
  x: number;
  y: number;
}
