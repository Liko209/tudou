/**
 * Builds the extra environment a user wants injected into every spawned CLI —
 * the GUI equivalent of `export HTTPS_PROXY=… && claude`. Pure (no I/O) so the
 * mapping is unit-testable; the result is merged into the PTY env downstream by
 * env-sanitizer.
 */

export interface ProxyPreferences {
  /** Master switch: when false the proxy is not injected at all. */
  enabled: boolean;
  /** Proxy URL, e.g. `http://127.0.0.1:7890` or `socks5://…`. */
  url: string;
  /** Comma-separated hosts that bypass the proxy → NO_PROXY (optional). */
  noProxy: string;
}

export interface CustomEnvVar {
  key: string;
  value: string;
  /** Lets a user keep a var defined but temporarily inactive. */
  enabled: boolean;
}

export interface NetworkPreferences {
  proxy: ProxyPreferences;
  customEnv: CustomEnvVar[];
}

export const DEFAULT_NETWORK_PREFERENCES: NetworkPreferences = {
  proxy: { enabled: false, url: '', noProxy: '' },
  customEnv: [],
};

// Both cases are set because tooling is inconsistent: curl/git read lower-case,
// many libraries read upper-case, some read whichever they find first.
const PROXY_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY'] as const;

/**
 * Map a network config to the env vars to inject. Proxy vars come first; enabled
 * custom vars are applied last so a user can deliberately override a
 * proxy-derived var.
 */
export function buildNetworkEnv(net: NetworkPreferences): Record<string, string> {
  const out: Record<string, string> = {};

  if (net.proxy.enabled) {
    const url = net.proxy.url.trim();
    if (url) {
      for (const key of PROXY_KEYS) {
        out[key] = url;
        out[key.toLowerCase()] = url;
      }
      const noProxy = net.proxy.noProxy.trim();
      if (noProxy) {
        out.NO_PROXY = noProxy;
        out.no_proxy = noProxy;
      }
    }
  }

  for (const v of net.customEnv) {
    if (!v.enabled) continue;
    const key = v.key.trim();
    if (!key) continue;
    out[key] = v.value; // value kept verbatim — whitespace can be meaningful
  }

  return out;
}

/** Reachability probe target: returns 204 through a working proxy. */
export const PROXY_TEST_TARGET = 'https://www.google.com/generate_204';

/**
 * curl args that force a request through the given proxy and print
 * `<http_code> <time_total>` to stdout. Factored out so it's testable without
 * touching the network.
 */
export function buildProxyTestArgs(url: string, timeoutSec: number): string[] {
  return [
    '-sS',
    '-x',
    url.trim(),
    '-o',
    '/dev/null',
    '-w',
    '%{http_code} %{time_total}',
    '--max-time',
    String(timeoutSec),
    PROXY_TEST_TARGET,
  ];
}
