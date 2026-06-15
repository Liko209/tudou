import { readFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CliKind } from '../shared/ipc-contracts';
import { DEFAULT_SOUND_ID, normalizeSoundId } from '../shared/sound-catalog';
import {
  DEFAULT_NETWORK_PREFERENCES,
  type CustomEnvVar,
  type NetworkPreferences,
} from '../shared/network-env';

/**
 * User-configurable preferences. Persisted synchronously like
 * SessionPersistence — every set() write hits disk immediately so a
 * SIGTERM never loses the change.
 */
export interface Preferences {
  notifications: {
    systemNotification: boolean;
    dockBadge: boolean;
    tray: boolean;
    /** Chosen "session finished" cue (→ waiting): a catalog id, or 'off'. */
    soundCompleteId: string;
    /** Chosen "needs you" cue (→ blocked / errored): a catalog id, or 'off'. */
    soundAlertId: string;
  };
  quietHours: {
    enabled: boolean;
    /** "HH:MM" 24-hour, local time. */
    start: string;
    end: string;
  };
  cliPaths: {
    claude: string | null;
    codex: string | null;
  };
  /** Proxy + custom env injected into every spawned CLI. */
  network: NetworkPreferences;
  /**
   * Project working directories (cwds) the user has hidden from the sidebar.
   * Purely a view filter — sessions, PTYs, and on-disk history are untouched.
   */
  hiddenProjects: string[];
}

export const DEFAULT_PREFERENCES: Preferences = {
  notifications: {
    systemNotification: true,
    dockBadge: true,
    tray: true,
    soundCompleteId: DEFAULT_SOUND_ID.complete,
    soundAlertId: DEFAULT_SOUND_ID.alert,
  },
  quietHours: {
    enabled: false,
    start: '22:00',
    end: '08:00',
  },
  cliPaths: {
    claude: null,
    codex: null,
  },
  network: clone(DEFAULT_NETWORK_PREFERENCES),
  hiddenProjects: [],
};

interface PersistedFile {
  version: 1;
  preferences: Preferences;
}

const SCHEMA_VERSION = 1;

export class PreferencesStore {
  private prefs: Preferences = clone(DEFAULT_PREFERENCES);

  constructor(private readonly filePath: string) {}

  load(): Preferences {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf8');
    } catch {
      return this.prefs;
    }
    try {
      const parsed = JSON.parse(raw);
      if (isPersistedFile(parsed)) {
        this.prefs = mergeWithDefaults(parsed.preferences);
      }
    } catch {
      // Malformed → keep defaults
    }
    return this.prefs;
  }

  get(): Preferences {
    return this.prefs;
  }

  /** Replace the whole prefs object (caller does the validation/merging). */
  setAll(next: Preferences): Preferences {
    this.prefs = mergeWithDefaults(next);
    this.writeNow();
    return this.prefs;
  }

  /** Reset to defaults. Keeps the curated hiddenProjects list — that's data the
   *  user manages from the sidebar, not a tweakable setting, so a prefs reset
   *  shouldn't resurrect every removed project. */
  reset(): Preferences {
    this.prefs = { ...clone(DEFAULT_PREFERENCES), hiddenProjects: this.prefs.hiddenProjects };
    this.writeNow();
    return this.prefs;
  }

  /** Convenience for "is right now inside the quiet-hours window?" */
  isQuietHoursNow(at: Date = new Date()): boolean {
    if (!this.prefs.quietHours.enabled) return false;
    const startMin = parseHHMM(this.prefs.quietHours.start);
    const endMin = parseHHMM(this.prefs.quietHours.end);
    if (startMin === null || endMin === null) return false;
    const nowMin = at.getHours() * 60 + at.getMinutes();
    if (startMin === endMin) return false;
    // Same-day window (e.g. 13:00–17:00)
    if (startMin < endMin) return nowMin >= startMin && nowMin < endMin;
    // Overnight window (e.g. 22:00–08:00)
    return nowMin >= startMin || nowMin < endMin;
  }

  /** Override path for the given CLI, or null if no override. */
  cliPathOverride(cli: CliKind): string | null {
    return this.prefs.cliPaths[cli];
  }

  private writeNow(): void {
    const file: PersistedFile = { version: SCHEMA_VERSION, preferences: this.prefs };
    const tmp = `${this.filePath}.tmp`;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
      renameSync(tmp, this.filePath);
    } catch (err) {
       
      console.error('[preferences] write failed:', err);
    }
  }
}

// ---- helpers ----

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isPersistedFile(v: unknown): v is PersistedFile {
  return isRecord(v) && v.version === SCHEMA_VERSION && isRecord(v.preferences);
}

function mergeWithDefaults(p: unknown): Preferences {
  // Shallow-merge per section so newly-added prefs get default values
  // without nuking existing user choices.
  const base = clone(DEFAULT_PREFERENCES);
  if (!isRecord(p)) return base;
  if (isRecord(p.notifications)) {
    Object.assign(
      base.notifications,
      pickBooleans(p.notifications, ['systemNotification', 'dockBadge', 'tray']),
    );
    base.notifications.soundCompleteId = normalizeSoundId('complete', p.notifications.soundCompleteId);
    base.notifications.soundAlertId = normalizeSoundId('alert', p.notifications.soundAlertId);
  }
  if (isRecord(p.quietHours)) {
    if (typeof p.quietHours.enabled === 'boolean') base.quietHours.enabled = p.quietHours.enabled;
    if (typeof p.quietHours.start === 'string' && parseHHMM(p.quietHours.start) !== null) {
      base.quietHours.start = p.quietHours.start;
    }
    if (typeof p.quietHours.end === 'string' && parseHHMM(p.quietHours.end) !== null) {
      base.quietHours.end = p.quietHours.end;
    }
  }
  if (isRecord(p.cliPaths)) {
    if (p.cliPaths.claude === null || typeof p.cliPaths.claude === 'string') {
      base.cliPaths.claude = p.cliPaths.claude as string | null;
    }
    if (p.cliPaths.codex === null || typeof p.cliPaths.codex === 'string') {
      base.cliPaths.codex = p.cliPaths.codex as string | null;
    }
  }
  if (isRecord(p.network)) {
    base.network = mergeNetwork(p.network);
  }
  if (Array.isArray(p.hiddenProjects)) {
    const seen = new Set<string>();
    base.hiddenProjects = p.hiddenProjects.filter(
      (c): c is string => typeof c === 'string' && !seen.has(c) && (seen.add(c), true),
    );
  }
  return base;
}

function mergeNetwork(n: Record<string, unknown>): NetworkPreferences {
  const base = clone(DEFAULT_NETWORK_PREFERENCES);
  // `customEnv` is the whole model now (older files may also carry a legacy
  // `proxy` object — harmlessly ignored). An explicit array on disk replaces
  // the seeded defaults, including an empty list (a user who cleared it).
  if (Array.isArray(n.customEnv)) {
    base.customEnv = n.customEnv.flatMap((e): CustomEnvVar[] => {
      // Drop anything that isn't a well-formed entry; coerce missing optional
      // fields to sensible defaults so a partial row survives a round-trip.
      if (!isRecord(e) || typeof e.key !== 'string') return [];
      return [
        {
          key: e.key,
          value: typeof e.value === 'string' ? e.value : '',
          enabled: typeof e.enabled === 'boolean' ? e.enabled : true,
        },
      ];
    });
  }
  return base;
}

function pickBooleans(src: Record<string, unknown>, keys: string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const k of keys) {
    if (typeof src[k] === 'boolean') out[k] = src[k] as boolean;
  }
  return out;
}

function parseHHMM(s: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}
