import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    build: {
      outDir: 'dist/main',
    },
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    build: {
      outDir: 'dist/preload',
      // Emit CommonJS so the preload loads regardless of Electron's sandbox
      // setting. Package "type": "module" would otherwise make a .js preload ESM,
      // which sandboxed preloads reject.
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: 'index.cjs',
        },
      },
    },
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: 'src/renderer',
    build: {
      outDir: 'dist/renderer',
    },
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
      },
    },
  },
});
