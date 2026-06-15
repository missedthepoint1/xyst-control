import { app, BrowserWindow, Menu, ipcMain, screen, session } from 'electron';
import { join } from 'node:path';
import { CameraManager, createApiServer } from '@xyst/core';
import { resolveConfigPath } from './config-path.js';
import { registerIpc } from './ipc.js';
import { resolveApiPort } from './api-port.js';

// Name the app so the macOS menu bar reads "XYST CONTROL" instead of "Electron"
// (in dev the binary is Electron; setName + the appMenu role override it).
app.setName('XYST CONTROL');

let win: BrowserWindow | null = null;
let popout: BrowserWindow | null = null;

/**
 * Open (or focus) the borderless fullscreen multiview popout on the same display as the control
 * window. It loads the same renderer with `?popout=multiview`, which renders a chrome-less
 * multiview. ESC closes it. State + preview flow over the existing IPC broadcast / REST API.
 */
function openMultiviewPopout(): void {
  if (popout && !popout.isDestroyed()) { popout.focus(); return; }
  const display = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
  const { x, y, width, height } = display.bounds;
  popout = new BrowserWindow({
    x, y, width, height, frame: false, backgroundColor: '#000000', show: false,
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.js') },
  });
  popout.once('ready-to-show', () => {
    popout?.setSimpleFullScreen(true);
    app.dock?.hide(); // simpleFullScreen doesn't cover the dock — hide it for a true fullscreen
    popout?.show();
    popout?.focus(); // be the active window so the menu bar stays hidden
  });
  popout.on('closed', () => { popout = null; app.dock?.show(); });
  popout.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') popout?.close();
  });
  const base = process.env.ELECTRON_RENDERER_URL;
  if (base) void popout.loadURL(`${base}?popout=multiview`);
  else void popout.loadFile(join(import.meta.dirname, '../renderer/index.html'), { query: { popout: 'multiview' } });
}

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

/**
 * Listen on `startPort`, falling forward to the next ports if they're in use (a stuck prior
 * instance, another app). Resolves with the bound port, or undefined if none of the attempts
 * could bind (in which case the app still runs; only live view/REST is unavailable).
 */
function listenWithFallback(
  server: import('node:http').Server, startPort: number, host: string, attempts = 10,
): Promise<number | undefined> {
  return new Promise((resolve) => {
    let port = startPort;
    let tried = 0;
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && tried < attempts) {
        console.warn(`XYST API port ${port} in use — trying ${port + 1}`);
        tried++; port++; setTimeout(attempt, 0);
      } else {
        console.error('XYST API server error:', err);
        resolve(undefined);
      }
    };
    const attempt = () => {
      server.once('error', onError);
      server.listen(port, host, () => {
        server.off('error', onError);
        server.on('error', (e: NodeJS.ErrnoException) => console.error('XYST API server error:', e));
        console.log(`XYST API on http://${host}:${port}`);
        resolve(port);
      });
    };
    attempt();
  });
}

async function main(): Promise<void> {
  // Grant camera/mic so SDI/HDMI capture-card video works (local trusted app).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
  const mgr = new CameraManager(resolveConfigPath());
  await mgr.load();
  registerIpc(mgr, () => win);
  const api = createApiServer(mgr);
  // The REST API hosts the live-view preview (preview.jpg) and SSE, so the renderer needs a
  // port that actually bound. A port conflict (a stuck prior instance, another app) must never
  // crash us AND must not silently kill live view — so bind the next free port and tell the
  // renderer the real one. Control runs over IPC regardless.
  const apiPort = await listenWithFallback(api, resolveApiPort(), '127.0.0.1');
  const apiBase = apiPort ? `http://127.0.0.1:${apiPort}` : '';
  ipcMain.handle('app:apiBase', () => apiBase);
  ipcMain.handle('window:openMultiview', () => openMultiviewPopout());
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
