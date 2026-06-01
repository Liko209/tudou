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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', cwd: root, ...opts });
const step = (m) => console.log(`\n\x1b[36m▸ ${m}\x1b[0m`);

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

console.log(`\n\x1b[32m✓ Released v${version}. In-app updater will pick it up on next check.\x1b[0m`);
console.log('  (Commit the package.json version bump when you’re ready.)');
