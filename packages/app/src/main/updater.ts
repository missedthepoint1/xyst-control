import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { autoUpdater } from 'electron-updater';
import { createUpdateStore } from './update-store.js';
import { shouldNotify, type UpdateStatus } from './updateState.js';

const SIX_HOURS = 6 * 60 * 60 * 1000;

/**
 * Live-production-safe auto-update: check on launch + every 6h, download in the background, and
 * surface a "downloaded" status to the renderer. NOTHING installs until the operator explicitly
 * chooses "Install & Restart" (autoInstallOnAppQuit = false). Disabled in dev (not packaged).
 */
export function setupAutoUpdater(): void {
  if (!app.isPackaged) return;

  const store = createUpdateStore(join(app.getPath('userData'), 'update.json'));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  const broadcast = (status: UpdateStatus) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update:status', status);
  };

  autoUpdater.on('checking-for-update', () => broadcast({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => {
    if (!shouldNotify(info.version, store.getSkipped())) return; // operator skipped this version
    broadcast({ state: 'available', version: info.version });
  });
  autoUpdater.on('update-not-available', () => broadcast({ state: 'idle' }));
  autoUpdater.on('download-progress', (p) => broadcast({ state: 'downloading', version: autoUpdater.currentVersion.raw, percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => {
    if (!shouldNotify(info.version, store.getSkipped())) return;
    broadcast({ state: 'downloaded', version: info.version });
  });
  autoUpdater.on('error', (error) => broadcast({ state: 'error', message: error?.message ?? String(error) }));

  const check = () => { void autoUpdater.checkForUpdates().catch(() => { /* offline: silent no-op */ }); };
  check();
  setInterval(check, SIX_HOURS);
}

/** Persist a skip so this version never notifies again. */
export function skipUpdateVersion(version: string): void {
  createUpdateStore(join(app.getPath('userData'), 'update.json')).setSkipped(version);
}

/** Quit and install the downloaded update (operator-triggered "Install & Restart"). */
export function installDownloadedUpdate(): void {
  autoUpdater.quitAndInstall();
}
