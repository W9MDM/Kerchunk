// Print release download counts. GitHub's web UI no longer shows per-asset
// counts, but they're in the API. This sums them per release + a grand total.
//
//   node scripts/downloads.mjs                      # GitHub W9MDM/Kerchunk
//   node scripts/downloads.mjs owner/repo           # another GitHub repo
//   node scripts/downloads.mjs --gitea <base> owner/repo   # a Gitea instance
//
// For a private repo (or to avoid GitHub's 60/hr unauthenticated limit) set a
// token:  GH_TOKEN=xxxx node scripts/downloads.mjs
//   Gitea: GITEA_TOKEN=xxxx node scripts/downloads.mjs --gitea https://git.example.com owner/repo

const args = process.argv.slice(2);
let apiBase = 'https://api.github.com';
let authHeader;
if (args[0] === '--gitea') {
  const base = args[1].replace(/\/$/, '');
  apiBase = `${base}/api/v1`;
  if (process.env.GITEA_TOKEN) authHeader = `token ${process.env.GITEA_TOKEN}`;
  args.splice(0, 2);
} else if (process.env.GH_TOKEN) {
  authHeader = `Bearer ${process.env.GH_TOKEN}`;
}
const repo = args[0] || 'W9MDM/Kerchunk';

const headers = { Accept: 'application/json' };
if (authHeader) headers.Authorization = authHeader;

const res = await fetch(`${apiBase}/repos/${repo}/releases?per_page=100`, { headers });
if (!res.ok) {
  console.error(`API ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const releases = await res.json();
if (!Array.isArray(releases) || releases.length === 0) {
  console.log('No releases found.');
  process.exit(0);
}

let grand = 0;
for (const r of releases) {
  const assets = r.assets ?? [];
  const sub = assets.reduce((n, a) => n + (a.download_count ?? 0), 0);
  grand += sub;
  console.log(`\n${(r.tag_name ?? r.name ?? '?').padEnd(14)} ${String(sub).padStart(7)} downloads`);
  for (const a of assets) {
    console.log(`   ${String(a.name).padEnd(40)} ${a.download_count ?? 0}`);
  }
}
console.log(`\n${'TOTAL'.padEnd(14)} ${String(grand).padStart(7)} downloads across ${releases.length} releases`);
