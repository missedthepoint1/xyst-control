import { app } from 'electron';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

/**
 * A stable per-install bearer token for the loopback REST API, persisted in userData so it
 * survives restarts (the operator pastes it into Companion once). Generated on first run.
 */
export function resolveApiToken(): string {
  const file = join(app.getPath('userData'), 'api-token');
  if (existsSync(file)) {
    const t = readFileSync(file, 'utf8').trim();
    if (t) return t;
  }
  const token = randomBytes(32).toString('hex');
  writeFileSync(file, token, { mode: 0o600 });
  return token;
}
