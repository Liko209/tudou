import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';

/**
 * Manages Agent Dashboard's hook script + ~/.claude/settings.json
 * injection. All filesystem ops are synchronous so the install/uninstall
 * flow finishes before we hand control back to the renderer modal.
 *
 * Idempotent: re-installing is safe (replaces any prior entry); uninstall
 * is safe to run with nothing installed.
 */

// Events we wire into ~/.claude/settings.json:
//  - Stop              — turn finished → 'waiting'
//  - UserPromptSubmit  — user sent a prompt → 'working'
//  - PermissionRequest — a permission/choice dialog appeared → 'blocked'.
//    This is the RELIABLE "needs you" signal: it fires the instant the dialog
//    shows, regardless of window focus.
//  - Notification      — Claude sent an OS notification. Suppressed while the
//    terminal is focused, so it's only a supplement to PermissionRequest (and
//    carries the idle-prompt case). Kept for older Claude builds / coverage.
const HOOK_EVENTS = ['Stop', 'UserPromptSubmit', 'PermissionRequest', 'Notification'] as const;
const SENTINEL = 'agent-dashboard.sh';

export type HookEvent = (typeof HOOK_EVENTS)[number];

export interface HookStatus {
  /** Is our shell script present + executable? */
  scriptInstalled: boolean;
  /** Path where the script lives (or would live). */
  scriptPath: string;
  /** Path to Claude's settings file. */
  settingsPath: string;
  /** Which Claude hook events currently reference our script. */
  registeredEvents: HookEvent[];
  /** True iff all events are registered AND the script exists. */
  fullyInstalled: boolean;
}

export interface HookInstallerOptions {
  /** Override for tests. */
  claudeHome?: string;
}

export class HookInstaller {
  private readonly claudeHome: string;

  constructor(opts: HookInstallerOptions = {}) {
    this.claudeHome = opts.claudeHome ?? join(homedir(), '.claude');
  }

  get scriptPath(): string {
    return join(this.claudeHome, 'hooks', 'agent-dashboard.sh');
  }

  get settingsPath(): string {
    return join(this.claudeHome, 'settings.json');
  }

  getStatus(): HookStatus {
    const scriptPath = this.scriptPath;
    const settingsPath = this.settingsPath;
    let scriptInstalled = false;
    try {
      const st = statSync(scriptPath);
      scriptInstalled = st.isFile() && (st.mode & 0o100) !== 0;
    } catch {
      scriptInstalled = false;
    }

    const settings = this.readSettings(settingsPath);
    const registered: HookEvent[] = [];
    for (const event of HOOK_EVENTS) {
      if (this.hasOurEntry(settings, event)) registered.push(event);
    }
    return {
      scriptInstalled,
      scriptPath,
      settingsPath,
      registeredEvents: registered,
      fullyInstalled:
        scriptInstalled && registered.length === HOOK_EVENTS.length,
    };
  }

  /** Returns the JSON snippet a user would paste to install manually. */
  getManualSettingsSnippet(instanceFilePath: string): string {
    const snippet: Record<string, unknown> = {
      hooks: this.buildHookEntries(),
    };
    return JSON.stringify(snippet, null, 2)
      .replace('"hooks"', '"hooks"')
      // Annotate the instance file path so the manual user knows what
      // the script reads. (Not strictly needed, but useful for support.)
      .concat(`\n\n// hook script reads tokens from: ${instanceFilePath}`);
  }

  install(scriptContents: string): void {
    this.writeScript(scriptContents);
    this.injectSettings();
  }

  uninstall(): void {
    this.removeScript();
    this.removeFromSettings();
  }

  // ---- internals ----

  private writeScript(contents: string): void {
    mkdirSync(join(this.claudeHome, 'hooks'), { recursive: true });
    writeFileSync(this.scriptPath, contents, { mode: 0o755 });
  }

  private removeScript(): void {
    try {
      rmSync(this.scriptPath, { force: true });
    } catch {
      // ignore — already gone
    }
  }

