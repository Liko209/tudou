import { describe, expect, it } from 'vitest';
import {
  buildNetworkEnv,
  buildProxyTestArgs,
  DEFAULT_NETWORK_PREFERENCES,
  pickProxyUrl,
  SUGGESTED_ENV_KEYS,
  type CustomEnvVar,
  type NetworkPreferences,
} from '../shared/network-env';

function net(customEnv: CustomEnvVar[] = []): NetworkPreferences {
  return { customEnv };
}
function v(key: string, value: string, enabled = true): CustomEnvVar {
  return { key, value, enabled };
}

describe('DEFAULT_NETWORK_PREFERENCES', () => {
  it('seeds the suggested keys with empty values so users just fill them in', () => {
    expect(DEFAULT_NETWORK_PREFERENCES.customEnv.map((e) => e.key)).toEqual([
      ...SUGGESTED_ENV_KEYS,
    ]);
    for (const e of DEFAULT_NETWORK_PREFERENCES.customEnv) {
      expect(e.value).toBe('');
      expect(e.enabled).toBe(true);
    }
  });
});

describe('buildNetworkEnv', () => {
  it('returns empty for no vars', () => {
    expect(buildNetworkEnv(net())).toEqual({});
  });

  it('injects enabled vars with a value', () => {
    const out = buildNetworkEnv(net([v('HTTPS_PROXY', 'http://127.0.0.1:7890')]));
    expect(out).toEqual({ HTTPS_PROXY: 'http://127.0.0.1:7890' });
  });

  it('skips entries whose value is blank (seeded-but-unfilled keys)', () => {
    const out = buildNetworkEnv(net([v('HTTPS_PROXY', ''), v('HTTP_PROXY', '   ')]));
    expect(out).toEqual({});
  });

  it('skips disabled entries', () => {
    expect(buildNetworkEnv(net([v('FOO', 'bar', false)]))).toEqual({});
  });

  it('drops entries with empty keys', () => {
    expect(buildNetworkEnv(net([v('  ', 'bar')]))).toEqual({});
  });

  it('trims keys but keeps values verbatim', () => {
    const out = buildNetworkEnv(net([v('  FOO  ', '  spaced  ')]));
    expect(out.FOO).toBe('  spaced  ');
  });

  it('injects exactly what the user typed (no auto case-mirroring or magic)', () => {
    const out = buildNetworkEnv(net([v('ANTHROPIC_BASE_URL', 'https://x')]));
    expect(out).toEqual({ ANTHROPIC_BASE_URL: 'https://x' });
  });
});

describe('pickProxyUrl', () => {
  it('returns null when no proxy var is filled', () => {
    expect(pickProxyUrl([])).toBeNull();
    expect(pickProxyUrl([v('HTTPS_PROXY', '')])).toBeNull();
  });

  it('prefers HTTPS_PROXY, then HTTP_PROXY, then ALL_PROXY', () => {
    expect(
      pickProxyUrl([v('ALL_PROXY', 'http://all'), v('HTTP_PROXY', 'http://http'), v('HTTPS_PROXY', 'http://https')]),
    ).toBe('http://https');
    expect(pickProxyUrl([v('ALL_PROXY', 'http://all'), v('HTTP_PROXY', 'http://http')])).toBe('http://http');
    expect(pickProxyUrl([v('ALL_PROXY', 'http://all')])).toBe('http://all');
  });

  it('matches the key case-insensitively and trims the value', () => {
    expect(pickProxyUrl([v('https_proxy', '  http://p:1  ')])).toBe('http://p:1');
  });

  it('ignores disabled proxy entries', () => {
    expect(pickProxyUrl([v('HTTPS_PROXY', 'http://p:1', false)])).toBeNull();
  });
});

describe('buildProxyTestArgs', () => {
  it('builds curl args that route through the proxy with timing output', () => {
    expect(buildProxyTestArgs('http://127.0.0.1:7890', 8)).toEqual([
      '-sS',
      '-x',
      'http://127.0.0.1:7890',
      '-o',
      '/dev/null',
      '-w',
      '%{http_code} %{time_total}',
      '--max-time',
      '8',
      'https://www.google.com/generate_204',
    ]);
  });
});
