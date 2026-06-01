// electron-builder rebuilds node-pty for the target Electron version
// during packaging. The rebuild produces a fresh `spawn-helper` binary
// that — depending on archive tool behaviour — can lose its execute bit
// once asar.unpacked is laid down. Without +x, node-pty fails at runtime
// with "posix_spawnp failed."
//
// Mirrors scripts/fix-node-pty.mjs but operates on the packed app
// instead of the local node_modules tree.
import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export default async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  if (electronPlatformName !== 'darwin' && electronPlatformName !== 'linux') return;

  const productName = packager.appInfo.productName;
  const resourcesDir =
    electronPlatformName === 'darwin'
      ? join(appOutDir, `${productName}.app`, 'Contents', 'Resources')
      : join(appOutDir, 'resources');

  const nodePtyRoot = join(
    resourcesDir,
    'app.asar.unpacked',
    'node_modules',
    'node-pty',
  );

  if (!existsSync(nodePtyRoot)) {
    console.warn(`[after-pack] node-pty not found in unpacked tree: ${nodePtyRoot}`);
    return;
  }

  // @electron/rebuild produces `build/Release/spawn-helper`; the prebuilt
  // distribution ships `prebuilds/{platform}-{arch}/spawn-helper`.
  // Walk both possible locations and chmod everything we find.
  const candidates = [];

  const rebuildPath = join(nodePtyRoot, 'build', 'Release', 'spawn-helper');
  if (existsSync(rebuildPath)) candidates.push(rebuildPath);

  const prebuildsDir = join(nodePtyRoot, 'prebuilds');
  if (existsSync(prebuildsDir)) {
    for (const archEntry of readdirSync(prebuildsDir)) {
      const archDir = join(prebuildsDir, archEntry);
      if (!statSync(archDir).isDirectory()) continue;
      const helper = join(archDir, 'spawn-helper');
      if (existsSync(helper)) candidates.push(helper);
    }
  }

  if (candidates.length === 0) {
    console.warn(`[after-pack] no spawn-helper found under ${nodePtyRoot}`);
    return;
  }
  for (const helper of candidates) {
    chmodSync(helper, 0o755);
    console.log(`[after-pack] chmod +x ${helper}`);
  }
}
