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

  it('persists the network custom env list', async () => {
    const file = join(ROOT, 'network.json');
    const writer = new PreferencesStore(file);
    writer.load();
    writer.setAll({
      ...DEFAULT_PREFERENCES,
      network: {
        customEnv: [{ key: 'HTTPS_PROXY', value: 'http://127.0.0.1:7890', enabled: true }],
      },
    });
    const loaded = new PreferencesStore(file).load();
    expect(loaded.network.customEnv).toEqual([
      { key: 'HTTPS_PROXY', value: 'http://127.0.0.1:7890', enabled: true },
    ]);
  });

  it('seeds the suggested keys when an older file omits the network section', async () => {
    const file = join(ROOT, 'no-network.json');
    await writeFile(
      file,
      JSON.stringify({ version: 1, preferences: { notifications: { tray: false } } }),
    );
    const loaded = new PreferencesStore(file).load();
    expect(loaded.network).toEqual(DEFAULT_PREFERENCES.network);
  });

  it('keeps an explicitly empty custom env list (user cleared it)', async () => {
    const file = join(ROOT, 'empty-network.json');
    await writeFile(
      file,
      JSON.stringify({ version: 1, preferences: { network: { customEnv: [] } } }),
    );
    const loaded = new PreferencesStore(file).load();
    expect(loaded.network.customEnv).toEqual([]);
  });

  it('ignores a legacy proxy object and sanitizes malformed env entries', async () => {
    const file = join(ROOT, 'bad-network.json');
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        preferences: {
          network: {
            proxy: { enabled: true, url: 'http://legacy' }, // legacy field → ignored
            customEnv: [
              { key: 'OK', value: 'v', enabled: true },
              { key: 42, value: 'x', enabled: true }, // bad key → dropped
              'garbage', // not an object → dropped
              { key: 'NOVAL', enabled: true }, // missing value → defaults to ''
            ],
          },
        },
      }),
    );
    const loaded = new PreferencesStore(file).load();
    expect('proxy' in loaded.network).toBe(false);
    expect(loaded.network.customEnv).toEqual([
      { key: 'OK', value: 'v', enabled: true },
      { key: 'NOVAL', value: '', enabled: true },
    ]);
  });

  it('defaults hiddenProjects to an empty list', () => {
    const store = new PreferencesStore(join(ROOT, 'hidden-default.json'));
    expect(store.load().hiddenProjects).toEqual([]);
  });

  it('persists hiddenProjects and survives a fresh instance', () => {
    const file = join(ROOT, 'hidden-persist.json');
    const writer = new PreferencesStore(file);
    writer.load();
    writer.setAll({
      ...DEFAULT_PREFERENCES,
      hiddenProjects: ['/Users/me/work/alpha', '/Users/me/work/beta'],
    });
    const loaded = new PreferencesStore(file).load();
    expect(loaded.hiddenProjects).toEqual(['/Users/me/work/alpha', '/Users/me/work/beta']);
  });

  it('sanitizes hiddenProjects — drops non-strings and de-dupes', async () => {
    const file = join(ROOT, 'hidden-bad.json');
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        preferences: {
          hiddenProjects: ['/a', '/a', 42, '/b', null, '/b'],
        },
      }),
    );
    const loaded = new PreferencesStore(file).load();
    expect(loaded.hiddenProjects).toEqual(['/a', '/b']);
  });

  it('seeds an empty hiddenProjects when an older file omits it', async () => {
    const file = join(ROOT, 'hidden-missing.json');
    await writeFile(
      file,
      JSON.stringify({ version: 1, preferences: { notifications: { tray: false } } }),
    );
    expect(new PreferencesStore(file).load().hiddenProjects).toEqual([]);
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
