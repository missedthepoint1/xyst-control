import { app, dialog, type BrowserWindow } from 'electron';
import { mkdir, copyFile, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';

// Imported .cube LUTs are copied into userData so the camera profile can reference them by a
// stable filename (rather than inlining a multi-MB 3D LUT into cameras.json, or depending on the
// user's original file path). The renderer reads them back through `readLut` to apply.
const lutDir = () => join(app.getPath('userData'), 'luts');

/** Prompt for a .cube file and copy it into userData/luts. Returns its display name + stored file. */
export async function importLut(win: BrowserWindow | null): Promise<{ name: string; file: string } | null> {
  const opts = {
    title: 'Choose a .cube LUT',
    filters: [{ name: 'Cube LUT', extensions: ['cube'] }],
    properties: ['openFile' as const],
  };
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  const src = res.filePaths[0];
  if (res.canceled || !src) return null;
  await mkdir(lutDir(), { recursive: true });
  const file = `${randomUUID()}.cube`;
  await copyFile(src, join(lutDir(), file));
  return { name: basename(src), file };
}

/** Read a previously-imported LUT's text by its stored filename (basename-guarded). */
export async function readLut(file: string): Promise<string> {
  return readFile(join(lutDir(), basename(file)), 'utf8');
}
