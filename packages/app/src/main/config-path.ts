import { app } from 'electron';
import { join } from 'node:path';
import { existsSync, writeFileSync } from 'node:fs';

/**
 * cameras.json lives in userData. On first run we seed an EMPTY config rather
 * than copying config/cameras.example.json — otherwise the app would boot with a
 * phantom camera at the example IP and sit there failing to connect. The example
 * file remains in the repo purely as documentation of the profile shape; real
 * cameras are added through the app's "Add camera" UI.
 */
export function resolveConfigPath(): string {
  const dest = join(app.getPath('userData'), 'cameras.json');
  if (!existsSync(dest)) {
    writeFileSync(dest, JSON.stringify({ cameras: [] }, null, 2));
  }
  return dest;
}
