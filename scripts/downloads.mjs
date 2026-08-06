// Print release download counts. GitHub's web UI no longer shows per-asset
// counts, but they're in the API. This sums them per release + a grand total,
// and separates real installer downloads from auto-update metadata fetches
// (latest.yml / .blockmap), which every running copy of the app polls.
//
//   node scripts/downloads.mjs                      # GitHub W9MDM/Kerchunk
//   node scripts/downloads.mjs owner/repo           # another GitHub repo
//   node scripts/downloads.mjs --gitea <base> owner/repo   # a Gitea instance
//
// Flags:
//   --full    also list update-metadata assets (latest.yml, .blockmap, ...)
//   --json    emit machine-readable JSON instead of a table
//
// For a private repo, to see DRAFT releases, or to avoid GitHub's 60/hr
// unauthenticated limit, set a token:
//   GH_TOKEN=xxxx node scripts/downloads.mjs
//   Gitea: GITEA_TOKEN=xxxx node scripts/downloads.mjs --gitea https://git.example.com owner/repo
//
// Caveat that no API can fix: GitHub does not expose download counts for the
// auto-generated "Source code (zip/tar.gz)" archives, or for git clones. Those
// are never included in any number below.

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i === -1) return false;
  argv.splice(i, 1);
  return true;
};
const showFull = flag('--full') || flag('--all');
const asJson = flag('--json');

let apiBase = 'https://api.github.com';
let isGitea = false;
let authHeader;
if (argv[0] === '--gitea') {
  isGitea = true;
  apiBase = `${String(argv[1] ?? '').replace(/\/$/, '')}/api/v1`;
  if (process.env.GITEA_TOKEN) authHeader = `token ${process.env.GITEA_TOKEN}`;
  argv.splice(0, 2);
} else {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) authHeader = `Bearer ${token}`;
}
const repo = argv[0] || 'W9MDM/Kerchunk';

const headers = {
  Accept: isGitea ? 'application/json' : 'application/vnd.github+json',
  'User-Agent': 'kerchunk-downloads-script',
};
if (!isGitea) headers['X-GitHub-Api-Version'] = '2022-11-28';
if (authHeader) headers.Authorization = authHeader;

async function get(path) {
  const res = await fetch(`${apiBase}${path}`, { headers });
  if (!res.ok) {
    const hint =
      res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0'
        ? '  (rate limited — set GH_TOKEN)'
        : '';
    console.error(`API ${res.status} on ${path}${hint}: ${(await res.text()).slice(0, 400)}`);
    process.exit(1);
  }
  return res.json();
}

// Walk every page. The old version stopped at the first 100 items, so releases
// and per-release assets past that point were silently dropped from the total.
async function getAll(path) {
  const out = [];
  const sep = path.includes('?') ? '&' : '?';
  for (let page = 1; ; page++) {
    const batch = await get(`${path}${sep}per_page=100&page=${page}`);
    if (!Array.isArray(batch)) break;
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

const META_RE = /(^latest(-\w+)?\.yml$|^builder-debug\.yml$|\.blockmap$)/i;
const isMeta = (name) => META_RE.test(String(name));

function platformOf(name) {
  const n = String(name).toLowerCase();
  if (/\.(exe|msi|appx)$/.test(n)) return 'Windows';
  if (/\.(appimage|deb|rpm|snap|pacman)$/.test(n)) return 'Linux';
  if (/\.(dmg|pkg)$/.test(n)) return 'macOS';
  return 'other';
}

const [releases, tags] = await Promise.all([
  getAll(`/repos/${repo}/releases`),
  getAll(`/repos/${repo}/tags`).catch(() => []),
]);

if (releases.length === 0) {
  console.log('No releases found.');
  process.exit(0);
}

const byPlatform = new Map();
let grandInstall = 0;
let grandMeta = 0;

const rows = [];
for (const r of releases) {
  let assets = r.assets ?? [];
  // A release with exactly 100 assets is probably truncated; refetch paged.
  if (assets.length === 100) assets = await getAll(`/repos/${repo}/releases/${r.id}/assets`);

  let install = 0;
  let meta = 0;
  for (const a of assets) {
    const n = a.download_count ?? 0;
    if (isMeta(a.name)) {
      meta += n;
    } else {
      install += n;
      byPlatform.set(platformOf(a.name), (byPlatform.get(platformOf(a.name)) ?? 0) + n);
    }
  }
  grandInstall += install;
  grandMeta += meta;

  rows.push({
    tag: r.tag_name ?? r.name ?? '?',
    published: (r.published_at ?? r.created_at ?? '').slice(0, 10),
    draft: !!r.draft,
    prerelease: !!r.prerelease,
    installs: install,
    updateMeta: meta,
    assets: assets
      .map((a) => ({ name: a.name, count: a.download_count ?? 0, meta: isMeta(a.name) }))
      .sort((x, y) => y.count - x.count || String(x.name).localeCompare(String(y.name))),
  });
}

// Tags with no published release: a failed or draft-only publish. Their assets
// (if any) are not in the numbers above.
const released = new Set(releases.map((r) => r.tag_name).filter(Boolean));
const orphanTags = tags.map((t) => t.name).filter((n) => !released.has(n));

if (asJson) {
  console.log(
    JSON.stringify(
      {
        repo,
        authenticated: !!authHeader,
        releases: rows,
        totals: {
          installs: grandInstall,
          updateMeta: grandMeta,
          byPlatform: Object.fromEntries(byPlatform),
        },
        tagsWithoutRelease: orphanTags,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

console.log(`\n${repo} — ${releases.length} release${releases.length === 1 ? '' : 's'}`);
for (const r of rows) {
  const marks = [r.draft && 'DRAFT', r.prerelease && 'pre'].filter(Boolean).join(' ');
  console.log(
    `\n${r.tag.padEnd(12)} ${(r.published || '-').padEnd(11)} ${String(r.installs).padStart(6)} installs   ${String(r.updateMeta).padStart(6)} update-checks${marks ? '   ' + marks : ''}`,
  );
  for (const a of r.assets) {
    if (a.meta && !showFull) continue;
    console.log(`   ${String(a.name).padEnd(44)} ${String(a.count).padStart(6)}`);
  }
}

console.log(`\n${'-'.repeat(72)}`);
console.log(`TOTAL installer downloads   ${String(grandInstall).padStart(7)}`);
for (const [p, n] of [...byPlatform].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${p.padEnd(24)} ${String(n).padStart(7)}`);
}
console.log(`TOTAL update-check fetches  ${String(grandMeta).padStart(7)}   (latest.yml / .blockmap — not installs)`);

const notes = [];
if (!authHeader) {
  notes.push(
    'No token set (GH_TOKEN) — draft releases are invisible and you get 60 API calls/hr.',
  );
}
if (orphanTags.length) {
  notes.push(
    `${orphanTags.length} tag(s) have no published release, so nothing is counted for them: ${orphanTags.join(', ')}`,
  );
}
notes.push('"Source code (zip/tar.gz)" archive and git-clone counts are not exposed by the API.');
console.log('\nNotes:');
for (const n of notes) console.log(`  - ${n}`);
console.log();
