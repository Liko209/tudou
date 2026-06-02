#!/usr/bin/env node
// Cut a release: bump the patch version, build, and publish the macOS
// dmg + zip + latest-mac.yml to GitHub Releases (the feed electron-updater
// reads). The in-app updater then offers it to every install.
//
//   npm run release              # patch bump (0.1.0 → 0.1.1)
//   npm run release -- minor     # minor bump
//   npm run release -- 1.2.3     # explicit version
//
// Requires: the GitHub repo to exist (see build.publish in package.json) and
// `gh` to be authenticated — we pull the token from `gh auth token`.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', cwd: root, ...opts });
const capture = (cmd) => {
  try {
    return execSync(cmd, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};
const step = (m) => console.log(`\n\x1b[36m▸ ${m}\x1b[0m`);

// Bitrove-style notes: "Changes since <prevTag>" (git log) + macOS install help.
function buildReleaseNotes(version) {
  capture('git fetch --tags --quiet origin'); // pull tags electron-builder created
  const tags = capture("git tag --list 'v*' --sort=-v:refname")
    .split('\n')
    .filter(Boolean);
  const prevTag = tags.find((t) => t !== `v${version}`);
  const heading = prevTag ? `Changes since ${prevTag}` : 'Initial release';
  const changes = prevTag
    ? // Quote the format — the "- %s" contains a space the shell would
      // otherwise split, leaving %s parsed as a path (git: "use -- to
      // separate paths from revisions") and the changelog empty.
      capture(`git log ${prevTag}..HEAD --no-merges --pretty="format:- %s"`) ||
      '- (no commits since the last release)'
    : '- First published build.';
  return `## ${heading}

${changes}

---

## Installing on macOS

Tudou is currently unsigned, so macOS will block it unless you take one extra step:

1. Download the DMG below — \`Tudou-${version}-arm64.dmg\` for Apple Silicon,
   \`Tudou-${version}.dmg\` for Intel — open it, drag **Tudou** to Applications.
2. In Terminal, run:
   \`\`\`
   xattr -cr /Applications/Tudou.app
   \`\`\`
3. Open Tudou. Future updates apply automatically from **Settings → Updates**.

If you see "Tudou is damaged and can't be opened", you skipped step 2 — that's
just macOS Gatekeeper's wording for any unsigned app from a browser. Run the
\`xattr\` command and try again. Signing + notarization is on the roadmap.
`;
}

const bump = process.argv[2] || 'patch'; // patch | minor | major | x.y.z

step(`Bumping version (${bump})…`);
run(`npm version ${bump} --no-git-tag-version`);
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
console.log(`  → v${version}`);

step('Resolving GitHub token via gh…');
let token;
try {
  token = execSync('gh auth token', { encoding: 'utf8' }).trim();
} catch {
  console.error('\x1b[31m✗ `gh auth token` failed — run `gh auth login` first.\x1b[0m');
  process.exit(1);
}
if (!token) {
  console.error('\x1b[31m✗ Empty GitHub token.\x1b[0m');
  process.exit(1);
}

step('Building renderer + electron…');
run('npm run build');

step('Packaging + publishing to GitHub Releases (mac arm64 + x64)…');
run('npx electron-builder --mac --publish always', {
  env: { ...process.env, GH_TOKEN: token },
});

// electron-builder uploaded everything to a DRAFT release (releaseType: draft),
// so no updater check could 404 on a half-uploaded release. Now that all assets
// (incl. latest-mac.yml) are up, write the notes and flip it to a published
// release in one shot — that's the moment it becomes the "latest" the updater
// sees.
step('Writing notes + publishing the release…');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const target = pkg.build?.publish?.[0];
if (target?.owner && target?.repo) {
  const notesPath = join(tmpdir(), `tudou-relnotes-${version}.md`);
  writeFileSync(notesPath, buildReleaseNotes(version));
  run(
    `gh release edit v${version} --repo ${target.owner}/${target.repo} --draft=false --notes-file "${notesPath}"`,
    { env: { ...process.env, GH_TOKEN: token } },
  );
} else {
  console.warn('  (skipped — no build.publish owner/repo configured)');
}

console.log(`\n\x1b[32m✓ Released v${version}. In-app updater will pick it up on next check.\x1b[0m`);

// Now that the release is actually published, commit + push the version bump so
// main's version stays in lockstep with what's live. Done here (not before
// publish) on purpose: a release that fails/aborts leaves no phantom version on
// main. Best-effort — a git hiccup doesn't undo the release, so we fall back to
// a manual reminder. Scoped to the bump files so it never sweeps up other work.
step('Committing the version bump…');
try {
  run('git add package.json package-lock.json');
  if (!capture('git diff --cached --name-only')) {
    console.log('  (nothing to commit — version already recorded)');
  } else {
    run(`git commit -m "v${version}"`);
    run('git push');
    console.log(`  ✓ committed + pushed v${version}`);
  }
} catch {
  console.warn('  ⚠ could not commit/push the bump — do it manually:');
  console.warn(`    git add package.json package-lock.json && git commit -m "v${version}" && git push`);
}
