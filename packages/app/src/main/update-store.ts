import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export interface UpdateStore {
  getSkipped(): string | undefined;
  setSkipped(version: string): void;
}

/** Tiny JSON store for the skipped update version, persisted at `file` (in userData). */
export function createUpdateStore(file: string): UpdateStore {
  return {
    getSkipped() {
      if (!existsSync(file)) return undefined;
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as { skippedVersion?: string };
        return parsed.skippedVersion;
      } catch {
        return undefined;
      }
    },
    setSkipped(version: string) {
      writeFileSync(file, JSON.stringify({ skippedVersion: version }), 'utf8');
    },
  };
}
