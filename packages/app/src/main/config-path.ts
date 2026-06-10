import { app } from 'electron';
import { join } from 'node:path';
import { existsSync, copyFileSync } from 'node:fs';

/** cameras.json lives in userData; seed from the repo example on first run. */
export function resolveConfigPath(): string {
  const dest = join(app.getPath('userData'), 'cameras.json');
  if (!existsSync(dest)) {
    const example = join(app.getAppPath(), '..', '..', 'config', 'cameras.example.json');
    if (existsSync(example)) copyFileSync(example, dest);
  }
  return dest;
}
