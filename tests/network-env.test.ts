import { describe, expect, it } from 'vitest';
import {
  buildNetworkEnv,
  buildProxyTestArgs,
  type NetworkPreferences,
} from '../electron/network-env';

function net(over: Partial<NetworkPreferences> = {}): NetworkPreferences {
  return {
    proxy: { enabled: false, url: '', noProxy: '' },
    customEnv: [],
    ...over,
  };
}

describe('buildNetworkEnv', () => {
  it('returns empty when nothing is configured', () => {
    expect(buildNetworkEnv(net())).toEqual({});
  });

  it('expands an enabled proxy to upper- and lower-case vars', () => {
    const out = buildNetworkEnv(
      net({ proxy: { enabled: true, url: 'http://127.0.0.1:7890', noProxy: '' } }),
    );
    expect(out).toEqual({
      HTTP_PROXY: 'http://127.0.0.1:7890',
      HTTPS_PROXY: 'http://127.0.0.1:7890',
      ALL_PROXY: 'http://127.0.0.1:7890',
      http_proxy: 'http://127.0.0.1:7890',
      https_proxy: 'http://127.0.0.1:7890',
      all_proxy: 'http://127.0.0.1:7890',
    });
  });

  it('adds NO_PROXY (both cases) when provided', () => {
    const out = buildNetworkEnv(
      net({ proxy: { enabled: true, url: 'http://p:1', noProxy: 'localhost,127.0.0.1' } }),
    );
    expect(out.NO_PROXY).toBe('localhost,127.0.0.1');
    expect(out.no_proxy).toBe('localhost,127.0.0.1');
  });

  it('omits the proxy entirely when disabled', () => {
    const out = buildNetworkEnv(
      net({ proxy: { enabled: false, url: 'http://127.0.0.1:7890', noProxy: 'x' } }),
    );
    expect(out).toEqual({});
  });

  it('ignores a blank/whitespace url even when enabled', () => {
    expect(buildNetworkEnv(net({ proxy: { enabled: true, url: '   ', noProxy: '' } }))).toEqual({});
  });

  it('trims the proxy url and noProxy', () => {
    const out = buildNetworkEnv(
      net({ proxy: { enabled: true, url: '  http://p:1  ', noProxy: '  a,b  ' } }),
    );
    expect(out.HTTP_PROXY).toBe('http://p:1');
    expect(out.NO_PROXY).toBe('a,b');
  });

  it('applies enabled custom env vars', () => {
    const out = buildNetworkEnv(
      net({
        customEnv: [
          { key: 'ANTHROPIC_BASE_URL', value: 'https://x', enabled: true },
          { key: 'SKIPPED', value: 'no', enabled: false },
        ],
      }),
    );
    expect(out.ANTHROPIC_BASE_URL).toBe('https://x');
    expect('SKIPPED' in out).toBe(false);
  });

  it('drops custom entries with empty keys', () => {
    const out = buildNetworkEnv(
      net({ customEnv: [{ key: '   ', value: 'v', enabled: true }] }),
    );
    expect(out).toEqual({});
  });

  it('trims custom keys but keeps values verbatim', () => {
    const out = buildNetworkEnv(
      net({ customEnv: [{ key: '  FOO  ', value: '  spaced  ', enabled: true }] }),
    );
    expect(out.FOO).toBe('  spaced  ');
  });

  it('lets custom env override proxy-derived vars (custom wins)', () => {
    const out = buildNetworkEnv(
      net({
        proxy: { enabled: true, url: 'http://auto:1', noProxy: '' },
        customEnv: [{ key: 'HTTPS_PROXY', value: 'http://manual:2', enabled: true }],
      }),
    );
    expect(out.HTTPS_PROXY).toBe('http://manual:2');
    expect(out.HTTP_PROXY).toBe('http://auto:1'); // untouched
  });
});

describe('buildProxyTestArgs', () => {
  it('builds curl args that route through the proxy with timing output', () => {
    const args = buildProxyTestArgs('http://127.0.0.1:7890', 8);
    expect(args).toEqual([
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

  it('trims the url', () => {
    const args = buildProxyTestArgs('  http://p:1  ', 5);
    expect(args).toContain('http://p:1');
    expect(args).not.toContain('  http://p:1  ');
  });
});
