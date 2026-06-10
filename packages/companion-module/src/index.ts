import { InstanceBase, InstanceStatus, runEntrypoint } from '@companion-module/base';
import type { CameraState } from '@xyst/core';
import { type XystConfig, getConfigFields, baseUrl } from './config.js';
import { XystApiClient } from './api.js';
import { CameraStore } from './state.js';
import { subscribeEvents, type SseHandle } from './sse.js';
import { buildActions } from './actions.js';
import { buildFeedbacks } from './feedbacks.js';

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
      this.store.setCameras(await this.api.getCameras());
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
      const payload = JSON.parse(data) as { cameraId?: string; state?: CameraState };
      if (event === 'state' && payload.cameraId && payload.state) {
        this.store.applyState(payload.cameraId, payload.state);
        this.updateStatus(InstanceStatus.Ok);
        this.pushVariableValues();
        this.checkFeedbacks('recording');
      } else if (event === 'status') {
        this.updateStatus(InstanceStatus.Ok);
      }
    } catch { /* ignore malformed */ }
  }

  private refreshDefinitions(): void {
    this.setActionDefinitions(buildActions(this.store, this.api));
    this.setFeedbackDefinitions(buildFeedbacks(this.store));
    this.setVariableDefinitions(this.store.variableDefinitions());
  }

  private pushVariableValues(): void {
    this.setVariableValues(this.store.variableValues());
  }
}

runEntrypoint(ModuleInstance, []);
