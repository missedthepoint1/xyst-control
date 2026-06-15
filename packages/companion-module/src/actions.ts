import type { CompanionActionDefinitions, CompanionInputFieldDropdown } from '@companion-module/base';
import type { ControlId } from '@xyst/core';
import type { XystApiClient } from './api.js';
import type { CameraStore } from './state.js';

/** All controls, for the generic "set control" escape hatch. */
const ALL_CONTROLS: ControlId[] = [
  'iso', 'gain', 'shutter', 'shutterMode', 'shutterAngle', 'iris', 'wb', 'wbKelvin', 'nd',
  'focus', 'faceDetect', 'colorbar', 'isoAuto', 'ndExtended', 'wbCC', 'awbHold', 'wbAction',
  'afMode', 'afSpeed', 'afResponse', 'afLock', 'focusAction', 'osdOutput',
];
/** Controls that make sense to nudge up/down from a button. */
const STEP_CONTROLS: ControlId[] = ['iso', 'gain', 'shutter', 'shutterAngle', 'iris', 'wbKelvin', 'nd', 'wbCC', 'afSpeed', 'afResponse'];

export function buildActions(store: CameraStore, api: XystApiClient): CompanionActionDefinitions {
  const cameraOpt = (): CompanionInputFieldDropdown => ({
    type: 'dropdown', id: 'camera', label: 'Camera',
    default: store.cameraChoices()[0]?.id ?? '', choices: store.cameraChoices(),
  });
  const enumOpt = (id: string, label: string, choices: { id: string; label: string }[]): CompanionInputFieldDropdown =>
    ({ type: 'dropdown', id, label, default: choices[0]?.id ?? '', choices });
  const cam = (o: Record<string, unknown>) => String(o.camera ?? '');
  const enumAction = (name: string, control: ControlId, choices: { id: string; label: string }[]) => ({
    name, options: [cameraOpt(), enumOpt('value', name, choices)],
    callback: async (e: { options: Record<string, unknown> }) => { await api.setControl(cam(e.options), control, String(e.options.value)); },
  });

  return {
    // ---- record ----
    record_start: { name: 'Record: start', options: [cameraOpt()], callback: async (e) => { await api.recordStart(cam(e.options)); } },
    record_stop: { name: 'Record: stop', options: [cameraOpt()], callback: async (e) => { await api.recordStop(cam(e.options)); } },
    record_toggle: {
      name: 'Record: toggle', options: [cameraOpt()],
      callback: async (e) => { const id = cam(e.options); await (store.isRecording(id) ? api.recordStop(id) : api.recordStart(id)); },
    },
    record_all_start: { name: 'Record ALL: start', options: [], callback: async () => { await api.recordAll(true); } },
    record_all_stop: { name: 'Record ALL: stop', options: [], callback: async () => { await api.recordAll(false); } },

    // ---- multiview OSD (overlay on all popout feeds) ----
    osd_show: { name: 'OSD: show on all feeds', options: [], callback: async () => { await api.setOsd(true); } },
    osd_hide: { name: 'OSD: hide on all feeds', options: [], callback: async () => { await api.setOsd(false); } },
    osd_toggle: { name: 'OSD: toggle on all feeds', options: [], callback: async () => { await api.toggleOsd(); } },

    // ---- exposure / value controls ----
    set_control: {
      name: 'Set control (any, by value)',
      options: [
        cameraOpt(),
        { type: 'dropdown', id: 'control', label: 'Control', default: 'iso', choices: ALL_CONTROLS.map((c) => ({ id: c, label: c })) },
        { type: 'textinput', id: 'value', label: 'Value', default: '', useVariables: true },
      ],
      callback: async (e, ctx) => {
        const raw = await ctx.parseVariablesInString(String(e.options.value ?? ''));
        const n = Number(raw);
        await api.setControl(cam(e.options), e.options.control as ControlId, raw !== '' && Number.isFinite(n) ? n : raw);
      },
    },
    step_control: {
      name: 'Step control up/down (ISO, shutter, iris, ND…)',
      options: [
        cameraOpt(),
        { type: 'dropdown', id: 'control', label: 'Control', default: 'iso', choices: STEP_CONTROLS.map((c) => ({ id: c, label: c })) },
        { type: 'dropdown', id: 'dir', label: 'Direction', default: '1', choices: [{ id: '1', label: 'Up / next' }, { id: '-1', label: 'Down / previous' }] },
      ],
      callback: async (e) => { await api.stepControl(cam(e.options), e.options.control as ControlId, e.options.dir === '-1' ? -1 : 1); },
    },

    // ---- mode toggles (friendly enums) ----
    focus_mode: enumAction('Focus: AF / MF', 'focus', [{ id: 'auto', label: 'AF (auto)' }, { id: 'manual', label: 'MF (manual)' }]),
    face_detect: enumAction('Face detection', 'faceDetect', [{ id: 'off', label: 'Off' }, { id: 'faceonly', label: 'Face only' }, { id: 'facecatch', label: 'Face + tracking' }]),
    shutter_mode: enumAction('Shutter mode', 'shutterMode', [{ id: 'speed', label: 'Speed' }, { id: 'angle', label: 'Angle' }, { id: 'slow', label: 'Slow' }, { id: 'clearscan', label: 'Clear Scan' }]),
    color_bars: enumAction('Color bars', 'colorbar', [{ id: 'off', label: 'Off' }, { id: 'on', label: 'On' }]),
    awb_hold: enumAction('AWB hold', 'awbHold', [{ id: 'off', label: 'Off' }, { id: 'on', label: 'On' }]),
    focus_action: enumAction('Focus action (MF drive / one-shot AF)', 'focusAction', [
      { id: 'one_shot', label: 'One-shot AF' }, { id: 'near', label: 'Drive near' }, { id: 'far', label: 'Drive far' }, { id: 'stop', label: 'Stop' }]),
    wb_set: enumAction('White balance: set A/B (one-shot)', 'wbAction', [{ id: 'one_shot_a', label: 'Set WB A' }, { id: 'one_shot_b', label: 'Set WB B' }]),
    camera_osd: {
      name: 'Camera OSD output (SDI/HDMI burn-in)',
      options: [cameraOpt(), enumOpt('value', 'OSD', [{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }])],
      callback: async (e) => {
        const id = cam(e.options);
        const on = (store.controlList(id, 'osdOutput').find((v) => v !== 'off') as string) ?? 'displevel1_2_3';
        await api.setControl(id, 'osdOutput', e.options.value === 'on' ? on : 'off');
      },
    },

    // ---- presets ----
    recall_preset: {
      name: 'Recall preset',
      options: [{ type: 'dropdown', id: 'presetId', label: 'Preset', default: store.allPresetChoices()[0]?.id ?? '', choices: store.allPresetChoices() }],
      callback: async (e) => { await api.recallPreset(String(e.options.presetId ?? '')); },
    },
    recall_preset_by_id: {
      name: 'Recall preset (by id / variable)',
      options: [{ type: 'textinput', id: 'presetId', label: 'Preset ID', default: '', useVariables: true }],
      callback: async (e, ctx) => { await api.recallPreset(await ctx.parseVariablesInString(String(e.options.presetId ?? ''))); },
    },
    save_preset: {
      name: 'Save preset (snapshot current look)',
      options: [cameraOpt(), { type: 'textinput', id: 'name', label: 'Preset name', default: '', useVariables: true }],
      callback: async (e, ctx) => { await api.savePreset(cam(e.options), await ctx.parseVariablesInString(String(e.options.name ?? '')) || 'Preset'); },
    },

    // ---- focus points ----
    recall_focus_point: {
      name: 'Recall focus point (rack focus)',
      options: [{ type: 'dropdown', id: 'pointId', label: 'Focus point', default: store.allFocusPointChoices()[0]?.id ?? '', choices: store.allFocusPointChoices() }],
      callback: async (e) => { await api.recallFocusPointById(String(e.options.pointId ?? '')); },
    },
    touch_focus_xy: {
      name: 'Pull focus to point (normalized 0..1)',
      options: [
        cameraOpt(),
        { type: 'number', id: 'x', label: 'X (0..1)', default: 0.5, min: 0, max: 1, step: 0.01 },
        { type: 'number', id: 'y', label: 'Y (0..1)', default: 0.5, min: 0, max: 1, step: 0.01 },
      ],
      callback: async (e) => { await api.setFocus(cam(e.options), Number(e.options.x), Number(e.options.y)); },
    },
  };
}
