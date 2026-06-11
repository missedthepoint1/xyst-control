import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// `@xyst/core` is a sibling workspace package bundled into the main process. By default
// electron-vite only watches packages/app, so editing a driver/manager in core leaves the
// running main process on STALE core (rename/reorder/new drivers silently no-op). Watching
// core's source too makes the main process auto-restart on those edits — like the renderer.
// Gated to dev (command !== 'build') so a production `electron-vite build` doesn't hang in watch.
export default defineConfig(({ command }) => ({
  main: {
    build: {
      watch: command === 'build' ? undefined : { include: [resolve('src/**'), resolve('../core/src/**')] },
      rollupOptions: { input: resolve('src/main/index.ts') },
    },
  },
  preload: {
    build: {
      watch: command === 'build' ? undefined : { include: [resolve('src/**')] },
      rollupOptions: {
        input: resolve('src/preload/index.ts'),
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
  },
}));
