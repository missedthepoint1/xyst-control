import { combineRgb, type CompanionFeedbackDefinitions, type CompanionInputFieldDropdown } from '@companion-module/base';
import type { ControlId } from '@xyst/core';
import type { CameraStore } from './state.js';

export function buildFeedbacks(store: CameraStore): CompanionFeedbackDefinitions {
  const cameraOpt = (): CompanionInputFieldDropdown => ({
    type: 'dropdown', id: 'camera', label: 'Camera',
    default: store.cameraChoices()[0]?.id ?? '', choices: store.cameraChoices(),
  });

  return {
    recording: {
      type: 'boolean',
      name: 'Camera is recording (tally)',
      defaultStyle: { bgcolor: combineRgb(255, 0, 0), color: combineRgb(255, 255, 255) },
      options: [cameraOpt()],
      callback: (fb) => store.isRecording(String(fb.options.camera ?? '')),
    },
    recording_any: {
      type: 'boolean',
      name: 'Any camera is recording',
      defaultStyle: { bgcolor: combineRgb(255, 0, 0), color: combineRgb(255, 255, 255) },
      options: [],
      callback: () => store.anyRecording(),
    },
    osd_active: {
      type: 'boolean',
      name: 'OSD shown on multiview',
      defaultStyle: { bgcolor: combineRgb(99, 78, 255), color: combineRgb(255, 255, 255) },
      options: [],
      callback: () => store.osd(),
    },
    connected: {
      type: 'boolean',
      name: 'Camera is connected',
      defaultStyle: { bgcolor: combineRgb(0, 120, 60), color: combineRgb(255, 255, 255) },
      options: [cameraOpt()],
      callback: (fb) => store.isConnected(String(fb.options.camera ?? '')),
    },
    control_equals: {
      type: 'boolean',
      name: 'Control equals value (highlight active mode)',
      defaultStyle: { bgcolor: combineRgb(99, 78, 255), color: combineRgb(255, 255, 255) },
      options: [
        cameraOpt(),
        { type: 'textinput', id: 'control', label: 'Control id (e.g. focus, faceDetect, iso)', default: 'focus' },
        { type: 'textinput', id: 'value', label: 'Equals value (e.g. manual, faceonly, 800)', default: 'manual' },
      ],
      callback: (fb) => store.controlValue(String(fb.options.camera ?? ''), String(fb.options.control ?? '') as ControlId) === String(fb.options.value ?? ''),
    },
  };
}
