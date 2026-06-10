import { describe, it, expect } from 'vitest';
import { CameraStore } from '../src/state.js';
import type { CameraState } from '@xyst/core';

const mk = (over: Partial<CameraState> = {}): CameraState => ({
  id: 'cam-1', name: 'C300', status: 'connected', updatedAt: 0,
  model: 'Canon EOS C300 Mark III',
  record: { recording: false },
  controls: {
    iso: { id: 'iso', available: true, value: 800 },
    shutter: { id: 'shutter', available: true, value: 2000 },
    wb: { id: 'wb', available: true, value: 'kelvin' },
    nd: { id: 'nd', available: true, value: 400 },
  },
  ...over,
});

describe('CameraStore', () => {
  it('derives camera choices', () => {
    const s = new CameraStore();
    s.setCameras([mk()]);
    expect(s.cameraChoices()).toEqual([{ id: 'cam-1', label: 'C300' }]);
  });

  it('derives variable definitions and values', () => {
    const s = new CameraStore();
    s.setCameras([mk()]);
    const defs = s.variableDefinitions().map((d) => d.variableId);
    expect(defs).toContain('cam_1_iso');
    expect(defs).toContain('cam_1_recording');
    const vals = s.variableValues();
    expect(vals['cam_1_iso']).toBe(800);
    expect(vals['cam_1_recording']).toBe('off');
    expect(vals['cam_1_wb']).toBe('kelvin');
  });

  it('reports recording feedback per camera', () => {
    const s = new CameraStore();
    s.setCameras([mk({ record: { recording: true } })]);
    expect(s.isRecording('cam-1')).toBe(true);
    s.applyState('cam-1', mk({ record: { recording: false } }));
    expect(s.isRecording('cam-1')).toBe(false);
    expect(s.variableValues()['cam_1_recording']).toBe('off');
  });

  it('isRecording is false for an unknown camera', () => {
    expect(new CameraStore().isRecording('nope')).toBe(false);
  });
});
