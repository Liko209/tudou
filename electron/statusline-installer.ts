import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import type { RateLimits } from '../shared/usage-types';
import { parseRateLimits } from './rate-limits';

export const RATE_LIMIT_FILE = 'tudou-rate-limits.json';
const WRAPPER_SCRIPT = 'tudou-statusline.sh';
const META_FILE = 'tudou-statusline-meta.json';

/**
 * Builds the statusLine wrapper script. Claude Code invokes the statusLine
 * command with a JSON payload on stdin that includes `rate_limits`; we capture
 * that to a file, then DELEGATE to the user's previous statusLine command
 * (fed the same stdin) so their status line renders unchanged. `delegate` is
 * the previous command string, or null if they had none.
 */
export function buildStatusLineWrapper(delegate: string | null): string {
  // The delegate is embedded as a single-quoted shell value; escape any quotes.
  const safeDelegate = delegate ? delegate.replace(/'/g, `'\\''`) : '';
  return `#!/bin/bash
# Tudou statusLine wrapper — captures Claude rate_limits for Tudou's Usage view,
# then delegates to the previous statusLine command. Managed by Tudou; do not edit.
INPUT=$(cat)
printf '%s' "$INPUT" | python3 -c '
import sys, json, time, os
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
rl = data.get("rate_limits")
if not rl:
    sys.exit(0)
out = {"source": "claude", "updatedAt": int(time.time())}
fh = rl.get("five_hour")
if fh: out["fiveHour"] = {"usedPercentage": fh.get("used_percentage", 0), "resetsAt": fh.get("resets_at", 0)}
sd = rl.get("seven_day")
if sd: out["sevenDay"] = {"usedPercentage": sd.get("used_percentage", 0), "resetsAt": sd.get("resets_at", 0)}
cfg = os.environ.get("CLAUDE_CONFIG_DIR", os.path.join(os.path.expanduser("~"), ".claude"))
try:
    with open(os.path.join(cfg, "${RATE_LIMIT_FILE}"), "w") as f:
        json.dump(out, f)
except Exception:
    pass
' 2>/dev/null
DELEGATE='${safeDelegate}'
if [ -n "$DELEGATE" ]; then
  printf '%s' "$INPUT" | eval "$DELEGATE"
fi
`;
}

type Settings = Record<string, unknown>;

/** Point statusLine at our wrapper. Pure. */
export function withStatusLine(settings: Settings, command: string): Settings {
  return { ...settings, statusLine: { type: 'command', command, padding: 0 } };
}

/** Restore the previous statusLine (or drop it). Pure. */
export function withoutStatusLine(settings: Settings, previousCommand: string | null): Settings {
  const next = { ...settings };
  if (previousCommand) next.statusLine = { type: 'command', command: previousCommand, padding: 0 };
  else delete next.statusLine;
  return next;
}

export interface RateLimitStatus {
  /** Our wrapper is the active statusLine command. */
  enabled: boolean;
  /** A rate-limit snapshot file exists (data has flowed at least once). */
  hasData: boolean;
}

/**
 * Manages the opt-in rate-limit capture: installs/removes the statusLine
 * wrapper (preserving any existing command) and reads the captured snapshot.
 */
export class RateLimitTracker {
  private readonly claudeHome: string;

  constructor(opts: { claudeHome?: string } = {}) {
    this.claudeHome = opts.claudeHome ?? join(homedir(), '.claude');
  }

  private get scriptPath(): string {
    return join(this.claudeHome, WRAPPER_SCRIPT);
  }
  private get settingsPath(): string {
    return join(this.claudeHome, 'settings.json');
  }
  private get metaPath(): string {
    return join(this.claudeHome, META_FILE);
  }
  private get dataPath(): string {
    return join(this.claudeHome, RATE_LIMIT_FILE);
  }

  private readSettings(): Settings {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.settingsPath, 'utf8'));
      return typeof parsed === 'object' && parsed !== null ? (parsed as Settings) : {};
    } catch {
      return {};
    }
  }

  private currentCommand(settings: Settings): string | null {
    const sl = settings.statusLine;
    if (sl && typeof sl === 'object' && typeof (sl as Record<string, unknown>).command === 'string') {
      return (sl as Record<string, unknown>).command as string;
    }
    return null;
  }

  getStatus(): RateLimitStatus {
    const cmd = this.currentCommand(this.readSettings());
    return { enabled: cmd === this.scriptPath, hasData: existsSync(this.dataPath) };
  }

  enable(): RateLimitStatus {
    mkdirSync(this.claudeHome, { recursive: true });
    const settings = this.readSettings();
    const cmd = this.currentCommand(settings);
    // Capture the delegate only on first install (don't chain our own wrapper).
    let delegate: string | null;
    if (cmd === this.scriptPath) {
      delegate = this.readMeta();
    } else {
      delegate = cmd;
      writeFileSync(this.metaPath, JSON.stringify({ previousCommand: delegate }), { mode: 0o600 });
    }
    writeFileSync(this.scriptPath, buildStatusLineWrapper(delegate), { mode: 0o700 });
    chmodSync(this.scriptPath, 0o700);
    writeFileSync(this.settingsPath, JSON.stringify(withStatusLine(settings, this.scriptPath), null, 2));
    return this.getStatus();
  }

  disable(): RateLimitStatus {
    const settings = this.readSettings();
    if (this.currentCommand(settings) === this.scriptPath) {
      const previous = this.readMeta();
      writeFileSync(this.settingsPath, JSON.stringify(withoutStatusLine(settings, previous), null, 2));
    }
    for (const p of [this.scriptPath, this.metaPath, this.dataPath]) {
      try {
        rmSync(p, { force: true });
      } catch {
        /* ignore */
      }
    }
    return this.getStatus();
  }

  private readMeta(): string | null {
    try {
      const m: unknown = JSON.parse(readFileSync(this.metaPath, 'utf8'));
      if (m && typeof m === 'object' && typeof (m as Record<string, unknown>).previousCommand === 'string') {
        return (m as Record<string, unknown>).previousCommand as string;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  read(): RateLimits | null {
    try {
      return parseRateLimits(JSON.parse(readFileSync(this.dataPath, 'utf8')));
    } catch {
      return null;
    }
  }
}
