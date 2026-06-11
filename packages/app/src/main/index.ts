import { app, BrowserWindow, Menu, ipcMain, session } from 'electron';
import { join } from 'node:path';
import { CameraManager, createApiServer } from '@xyst/core';
import { resolveConfigPath } from './config-path.js';
import { registerIpc } from './ipc.js';
import { resolveApiPort } from './api-port.js';

// Name the app so the macOS menu bar reads "XYST CONTROL" instead of "Electron"
// (in dev the binary is Electron; setName + the appMenu role override it).
app.setName('XYST CONTROL');

let win: BrowserWindow | null = null;

function installMenu(): void {
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]));
}

async function createWindow(): Promise<void> {
  win = new BrowserWindow({
    width: 1100, height: 760, backgroundColor: '#0b0d10',
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.js') },
  });
  if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
}

async function main(): Promise<void> {
  // Grant camera/mic so SDI/HDMI capture-card video works (local trusted app).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
  const mgr = new CameraManager(resolveConfigPath());
  await mgr.load();
  registerIpc(mgr, () => win);
  const apiPort = resolveApiPort();
  const api = createApiServer(mgr);
  // A port conflict (e.g. another instance) must never crash the app — the REST API is
  // optional; all control runs over IPC. Fail soft with a warning instead.
  api.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') console.warn(`XYST API port ${apiPort} already in use — REST API not started (control still works).`);
    else console.error('XYST API server error:', err);
  });
  api.listen(apiPort, '127.0.0.1', () => console.log(`XYST API on http://127.0.0.1:${apiPort}`));
  ipcMain.handle('app:apiBase', () => `http://127.0.0.1:${apiPort}`);
  installMenu();
  // In dev the dock shows Electron's icon (packaged apps use the .icns automatically) —
  // set it from the build PNG so the dev runtime also shows the XYST lens.
  if (process.platform === 'darwin' && process.env.ELECTRON_RENDERER_URL) {
    app.dock?.setIcon(join(import.meta.dirname, '../../build/icon.png'));
  }
  await createWindow();
  await mgr.connectAll().catch(() => {});
}

// One running instance owns the cameras + the API port (the app is the single source of
// truth). A second launch focuses the existing window instead of crashing on the port.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(main);
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
