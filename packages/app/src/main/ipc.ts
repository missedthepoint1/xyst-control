import { ipcMain, BrowserWindow } from 'electron';
import type { CameraManager } from '@xyst/core';
import type { ControlId, CameraUiSettings } from '@xyst/core';
import { importLut, readLut } from './lut.js';

export function registerIpc(mgr: CameraManager, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('camera:list', () => mgr.listProfiles());
  ipcMain.handle('camera:states', () => mgr.getAllStates());
  ipcMain.handle('camera:connect', (_e, id: string) => mgr.connect(id));
  ipcMain.handle('camera:record', (_e, id: string, start: boolean) =>
    start ? mgr.startRecording(id) : mgr.stopRecording(id));
  ipcMain.handle('camera:recordAll', (_e, start: boolean) => mgr.recordAll(start));
  ipcMain.handle('camera:setControl', (_e, id: string, control: ControlId, value: string | number) =>
    mgr.setControl(id, control, value));
  ipcMain.handle('camera:add', (_e, profile) => mgr.addCamera(profile));
  ipcMain.handle('camera:presets', (_e, id: string) => mgr.listPresets(id));
  ipcMain.handle('camera:savePreset', (_e, id: string, name: string) => mgr.savePreset(id, name));
  ipcMain.handle('camera:recallPreset', (_e, id: string, presetId: string) => mgr.recallPreset(id, presetId));
  ipcMain.handle('camera:deletePreset', (_e, id: string, presetId: string) => mgr.deletePreset(id, presetId));
  ipcMain.handle('camera:remove', (_e, id: string) => mgr.removeCamera(id));
  ipcMain.handle('camera:rename', (_e, id: string, name: string) => mgr.renameCamera(id, name));
  ipcMain.handle('camera:reorder', (_e, ids: string[]) => mgr.reorderCameras(ids));
  ipcMain.handle('camera:setVideoSource', (_e, id: string, video: unknown) => mgr.setVideoSource(id, video as never));
  ipcMain.handle('camera:setUiSettings', (_e, id: string, ui: CameraUiSettings) => mgr.setUiSettings(id, ui));
  ipcMain.handle('lut:import', () => importLut(getWindow()));
  ipcMain.handle('lut:read', (_e, file: string) => readLut(file));
  ipcMain.handle('camera:setFocusPoint', (_e, id: string, x: number, y: number) => mgr.setFocusPoint(id, x, y));
  ipcMain.handle('camera:focusPoints', (_e, id: string) => mgr.listFocusPoints(id));
  ipcMain.handle('camera:saveFocusPoint', (_e, id: string, name: string, x: number, y: number) => mgr.saveFocusPoint(id, name, x, y));
  ipcMain.handle('camera:recallFocusPoint', (_e, id: string, pointId: string) => mgr.recallFocusPoint(id, pointId));
  ipcMain.handle('camera:deleteFocusPoint', (_e, id: string, pointId: string) => mgr.deleteFocusPoint(id, pointId));

  // Broadcast to every window (main + the fullscreen multiview popout) so both stay live.
  const broadcast = (channel: string, ...args: unknown[]) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, ...args);
  };
  const push = (id: string, state: unknown) => broadcast('camera:state', id, state);
  mgr.on('state', push);
  mgr.on('status', (id) => { const s = mgr.getState(id); if (s) push(id, s); });
  mgr.on('presets', (id: string, presets: unknown) => broadcast('camera:presets', id, presets));
  mgr.on('focusPoints', (id: string, pts: unknown) => broadcast('camera:focusPoints', id, pts));
  mgr.on('removed', (id: string) => broadcast('camera:removed', id));
}
