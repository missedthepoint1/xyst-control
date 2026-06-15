import { combineRgb, type CompanionPresetDefinitions } from '@companion-module/base';

/** Ready-made Stream Deck buttons: Record ALL, Stop ALL, and the multiview OSD toggle. */
export function buildPresets(): CompanionPresetDefinitions {
  const base = { color: combineRgb(255, 255, 255), bgcolor: combineRgb(30, 30, 36), size: 'auto' as const };
  return {
    rec_all: {
      type: 'button',
      category: 'Multiview',
      name: 'Record ALL',
      style: { text: 'REC\nALL', ...base },
      steps: [{ down: [{ actionId: 'record_all_start', options: {} }], up: [] }],
      feedbacks: [{ feedbackId: 'recording_any', options: {}, style: { bgcolor: combineRgb(200, 0, 0) } }],
    },
    stop_all: {
      type: 'button',
      category: 'Multiview',
      name: 'Stop ALL',
      style: { text: 'STOP\nALL', ...base },
      steps: [{ down: [{ actionId: 'record_all_stop', options: {} }], up: [] }],
      feedbacks: [],
    },
    osd_toggle: {
      type: 'button',
      category: 'Multiview',
      name: 'OSD toggle',
      style: { text: 'OSD', ...base },
      steps: [{ down: [{ actionId: 'osd_toggle', options: {} }], up: [] }],
      feedbacks: [{ feedbackId: 'osd_active', options: {}, style: { bgcolor: combineRgb(99, 78, 255) } }],
    },
  };
}
