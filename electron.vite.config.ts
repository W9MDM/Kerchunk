import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Build-time brand selector (white-label). `KERCHUNK_BRAND=tara npm run …`
// bakes the brand into both the main and renderer bundles via __BRAND__.
const brand = JSON.stringify(process.env.KERCHUNK_BRAND ?? 'kerchunk');
// App version baked in for the renderer (About), read from package.json.
const appVersion = JSON.stringify(JSON.parse(readFileSync('package.json', 'utf8')).version);

export default defineConfig({
  main: {
    define: { __BRAND__: brand },
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
    define: { __BRAND__: brand, __APP_VERSION__: appVersion },
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
