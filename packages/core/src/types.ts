export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type ControlId =
  | 'iso' | 'gain' | 'shutter' | 'shutterMode' | 'shutterAngle'
  | 'iris' | 'wb' | 'wbKelvin' | 'nd'
  | 'focus' | 'faceDetect' | 'colorbar'
  | 'isoAuto' | 'ndExtended' | 'wbCC' | 'awbHold' | 'wbAction' | 'afMode' | 'afSpeed' | 'afResponse' | 'afLock' | 'focusAction' | 'focusTracking'
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
  /**
   * Additive step for one up/down on a RANGED numeric control, in the control's own value units
   * (e.g. gain is dB×10, so 5 = one 0.5 dB step). Only set for ranged controls whose native step
   * isn't 1; stepControl defaults to 1 otherwise. Not used for list controls (they step by index),
   * and distinct from the XC `.increment` stop-fraction CODE on ISO/shutter (3 = 1/3-stop), which
   * describes list granularity rather than an additive delta.
   */
  increment?: number;
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

/**
 * Read-only timecode telemetry (display only, like {@link PowerState}). Cinema EOS bodies
 * advertise this over XC (`f.timecode.*`); CCAPI bodies (R6 III) do not expose a timecode
 * endpoint in any published version, so it stays undefined there. Not a {@link ControlId}.
 */
export interface TimecodeState {
  /**
   * Current RUNNING timecode, "HH:MM:SS:FF". On XC this is the bare `f.timecode` field, which is
   * only exposed inside an open session with `f.timecode.info=on` (NOT `f.timecode.set`, which is
   * the static preset). Undefined until the driver's timecode session reports a value.
   */
  value?: string;
  /** Count-up mode: 'recrun' (advances only while recording) | 'freerun'. */
  run?: string;
  /** true = drop-frame (DF), false = non-drop (NDF). */
  dropFrame?: boolean;
  /** TC source mode: 'preset' | 'regen'. */
  mode?: string;
}

/** The interpreted result of one info.cgi read. */
export interface CameraSnapshot {
  model?: string;
  exposureMode?: string; // c.1.exp
  record: RecordState;
  controls: Partial<Record<ControlId, ControlState>>;
  power?: PowerState;
  timecode?: TimecodeState;
}

/** The full externally-visible state of a camera. */
export interface CameraState extends CameraSnapshot {
  id: string;
  name: string;
  driver?: CameraProfile['driver'];
  status: ConnectionStatus;
  updatedAt: number;
  lastError?: string;
  video?: VideoSource;
  focusPoints?: FocusPoint[];
  ui?: CameraUiSettings;
}

export interface CameraAuth {
  username?: string;
  password?: string;
}

/** A single preview frame (JPEG bytes) fetched from a camera. */
export interface PreviewFrame { data: Uint8Array; contentType: string; }

/** A camera's slot in a 2×2 capture grid. 0=TL 1=TR 2=BL 3=BR (reading order). */
export type Quadrant = 0 | 1 | 2 | 3;

/** Per-camera video source for the live-view panel (decoupled from control). */
export interface VideoSource {
  type: 'none' | 'protocol' | 'capture' | 'quad';
  /** For 'capture' and 'quad': the UVC capture device id (MediaDeviceInfo.deviceId). */
  deviceId?: string;
  /**
   * Stable device identity (MediaDeviceInfo.label, e.g. "Blackmagic Web Presenter 4K (1edb:be8b)").
   * The deviceId is NOT stable — a capture device re-enumerated after a cable/link change gets a
   * new id. The renderer matches a saved source to the live device by deviceId first, then falls
   * back to this label, so the feed reconnects without a manual re-select.
   */
  deviceLabel?: string;
  quadrant?: Quadrant; // 0=TL 1=TR 2=BL 3=BR; only for type:'quad'
}

/**
 * Per-camera UI customization, persisted in the profile but **opaque to core** — the manager
 * only stores and echoes it; nothing in core interprets it. The renderer owns its meaning
 * (which controls to show, the live-view view-assist LUT).
 */
export interface CameraUiSettings {
  /** Control/section ids hidden in the camera panel. Unset = renderer defaults (driver-derived). */
  hiddenControls?: string[];
  /** Live-view view-assist (log → 709) settings. */
  viewAssist?: {
    enabled: boolean;
    /** Built-in look id (e.g. 'clog2_709') or 'cube' for an imported 3D LUT. */
    look: string;
    /** Blend strength 0..1 (0 = original frame, 1 = fully graded). */
    intensity: number;
    /** Imported .cube reference (display name + stored filename under userData/luts). */
    cube?: { name: string; file: string };
  };
}

export interface CameraProfile {
  id: string;
  name: string;
  driver: 'xc' | 'r5c' | 'ccapi';
  host: string;
  auth?: CameraAuth;
  presets?: CameraPreset[];
  focusPoints?: FocusPoint[];
  video?: VideoSource;
  ui?: CameraUiSettings;
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
