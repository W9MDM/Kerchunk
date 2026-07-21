// TNARA-branded packaging config. Extends the base electron-builder config from
// package.json and overrides product identity + output. Build via `dist:tnara`,
// which also sets KERCHUNK_BRAND=tnara so the app UI + seeded node are branded.
//
// Replace build/icon-tnara.png with the real TNARA logo (currently a placeholder
// copy of the Kerchunk icon) for the installer/app icon.
const base = require('./package.json').build;

// On the host platform, use the already-unpacked Electron (offline/firewall-
// friendly). The TNARA target is Windows, so this applies when building on Windows.
const useLocalElectron = process.platform === 'win32';

module.exports = {
  ...base,
  productName: 'TNARA TAC',
  appId: 'org.tnara.tac',
  directories: { ...base.directories, output: 'release-tnara' },
  win: { ...base.win, icon: 'build/icon-tnara.png' },
  nsis: { ...base.nsis, shortcutName: 'TNARA TAC' },
  // Bakes name/productName into the packaged app's package.json; artifactName
  // templates use ${productName} → "TNARA TAC-<version>-Setup.exe".
  extraMetadata: { name: 'tnara-tac', productName: 'TNARA TAC' },
  ...(useLocalElectron ? { electronDist: 'node_modules/electron/dist' } : {}),
};
