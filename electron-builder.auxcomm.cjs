// Indiana AuxComm-branded packaging config. Extends the base electron-builder
// config from package.json and overrides product identity + output. Build via
// `dist:auxcomm`, which also sets KERCHUNK_BRAND=auxcomm so the app UI + seeded
// node (W9SEM hub 651860) are branded.
//
// Brand icon: build/icon-auxcomm.png (the IDHS AUXCOMM seal).
const base = require('./package.json').build;

// On the host platform, use the already-unpacked Electron (offline/firewall-
// friendly). The target is Windows, so this applies when building on Windows.
const useLocalElectron = process.platform === 'win32';

module.exports = {
  ...base,
  productName: 'Indiana AuxComm',
  appId: 'org.w9mdm.kerchunk.auxcomm',
  directories: { ...base.directories, output: 'release-auxcomm' },
  // Tray/window icon is read from resources/icon.png at runtime — ship the brand's.
  extraResources: [
    ...base.extraResources.filter((r) => typeof r === 'string'),
    { from: 'build/icon-auxcomm.png', to: 'icon.png' },
  ],
  win: { ...base.win, icon: 'build/icon-auxcomm.png' },
  nsis: { ...base.nsis, shortcutName: 'Indiana AuxComm' },
  // Bakes name/productName into the packaged app's package.json; artifactName
  // templates use ${productName} → "Indiana AuxComm-<version>-Setup.exe".
  extraMetadata: { name: 'indiana-auxcomm', productName: 'Indiana AuxComm' },
  ...(useLocalElectron ? { electronDist: 'node_modules/electron/dist' } : {}),
};
