import { InstanceBase, InstanceStatus, runEntrypoint } from '@companion-module/base';
import type { CameraPreset, CameraState, FocusPoint } from '@xyst/core';
import { type XystConfig, getConfigFields, baseUrl } from './config.js';
import { XystApiClient } from './api.js';
import { CameraStore } from './state.js';
import { subscribeEvents, type SseHandle } from './sse.js';
import { buildActions } from './actions.js';
import { buildFeedbacks } from './feedbacks.js';
import { buildPresets } from './presets.js';

const FEEDBACK_IDS = ['recording', 'recording_any', 'osd_active', 'connected', 'control_equals'] as const;

class ModuleInstance extends InstanceBase<XystConfig> {
  private store = new CameraStore();
  private api!: XystApiClient;
  private sse?: SseHandle;
  private cfg!: XystConfig;

  async init(config: XystConfig, _isFirstInit: boolean): Promise<void> {
    this.cfg = config;
    await this.start();
  }

  async configUpdated(config: XystConfig): Promise<void> {
    this.cfg = config;
    this.sse?.close();
    await this.start();
  }

  async destroy(): Promise<void> { this.sse?.close(); }

  getConfigFields() { return getConfigFields(); }

  private async start(): Promise<void> {
    this.updateStatus(InstanceStatus.Connecting);
    this.api = new XystApiClient(baseUrl(this.cfg));
    try {
      const cameras = await this.api.getCameras();
      this.store.setCameras(cameras);
      // Presets aren't part of camera state — fetch them so the recall dropdown is populated.
      await Promise.all(cameras.map(async (c) => {
        try { this.store.setPresets(c.id, await this.api.listPresets(c.id)); } catch { /* best-effort */ }
      }));
      this.updateStatus(InstanceStatus.Ok);
    } catch {
      this.updateStatus(InstanceStatus.ConnectionFailure, 'Cannot reach the XYST app API');
    }
    this.refreshDefinitions();
    this.pushVariableValues();
    this.sse = subscribeEvents(`${baseUrl(this.cfg)}/api/events`,
      (event, data) => this.onEvent(event, data),
      () => this.updateStatus(InstanceStatus.ConnectionFailure));
  }

  private onEvent(event: string, data: string): void {
    try {
      const p = JSON.parse(data) as {
        cameraId?: string; state?: CameraState; presets?: CameraPreset[]; focusPoints?: FocusPoint[]; osd?: boolean;
      };
      if (event === 'state' && p.cameraId && p.state) {
        this.store.applyState(p.cameraId, p.state);
        this.updateStatus(InstanceStatus.Ok);
        this.pushVariableValues();
        this.checkFeedbacks(...FEEDBACK_IDS);
      } else if (event === 'status') {
        this.updateStatus(InstanceStatus.Ok);
        this.checkFeedbacks('connected');
      } else if (event === 'presets' && p.cameraId && p.presets) {
        this.store.setPresets(p.cameraId, p.presets);
        this.refreshDefinitions(); // preset dropdown choices changed
      } else if (event === 'focusPoints' && p.cameraId && p.focusPoints) {
        this.store.setFocusPoints(p.cameraId, p.focusPoints);
        this.refreshDefinitions(); // focus-point dropdown choices changed
      } else if (event === 'osd') {
        this.store.setOsd(!!p.osd);
        this.pushVariableValues();
        this.checkFeedbacks('osd_active');
      }
    } catch { /* ignore malformed */ }
  }

  private refreshDefinitions(): void {
    this.setActionDefinitions(buildActions(this.store, this.api));
    this.setFeedbackDefinitions(buildFeedbacks(this.store));
    this.setPresetDefinitions(buildPresets());
    this.setVariableDefinitions(this.store.variableDefinitions());
  }

  private pushVariableValues(): void {
    this.setVariableValues(this.store.variableValues());
  }
}

runEntrypoint(ModuleInstance, []);
