import type { CameraState, ControlState } from '@xyst/core';

type Controls = CameraState['controls'];
const has = (x?: ControlState) => !!x?.available;

/** Toggleable panel sections, in display order. `avail` gates a row to bodies that have it. */
export interface ToggleItem { id: string; label: string; avail: (c: Controls) => boolean }

export const TOGGLEABLE: ToggleItem[] = [
  { id: 'iso', label: 'ISO / Gain', avail: (c) => has(c.iso) || has(c.gain) },
  { id: 'isoAuto', label: 'ISO mode', avail: (c) => has(c.isoAuto) },
  { id: 'shutter', label: 'Shutter', avail: (c) => has(c.shutter) },
  { id: 'iris', label: 'Iris', avail: (c) => has(c.iris) },
  { id: 'wb', label: 'White balance', avail: (c) => has(c.wb) },
  { id: 'wbCC', label: 'WB CC', avail: (c) => has(c.wbCC) },
  { id: 'nd', label: 'ND filter', avail: (c) => has(c.nd) },
  { id: 'ndExtended', label: 'ND advanced', avail: (c) => has(c.ndExtended) },
  { id: 'focus', label: 'Focus AF / MF', avail: (c) => has(c.focus) },
  { id: 'faceDetect', label: 'Face detect', avail: (c) => has(c.faceDetect) },
  { id: 'colorbar', label: 'Color bars', avail: (c) => has(c.colorbar) },
  { id: 'focusAction', label: 'Focus actions', avail: (c) => has(c.focusAction) },
  { id: 'advanced', label: 'Advanced (AF / WB set)', avail: (c) =>
      has(c.afMode) || has(c.afSpeed) || has(c.afResponse) || has(c.afLock) || has(c.awbHold) || has(c.wbAction) },
  // Presets are created in the gear settings and recalled from chips on the panel — no toggle needed.
  { id: 'focusPoints', label: 'Focus points', avail: () => true },
];

// Hidden out of the box for every camera until the user customizes visibility. Focus points are an
// occasional/advanced feature, so the focus save-point bar is off by default to keep the panel
// clean; the user can re-show it from the per-camera Settings ("Focus points").
const DEFAULT_HIDDEN_ALL: string[] = ['focusPoints'];

// Driver-derived defaults, merged on top of the all-cameras defaults. The R6 III (CCAPI) exposes a
// shutter setting that isn't a meaningful control in its movie use, so it's hidden out of the box;
// the user can re-show it from the per-camera Settings.
const DEFAULT_HIDDEN: Record<string, string[]> = { ccapi: ['shutter'] };

/** The effective hidden-control set: the user's explicit choice, else the built-in defaults. */
export function effectiveHidden(state: CameraState): Set<string> {
  if (state.ui?.hiddenControls) return new Set(state.ui.hiddenControls);
  return new Set([...DEFAULT_HIDDEN_ALL, ...(DEFAULT_HIDDEN[state.driver ?? ''] ?? [])]);
}
