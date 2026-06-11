import { ipcMain, type BrowserWindow } from 'electron';
import type { CameraManager } from '@xyst/core';
import type { ControlId } from '@xyst/core';

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
  ipcMain.handle('camera:setVideoSource', (_e, id: string, video: unknown) => mgr.setVideoSource(id, video as never));

  const push = (id: string, state: unknown) =>
    getWindow()?.webContents.send('camera:state', id, state);
  mgr.on('state', push);
  mgr.on('status', (id) => push(id, mgr.getState(id)));
  mgr.on('presets', (id: string, presets: unknown) =>
    getWindow()?.webContents.send('camera:presets', id, presets));
  mgr.on('removed', (id: string) => getWindow()?.webContents.send('camera:removed', id));
}
