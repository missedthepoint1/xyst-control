import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { CameraManager } from '@xyst/core';
import { resolveConfigPath } from './config-path.js';
import { registerIpc } from './ipc.js';

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
  const mgr = new CameraManager(resolveConfigPath());
  await mgr.load();
  registerIpc(mgr, () => win);
  await createWindow();
  await mgr.connectAll().catch(() => {});
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
