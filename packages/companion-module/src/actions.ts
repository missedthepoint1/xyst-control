import type { CompanionActionDefinitions } from '@companion-module/base';
import type { ControlId } from '@xyst/core';
import type { XystApiClient } from './api.js';
import type { CameraStore } from './state.js';

const CONTROLS: ControlId[] = ['iso', 'shutter', 'iris', 'wb', 'wbKelvin', 'nd'];

export function buildActions(store: CameraStore, api: XystApiClient): CompanionActionDefinitions {
  const cameraOpt = () => ({
    type: 'dropdown' as const, id: 'camera', label: 'Camera',
    default: store.cameraChoices()[0]?.id ?? '', choices: store.cameraChoices(),
  });
  const cam = (opts: Record<string, unknown>) => String(opts.camera ?? '');

  return {
    record_start: { name: 'Record: start', options: [cameraOpt()], callback: async (e) => { await api.recordStart(cam(e.options)); } },
    record_stop: { name: 'Record: stop', options: [cameraOpt()], callback: async (e) => { await api.recordStop(cam(e.options)); } },
    record_toggle: {
      name: 'Record: toggle', options: [cameraOpt()],
      callback: async (e) => {
        const id = cam(e.options);
        await (store.isRecording(id) ? api.recordStop(id) : api.recordStart(id));
      },
    },
    record_all_start: { name: 'Record ALL: start', options: [], callback: async () => { await api.recordAll(true); } },
    record_all_stop: { name: 'Record ALL: stop', options: [], callback: async () => { await api.recordAll(false); } },
    set_control: {
      name: 'Set control (ISO/shutter/iris/WB/Kelvin/ND)',
      options: [
        cameraOpt(),
        { type: 'dropdown', id: 'control', label: 'Control', default: 'iso',
          choices: CONTROLS.map((c) => ({ id: c, label: c })) },
        { type: 'textinput', id: 'value', label: 'Value', default: '', useVariables: true },
      ],
      callback: async (e, ctx) => {
        const raw = await ctx.parseVariablesInString(String(e.options.value ?? ''));
        const n = Number(raw);
        const value = raw !== '' && Number.isFinite(n) ? n : raw;
        await api.setControl(cam(e.options), e.options.control as ControlId, value);
      },
    },
    recall_preset: {
      name: 'Recall preset (by id)',
      options: [{ type: 'textinput', id: 'presetId', label: 'Preset ID', default: '', useVariables: true }],
      callback: async (e, ctx) => { await api.recallPreset(await ctx.parseVariablesInString(String(e.options.presetId ?? ''))); },
    },
  };
}
