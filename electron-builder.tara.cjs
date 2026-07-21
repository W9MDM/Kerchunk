// TARA-branded packaging config. Extends the base electron-builder config from
// package.json and overrides product identity + output. Build via `dist:tara`,
// which also sets KERCHUNK_BRAND=tara so the app UI + seeded node are branded.
//
// Brand icon: build/icon-tara.png (the TARA logo).
const base = require('./package.json').build;

// On the host platform, use the already-unpacked Electron (offline/firewall-
// friendly). The TARA target is Windows, so this applies when building on Windows.
const useLocalElectron = process.platform === 'win32';

module.exports = {
  ...base,
  productName: 'TARA Kerchunk',
  appId: 'org.tara.kerchunk',
  directories: { ...base.directories, output: 'release-tara' },
  win: { ...base.win, icon: 'build/icon-tara.png' },
  nsis: { ...base.nsis, shortcutName: 'TARA Kerchunk' },
  // Bakes name/productName into the packaged app's package.json; artifactName
  // templates use ${productName} → "TARA Kerchunk-<version>-Setup.exe".
  extraMetadata: { name: 'tara-kerchunk', productName: 'TARA Kerchunk' },
  ...(useLocalElectron ? { electronDist: 'node_modules/electron/dist' } : {}),
};
