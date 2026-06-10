import { combineRgb, type CompanionFeedbackDefinitions } from '@companion-module/base';
import type { CameraStore } from './state.js';

export function buildFeedbacks(store: CameraStore): CompanionFeedbackDefinitions {
  return {
    recording: {
      type: 'boolean',
      name: 'Camera is recording (tally)',
      defaultStyle: { bgcolor: combineRgb(255, 0, 0), color: combineRgb(255, 255, 255) },
      options: [{
        type: 'dropdown', id: 'camera', label: 'Camera',
        default: store.cameraChoices()[0]?.id ?? '', choices: store.cameraChoices(),
      }],
      callback: (fb) => store.isRecording(String(fb.options.camera ?? '')),
    },
  };
}
