/**
 * Builds the extra environment a user wants injected into every spawned CLI —
 * the GUI equivalent of `export HTTPS_PROXY=… && claude`. A flat list of
 * key/value pairs the user controls explicitly (no hidden mapping): what they
 * type is exactly what gets exported. Pure (no I/O) so it's unit-testable; the
 * result is merged into the PTY env downstream by env-sanitizer.
 *
 * Lives in shared/ so both the Electron main (spawn injection) and the renderer
 * (settings UI helpers) import the same source of truth.
 */

export interface CustomEnvVar {
  key: string;
  value: string;
  /** Lets a user keep a var defined but temporarily inactive. */
  enabled: boolean;
}

export interface NetworkPreferences {
  customEnv: CustomEnvVar[];
}

/**
 * Common keys we pre-place (empty) so a user knows exactly what to fill in —
 * the proxy case is by far the most common reason to touch this screen.
 */
export const SUGGESTED_ENV_KEYS = [
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
] as const;

export const DEFAULT_NETWORK_PREFERENCES: NetworkPreferences = {
  customEnv: SUGGESTED_ENV_KEYS.map((key) => ({ key, value: '', enabled: true })),
};

/**
 * Map the configured vars to the env to inject. Only enabled entries with a
 * non-blank key AND a non-blank value are injected — a seeded-but-unfilled key
 * (e.g. NO_PROXY left empty) is skipped rather than exported as an empty var.
 */
export function buildNetworkEnv(net: NetworkPreferences): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of net.customEnv) {
    if (!v.enabled) continue;
    const key = v.key.trim();
    if (!key) continue;
    if (v.value.trim() === '') continue; // unfilled — don't export an empty var
    out[key] = v.value; // value kept verbatim — whitespace can be meaningful
  }
  return out;
}

// Priority order for "which value should the Test button probe".
const PROXY_URL_KEYS = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY'];

/**
 * Pick a proxy URL to test from the configured vars (case-insensitive key
 * match), preferring HTTPS_PROXY → HTTP_PROXY → ALL_PROXY. Returns null when
 * none is filled in.
 */
export function pickProxyUrl(customEnv: CustomEnvVar[]): string | null {
  for (const wanted of PROXY_URL_KEYS) {
    const hit = customEnv.find(
      (v) => v.enabled && v.key.trim().toUpperCase() === wanted && v.value.trim() !== '',
    );
    if (hit) return hit.value.trim();
  }
  return null;
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
