import { describe, it, expect } from 'vitest';
import { shouldNotify } from '../src/main/updateState.js';

describe('shouldNotify', () => {
  it('notifies for a fresh version when nothing is skipped', () => {
    expect(shouldNotify('0.5.0', undefined)).toBe(true);
  });
  it('does not notify when the offered version is the skipped one', () => {
    expect(shouldNotify('0.5.0', '0.5.0')).toBe(false);
  });
  it('notifies for a different version than the skipped one', () => {
    expect(shouldNotify('0.6.0', '0.5.0')).toBe(true);
  });
});
