/** The update status pushed to the renderer (see preload `onUpdateStatus`). */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

/** Surface an available/downloaded update unless the operator already skipped that version. */
export function shouldNotify(offeredVersion: string, skippedVersion: string | undefined): boolean {
  return offeredVersion !== skippedVersion;
}
