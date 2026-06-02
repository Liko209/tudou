import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PREFERENCES, PreferencesStore } from '../electron/preferences';

const ROOT = join(tmpdir(), `prefs-tests-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);

beforeAll(async () => {
  await mkdir(ROOT, { recursive: true });
});
afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
});

describe('PreferencesStore', () => {
  it('returns defaults when no file exists', () => {
    const store = new PreferencesStore(join(ROOT, 'missing.json'));
    expect(store.load()).toEqual(DEFAULT_PREFERENCES);
  });

  it('setAll persists and survives a fresh instance', async () => {
    const file = join(ROOT, 'persist.json');
    const writer = new PreferencesStore(file);
    writer.load();
    writer.setAll({
      ...DEFAULT_PREFERENCES,
      notifications: { ...DEFAULT_PREFERENCES.notifications, soundAlertId: 'off' },
      cliPaths: { claude: '/usr/bin/claude', codex: null },
    });

    const reader = new PreferencesStore(file);
    const loaded = reader.load();
    expect(loaded.notifications.soundAlertId).toBe('off');
    expect(loaded.cliPaths.claude).toBe('/usr/bin/claude');
  });

  it('falls back to defaults on malformed JSON', async () => {
    const file = join(ROOT, 'malformed.json');
    await writeFile(file, 'not json');
    const store = new PreferencesStore(file);
    expect(store.load()).toEqual(DEFAULT_PREFERENCES);
  });

  it('merges with defaults — new fields fill in even when older file omits them', async () => {
    const file = join(ROOT, 'merge.json');
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        preferences: {
          notifications: { systemNotification: false },
          // no quietHours / cliPaths at all
        },
      }),
    );
    const store = new PreferencesStore(file);
    const loaded = store.load();
    expect(loaded.notifications.systemNotification).toBe(false);
    expect(loaded.notifications.soundCompleteId).toBe('chime'); // default kept
    expect(loaded.quietHours).toEqual(DEFAULT_PREFERENCES.quietHours);
    expect(loaded.cliPaths).toEqual(DEFAULT_PREFERENCES.cliPaths);
  });

  it('rejects invalid time strings in quietHours', async () => {
    const file = join(ROOT, 'bad-time.json');
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        preferences: {
          quietHours: { enabled: true, start: '25:99', end: 'abc' },
        },
      }),
    );
    const store = new PreferencesStore(file);
    const loaded = store.load();
    expect(loaded.quietHours.start).toBe(DEFAULT_PREFERENCES.quietHours.start);
    expect(loaded.quietHours.end).toBe(DEFAULT_PREFERENCES.quietHours.end);
  });

  it('reset() restores defaults and persists', async () => {
    const file = join(ROOT, 'reset.json');
    const store = new PreferencesStore(file);
    store.load();
    store.setAll({ ...DEFAULT_PREFERENCES, cliPaths: { claude: '/x', codex: '/y' } });
    store.reset();
    expect(store.get()).toEqual(DEFAULT_PREFERENCES);
    const raw = JSON.parse(await readFile(file, 'utf8'));
    expect(raw.preferences).toEqual(DEFAULT_PREFERENCES);
  });
});

describe('PreferencesStore.isQuietHoursNow', () => {
  function at(h: number, m: number = 0): Date {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  }
  function withQH(start: string, end: string, enabled = true): PreferencesStore {
    const store = new PreferencesStore(join(ROOT, `qh-${start}-${end}.json`));
    store.load();
    store.setAll({
      ...DEFAULT_PREFERENCES,
      quietHours: { enabled, start, end },
    });
    return store;
  }

  it('returns false when quiet hours disabled', () => {
    const store = withQH('00:00', '23:59', false);
    expect(store.isQuietHoursNow(at(12))).toBe(false);
  });

  it('handles same-day windows (e.g. 13:00–17:00)', () => {
    const store = withQH('13:00', '17:00');
    expect(store.isQuietHoursNow(at(12, 59))).toBe(false);
    expect(store.isQuietHoursNow(at(13, 0))).toBe(true);
    expect(store.isQuietHoursNow(at(16, 59))).toBe(true);
    expect(store.isQuietHoursNow(at(17, 0))).toBe(false);
  });

  it('handles overnight windows (e.g. 22:00–08:00)', () => {
    const store = withQH('22:00', '08:00');
    expect(store.isQuietHoursNow(at(21, 59))).toBe(false);
    expect(store.isQuietHoursNow(at(22, 0))).toBe(true);
    expect(store.isQuietHoursNow(at(3, 0))).toBe(true);
    expect(store.isQuietHoursNow(at(7, 59))).toBe(true);
    expect(store.isQuietHoursNow(at(8, 0))).toBe(false);
  });
});
