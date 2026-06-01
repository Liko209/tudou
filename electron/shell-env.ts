import { spawn } from 'node:child_process';

let inherited = false;

/**
 * Inherit the user's interactive shell PATH into `process.env.PATH`.
 *
 * Why: on macOS, apps launched from Finder/Launchpad/Dock get only
 * launchd's minimal env — `PATH=/usr/bin:/bin:/usr/sbin:/sbin` —
 * which misses nvm, brew, `~/.npm-global`, asdf, and anything else
 * the user added in `~/.zshrc` or `~/.zprofile`. Our spawned CLI
 * (claude, codex) and their subprocesses (node, git, …) then fail
 * to launch. Terminal-launched runs work because they inherit the
 * shell's env. This helper closes that gap so packaged builds match
 * the terminal experience.
 *
 * Idempotent. No-op on Windows. Safe to await before app.whenReady.
 */
export async function inheritShellPath(): Promise<void> {
  if (inherited) return;
  inherited = true;
  if (process.platform === 'win32') return;

  const shell = process.env.SHELL || '/bin/zsh';
  const realPath = await probeShellPath(shell);
  if (realPath) {
    process.env.PATH = realPath;
  }
}

function probeShellPath(shell: string): Promise<string | null> {
  return new Promise((resolve) => {
    // -i sources `~/.zshrc` (where nvm / asdf / homebrew shellenv
    // typically live); -l sources `~/.zprofile`. We need both because
    // different users put PATH mods in different files. stderr is
    // ignored — interactive shells often emit prompt escape codes.
    const proc = spawn(shell, ['-ilc', 'echo $PATH'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let out = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    proc.on('error', () => resolve(null));
    proc.on('exit', (code) => {
      if (code !== 0) return resolve(null);
      // Interactive shells may print prompt junk before our echo line —
      // take the last non-empty line.
      const lines = out
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const path = lines[lines.length - 1] ?? '';
      resolve(path.length > 0 ? path : null);
    });

    // Don't hang app startup if user's shell init is broken.
    setTimeout(() => {
      proc.kill();
      resolve(null);
    }, 3000);
  });
}
