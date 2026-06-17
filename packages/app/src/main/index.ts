import { app, BrowserWindow, Menu, ipcMain, screen, session } from 'electron';
import { join } from 'node:path';
import { CameraManager, createApiServer } from '@xyst/core';
import { resolveConfigPath } from './config-path.js';
import { registerIpc } from './ipc.js';
import { resolveApiPort } from './api-port.js';
import { resolveApiToken } from './api-token.js';
import { setupAutoUpdater, skipUpdateVersion, installDownloadedUpdate } from './updater.js';

// Name the app so the macOS menu bar reads "XYST CONTROL" instead of "Electron"
// (in dev the binary is Electron; setName + the appMenu role override it).
app.setName('XYST CONTROL');

// Never let a stray async throw take down the app mid-show — log and keep running. Local only;
// no remote crash upload (the app sends nothing off-machine).
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));

/** True when a URL is the app's own renderer (file:// in prod, or the dev server in dev). */
function isFirstParty(url: string): boolean {
  if (url.startsWith('file://')) return true;
  const dev = process.env.ELECTRON_RENDERER_URL;
  return !!dev && url.startsWith(dev);
}

let win: BrowserWindow | null = null;
let popout: BrowserWindow | null = null;

/**
 * Open (or focus) the multiview popout — a normal resizable window (the user can maximize or
 * green-button it to fullscreen). Opens centered on the same display as the control window and
 * loads the renderer with `?popout=multiview`. State + preview flow over the existing IPC
 * broadcast / REST API.
 */
function openMultiviewPopout(): void {
  if (popout && !popout.isDestroyed()) { popout.focus(); return; }
  const display = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
  const w = 1280, h = 720 + 28; // +title bar so the 16:9 content area is 1280x720
  const x = display.bounds.x + Math.round((display.bounds.width - w) / 2);
  const y = display.bounds.y + Math.round((display.bounds.height - h) / 2);
  popout = new BrowserWindow({
    x, y, width: w, height: h, minWidth: 480, minHeight: 270,
    backgroundColor: '#000000', show: false, title: 'XYST CONTROL — Multiview',
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.js') },
  });
  // Lock to 16:9, excluding the ~28pt title bar so the CONTENT area is a true 16:9.
  popout.setAspectRatio(16 / 9, { width: 0, height: 28 });
  popout.once('ready-to-show', () => { popout?.show(); popout?.focus(); });
  popout.on('closed', () => { popout = null; });
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
  // Grant camera/mic only to first-party content (SDI/HDMI capture-card live view). Any other
  // origin (should never happen — we never navigate away) is denied.
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) =>
    cb(permission === 'media' && isFirstParty(wc.getURL())));

  // Lock the shell down: deny all window.open, block navigation away from first-party content.
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (details) => { if (!isFirstParty(details.url)) details.preventDefault(); });
    contents.on('will-redirect', (details) => { if (!isFirstParty(details.url)) details.preventDefault(); });
  });

  // Content-Security-Policy on the renderer. Packaged-only: a strict CSP would break the Vite dev
  // server's inline HMR client + websocket. img/connect allow the loopback API (preview + SSE).
  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      cb({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; " +
            "img-src 'self' http://127.0.0.1:* http://localhost:* data: blob:; " +
            "media-src 'self' blob:; " +
            "connect-src 'self' http://127.0.0.1:* http://localhost:*; " +
            "script-src 'self'; style-src 'self' 'unsafe-inline'",
          ],
        },
      });
    });
  }
  const mgr = new CameraManager(resolveConfigPath());
  await mgr.load();
  registerIpc(mgr, () => win);
  const apiToken = resolveApiToken();
  const api = createApiServer(mgr, { token: apiToken });
  // The REST API hosts the live-view preview (preview.jpg) and SSE, so the renderer needs a
  // port that actually bound. A port conflict (a stuck prior instance, another app) must never
  // crash us AND must not silently kill live view — so bind the next free port and tell the
  // renderer the real one. Control runs over IPC regardless.
  const apiPort = await listenWithFallback(api, resolveApiPort(), '127.0.0.1');
  const apiBase = apiPort ? `http://127.0.0.1:${apiPort}` : '';
  ipcMain.handle('app:apiBase', () => apiBase);
  ipcMain.handle('app:apiToken', () => apiToken);
  ipcMain.handle('window:openMultiview', () => openMultiviewPopout());
  installMenu();
  setupAutoUpdater();
  ipcMain.handle('update:install', () => installDownloadedUpdate());
  ipcMain.handle('update:skip', (_e, version: string) => skipUpdateVersion(version));
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
