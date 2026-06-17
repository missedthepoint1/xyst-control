import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUpdateStore } from '../src/main/update-store.js';

function tmpFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'xyst-upd-')), 'update.json');
}

describe('update store', () => {
  it('returns undefined when nothing is skipped', () => {
    const s = createUpdateStore(tmpFile());
    expect(s.getSkipped()).toBeUndefined();
  });
  it('persists and reads back a skipped version', () => {
    const file = tmpFile();
    createUpdateStore(file).setSkipped('0.5.0');
    expect(createUpdateStore(file).getSkipped()).toBe('0.5.0');
  });
  it('tolerates a corrupt file by returning undefined', () => {
    const file = tmpFile();
    const s = createUpdateStore(file);
    s.setSkipped('0.5.0');
    writeFileSync(file, 'not json'); // overwrite with garbage
    expect(createUpdateStore(file).getSkipped()).toBeUndefined();
  });
});
