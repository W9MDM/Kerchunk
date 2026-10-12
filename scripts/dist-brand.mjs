// Build a white-label Windows installer (Setup + Portable) → release-<brand>/.
//
//   node scripts/dist-brand.mjs tara       (npm run dist:tara)
//   node scripts/dist-brand.mjs auxcomm    (npm run dist:auxcomm)
//
// Sets KERCHUNK_BRAND=<brand> so the renderer/main bundles carry that brand's
// name, logo, accent and seeded nodes (src/shared/brand.ts), then packages with
// electron-builder.<brand>.cjs. Code signing is disabled (unsigned builds,
// firewall-friendly).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const brand = process.argv[2];
const config = `electron-builder.${brand}.cjs`;
if (!brand || !existsSync(config)) {
  console.error(`usage: node scripts/dist-brand.mjs <brand>  (needs ${config || 'electron-builder.<brand>.cjs'})`);
  process.exit(2);
}

const env = { ...process.env, KERCHUNK_BRAND: brand, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
for (const key of ['CSC_LINK', 'WIN_CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_KEY_PASSWORD']) {
  delete env[key];
}

// 1. Compile the branded bundles.
let r = spawnSync('electron-vite', ['build'], { stdio: 'inherit', shell: true, env });
if (r.status) process.exit(r.status);

// 2. Package with the brand config (electronDist is set inside the config on
// Windows). --publish never: don't let a git tag trigger an implicit GitHub
// publish (CI attaches assets separately; that needs no token).
r = spawnSync('electron-builder', ['--win', '--config', config, '--publish', 'never'], {
  stdio: 'inherit',
  shell: true,
  env,
});
process.exit(r.status ?? 1);
