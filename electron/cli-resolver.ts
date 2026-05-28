import { spawn } from 'node:child_process';

/**
 * Resolves a CLI binary path by asking the user's login shell
 * (`bash -lc "command -v <name>"`). This is necessary because Electron
 * launched from Finder does not inherit the user's full shell PATH
 * (nvm, asdf, ~/.local/bin, brew shellenv, etc. only show up after a
 * login-shell init).
 *
 * Results are cached per name for the lifetime of the process.
 * Returns null if the CLI is not found.
 */
const cache = new Map<string, string | null>();

export async function resolveCliPath(name: string): Promise<string | null> {
  if (cache.has(name)) return cache.get(name) ?? null;
  const path = await runProbe(name);
  cache.set(name, path);
  return path;
}

function runProbe(name: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn('bash', ['-lc', `command -v ${shellQuote(name)}`], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let stdout = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    proc.on('error', () => resolve(null));
    proc.on('exit', (code) => {
      if (code === 0) {
        const trimmed = stdout.trim();
        resolve(trimmed.length > 0 ? trimmed : null);
      } else {
        resolve(null);
      }
    });
  });
}

function shellQuote(s: string): string {
  // Reject anything outside POSIX command name safe set — these are CLI
  // names we control, never user input, but keep defense-in-depth.
  if (!/^[a-zA-Z0-9._-]+$/.test(s)) {
    throw new Error(`unsafe CLI name: ${s}`);
  }
  return s;
}

/** Test hook only. */
export function _resetResolverCache(): void {
  cache.clear();
}
