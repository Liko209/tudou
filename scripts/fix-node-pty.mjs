// node-pty 1.x ships prebuilt binaries via prebuildify, but the spawn-helper
// loses its execute bit through npm pack/install on macOS. Without it,
// pty.spawn fails with "posix_spawnp failed."
//
// See: https://github.com/microsoft/node-pty/issues/669
//
// This script is idempotent and runs as a postinstall hook.

import { chmodSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { platform, arch } from 'node:process';

if (platform !== 'darwin' && platform !== 'linux') {
  // Windows uses ConPTY, no spawn-helper needed.
  process.exit(0);
}

const archFolder = `${platform}-${arch}`;
const helperPath = join(
  process.cwd(),
  'node_modules',
  'node-pty',
  'prebuilds',
  archFolder,
  'spawn-helper',
);

if (!existsSync(helperPath)) {
  console.warn(`[fix-node-pty] spawn-helper not found at ${helperPath}`);
  console.warn('[fix-node-pty] node-pty may not work — install may be incomplete.');
  process.exit(0);
}

const before = statSync(helperPath).mode & 0o777;
chmodSync(helperPath, 0o755);
const after = statSync(helperPath).mode & 0o777;

if (before !== after) {
  console.log(`[fix-node-pty] chmod ${helperPath.split('node_modules/')[1]}: ${before.toString(8)} -> ${after.toString(8)}`);
}
