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

  const push = (id: string, state: unknown) =>
    getWindow()?.webContents.send('camera:state', id, state);
  mgr.on('state', push);
  mgr.on('status', (id) => push(id, mgr.getState(id)));
}