  private readSettings(path: string): Record<string, unknown> {
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch {
      return {};
    }
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private writeSettings(path: string, value: Record<string, unknown>): void {
    // Backup existing file if present.
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      copyFileSync(path, `${path}.bak.${stamp}`);
    } catch {
      // Source may not exist yet — that's fine.
    }
    mkdirSync(join(this.claudeHome), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
    renameSync(tmp, path);
  }

  private buildHookEntries(): Record<HookEvent, Array<{ hooks: Array<{ type: string; command: string }> }>> {
    const command = this.scriptPath;
    const entry = { hooks: [{ type: 'command', command }] };
    return Object.fromEntries(HOOK_EVENTS.map((e) => [e, [entry]])) as ReturnType<
      HookInstaller['buildHookEntries']
    >;
  }

  private injectSettings(): void {
    const settings = this.readSettings(this.settingsPath);
    const hooksBlock = isRecord(settings.hooks) ? { ...settings.hooks } : {};

    for (const event of HOOK_EVENTS) {
      const prior = Array.isArray(hooksBlock[event]) ? (hooksBlock[event] as unknown[]) : [];
      const cleaned = prior.filter((item) => !isOurEntry(item));
      cleaned.push({
        hooks: [{ type: 'command', command: this.scriptPath }],
      });
      hooksBlock[event] = cleaned;
    }

    settings.hooks = hooksBlock;
    this.writeSettings(this.settingsPath, settings);
  }

  private removeFromSettings(): void {
    const settings = this.readSettings(this.settingsPath);
    if (!isRecord(settings.hooks)) return;
    const hooksBlock = { ...settings.hooks };
    let mutated = false;
    for (const event of HOOK_EVENTS) {
      const prior = Array.isArray(hooksBlock[event]) ? (hooksBlock[event] as unknown[]) : null;
      if (!prior) continue;
      const cleaned = prior.filter((item) => !isOurEntry(item));
      if (cleaned.length === prior.length) continue;
      mutated = true;
      if (cleaned.length === 0) delete hooksBlock[event];
      else hooksBlock[event] = cleaned;
    }
    if (!mutated) return;
    if (Object.keys(hooksBlock).length === 0) {
      delete settings.hooks;
    } else {
      settings.hooks = hooksBlock;
    }
    this.writeSettings(this.settingsPath, settings);
  }

  private hasOurEntry(settings: Record<string, unknown>, event: HookEvent): boolean {
    const hooksBlock = isRecord(settings.hooks) ? settings.hooks : null;
    if (!hooksBlock) return false;
    const eventArr = Array.isArray(hooksBlock[event]) ? (hooksBlock[event] as unknown[]) : null;
    if (!eventArr) return false;
    return eventArr.some(isOurEntry);
  }
}

function isOurEntry(item: unknown): boolean {
  if (!isRecord(item)) return false;
  const hooks = Array.isArray(item.hooks) ? item.hooks : [];
  return hooks.some((h: unknown) => {
    if (!isRecord(h)) return false;
    const cmd = typeof h.command === 'string' ? h.command : '';
    return cmd.includes(SENTINEL);
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Hook shell script. Reads instance.json synchronously, forwards the
 * Claude-provided JSON payload from stdin to the dashboard's HTTP endpoint.
 * Fail-open — any error short-circuits exit 0 so claude itself never
 * gets blocked by a hook problem.
 */
export function buildHookScript(instanceFilePath: string): string {
  // Embed the instance file path literally so no shell quoting trouble.
  return `#!/bin/sh
# Agent Dashboard hook — managed by the dashboard, do not edit by hand.
# Forwards Claude hook events to the dashboard via 127.0.0.1.
INSTANCE_FILE='${instanceFilePath.replace(/'/g, "'\\''")}'

# Bail silently if the dashboard isn't running.
[ -f "$INSTANCE_FILE" ] || exit 0

PORT=$(grep -o '"port"[[:space:]]*:[[:space:]]*[0-9][0-9]*' "$INSTANCE_FILE" | grep -o '[0-9]*$')
TOKEN=$(grep -o '"token"[[:space:]]*:[[:space:]]*"[^"]*"' "$INSTANCE_FILE" | sed 's/.*"\\([^"]*\\)"$/\\1/')

[ -z "$PORT" ] && exit 0
[ -z "$TOKEN" ] && exit 0

PAYLOAD=$(cat)
[ -z "$PAYLOAD" ] && PAYLOAD='{}'

# Fire-and-forget; never block claude on a network hiccup.
curl -s -m 1 -X POST \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  --data "$PAYLOAD" \\
  "http://127.0.0.1:$PORT/hook" >/dev/null 2>&1 || true

exit 0
`;
}
