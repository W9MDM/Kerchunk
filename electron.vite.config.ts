import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    build: {
      outDir: 'dist/main',
      // Emit CommonJS so Electron loads the main process reliably. Package
      // "type": "module" would make a .js main ESM, which Electron's loader
      // rejects at startup ("Cannot read properties of undefined (reading
      // 'exports')"). A .cjs entry sidesteps the ESM/CJS interop entirely.
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: 'index.cjs',
        },
      },
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
