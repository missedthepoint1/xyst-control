import { app, BrowserWindow, ipcMain, session } from 'electron';
import { join } from 'node:path';
import { CameraManager, createApiServer } from '@xyst/core';
import { resolveConfigPath } from './config-path.js';
import { registerIpc } from './ipc.js';
import { resolveApiPort } from './api-port.js';

let win: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  win = new BrowserWindow({
    width: 1100, height: 760, backgroundColor: '#0b0d10',
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.js') },
  });
  if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
}

app.whenReady().then(async () => {
  // Grant camera/mic so capture-card video and audio-meter input work (local trusted app).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
  const mgr = new CameraManager(resolveConfigPath());
  await mgr.load();
  registerIpc(mgr, () => win);
  const apiPort = resolveApiPort();
  const api = createApiServer(mgr);
  api.listen(apiPort, '127.0.0.1', () => console.log(`XYST API on http://127.0.0.1:${apiPort}`));
  ipcMain.handle('app:apiBase', () => `http://127.0.0.1:${apiPort}`);
  await createWindow();
  await mgr.connectAll().catch(() => {});
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
