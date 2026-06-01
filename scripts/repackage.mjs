#!/usr/bin/env node
// Build / repackage the macOS app.
//
//   npm run repackage                 # build for THIS machine's arch, then
//                                      # uninstall the old app and reinstall +
//                                      # launch the fresh build (local flow)
//   npm run repackage -- --x64        # build x64 artifacts only (no install)
//   npm run repackage -- --arm64      # build arm64 artifacts only (no install)
//   npm run repackage -- --universal  # build a single universal binary
//   npm run repackage -- --all        # build both arm64 + x64
//
//   Extra flags:
//     -y, --yes        skip the "delete installed app?" confirmation
//     --purge-data     also wipe ~/Library/Application Support/Tudou
//     --no-launch      don't auto-open after a local reinstall
//
// Default (no arch flag) = "reinstall for my machine": it quits, deletes and
// replaces /Applications/Tudou.app. Passing an arch flag means "produce
// distribution artifacts" — it only writes to release/ and never touches the
// installed app, since a cross-arch / universal build is for shipping, not
// for running here.
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

const APP_NAME = 'Tudou';
const INSTALLED = `/Applications/${APP_NAME}.app`;
const args = process.argv.slice(2);
const has = (...names) => names.some((n) => args.includes(n));

const purgeData = has('--purge-data');
const noLaunch = has('--no-launch');
const assumeYes = has('-y', '--yes');

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
const quiet = (cmd) => {
  try {
    execSync(cmd, { stdio: 'ignore' });
  } catch {
    /* best-effort */
  }
};
const step = (msg) => console.log(`\n\x1b[36m▸ ${msg}\x1b[0m`);

// ---- resolve build target ----
function resolveTarget() {
  if (has('--all')) return { ebFlags: '--arm64 --x64', label: 'arm64 + x64', appDir: null };
  if (has('--universal'))
    return { ebFlags: '--universal', label: 'universal', appDir: 'release/mac-universal' };
  if (has('--x64')) return { ebFlags: '--x64', label: 'x64', appDir: 'release/mac' };
  if (has('--arm64')) return { ebFlags: '--arm64', label: 'arm64', appDir: 'release/mac-arm64' };
  // Default: this machine's architecture, with the local reinstall flow.
  const arm = process.arch === 'arm64';
  return {
    ebFlags: arm ? '--arm64' : '--x64',
    label: `${process.arch} (this machine)`,
    appDir: arm ? 'release/mac-arm64' : 'release/mac',
    install: true,
  };
}

const target = resolveTarget();

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(question)).trim().toLowerCase();
  rl.close();
  return answer === 'y' || answer === 'yes';
}

if (target.install) {
  if (!assumeYes) {
    console.log(`This will:
  • quit ${APP_NAME} if running
  • delete ${INSTALLED}${purgeData ? '\n  • wipe app data (sessions + preferences)' : ''}
  • rebuild + reinstall the ${target.label} build`);
    const ok = await confirm('\nContinue? [y/N] ');
    if (!ok) {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  step('Quitting running app…');
  quiet(`osascript -e 'tell application "${APP_NAME}" to quit'`);
  quiet(`pkill -x ${APP_NAME}`);

  step(`Removing installed app (${INSTALLED})…`);
  rmSync(INSTALLED, { recursive: true, force: true });

  if (purgeData) {
    const dataDir = join(homedir(), 'Library', 'Application Support', APP_NAME);
    step(`Purging app data (${dataDir})…`);
    rmSync(dataDir, { recursive: true, force: true });
  }
} else {
  console.log(`Building ${target.label} distribution artifacts (installed app left untouched).`);
}

step('Cleaning build output…');
for (const dir of ['dist', 'renderer/out', 'renderer/.next', 'release']) {
  rmSync(dir, { recursive: true, force: true });
}

step('Building renderer + electron…');
run('npm run build');

step(`Packaging (mac ${target.label})…`);
run(`npx electron-builder --mac ${target.ebFlags}`);

if (!target.install) {
  step('Done — distribution artifacts written to release/.');
  console.log('\x1b[32m✓ Built ' + target.label + ' (.dmg + .app under release/).\x1b[0m');
  process.exit(0);
}

const built = target.appDir && existsSync(`${target.appDir}/${APP_NAME}.app`)
  ? `${target.appDir}/${APP_NAME}.app`
  : ['release/mac-arm64/Tudou.app', 'release/mac/Tudou.app'].find(existsSync);
if (!built) {
  console.error('\n\x1b[31m✗ Could not find a built Tudou.app under release/.\x1b[0m');
  process.exit(1);
}

step(`Installing → ${INSTALLED}…`);
// ditto preserves the bundle's symlinks/permissions (cp -R / fs.cp can mangle
// the Frameworks symlinks inside a .app).
run(`ditto "${built}" "${INSTALLED}"`);

if (!noLaunch) {
  step('Launching…');
  quiet(`open "${INSTALLED}"`);
}

console.log('\n\x1b[32m✓ Done — fresh build installed to /Applications.\x1b[0m');
