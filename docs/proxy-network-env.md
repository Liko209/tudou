# Proxy / Network Environment Variables

> **Revision (v2 — unified env table).** The original dedicated proxy control
> (toggle + URL + NO_PROXY) was removed in favour of a single key/value
> environment-variable table, for two reasons surfaced by user feedback:
> 1. The bare "URL" field was opaque — users couldn't tell which env var it
>    mapped to.
> 2. A real bug: the proxy fields used a `BlurInput` whose `value` and `draft`
>    props were the same variable, so its `draft !== value` commit guard was
>    always false and the URL never persisted (the custom-env rows used a
>    correct local-draft-vs-prop pattern, which is why only they saved).
>
> The model is now **one flat `customEnv` list** the user controls explicitly
> (what you type is exactly what's exported). Common keys (`HTTPS_PROXY`,
> `HTTP_PROXY`, `ALL_PROXY`, `NO_PROXY`) are pre-seeded empty / offered as
> one-click chips. Edits live in a **local draft** and persist only on an
> explicit **Save** (with a "Saved" / "Unsaved changes" indicator); **Cancel**
> reverts. The **Test proxy** button derives its URL from the proxy keys in the
> table (`pickProxyUrl`). The pure helpers moved to `shared/network-env.ts` so
> the renderer and main share one source of truth, and are covered by unit tests
> plus a jsdom component test (`tests/network-section-ui.test.tsx`) that guards
> the Save-persists / Cancel-reverts behaviour. Sections below describe the
> original v1 design for history.

## Problem

Users who run `claude` and `codex` behind an HTTP proxy normally `export
HTTPS_PROXY=...` (or wrap the binary in a shell alias) before launching. The
dashboard spawns those CLIs as child processes via `node-pty`, inheriting only
the env the dashboard itself was launched with — so the proxy is **not** carried
through and the spawned CLI can't reach the network the way the user expects.

We add a Settings section that lets the user configure a proxy (and arbitrary
extra env vars) once; the dashboard then injects them into every CLI it spawns —
the GUI equivalent of an `export`-prefixing alias.

## Scope (confirmed with user)

- **Global**, not per-CLI: one config applies to both `claude` and `codex`.
- A dedicated **proxy** control (toggle + URL + optional NO_PROXY) that expands
  to the standard proxy env vars in both upper- and lower-case.
- A general **custom env** key/value table for everything else
  (`ANTHROPIC_BASE_URL`, custom CA paths, etc.).
- A **"Test proxy"** button that reports reachability + latency.

## Data model

Added to `Preferences` (`electron/preferences.ts`):

```ts
network: {
  proxy: {
    enabled: boolean;   // master switch for proxy injection
    url: string;        // e.g. http://127.0.0.1:7890  (socks5://… also fine)
    noProxy: string;    // comma-separated hosts, → NO_PROXY (optional)
  };
  customEnv: Array<{
    key: string;
    value: string;
    enabled: boolean;   // lets a user keep a var defined but inactive
  }>;
}
```

Defaults: proxy disabled, empty url/noProxy, empty customEnv list.

`mergeWithDefaults()` validates the section defensively (older preference files
omit it; malformed entries are dropped) the same way the existing sections do.

## Env mapping (`electron/network-env.ts`, pure)

`buildNetworkEnv(network) → Record<string,string>`

1. If `proxy.enabled` and `proxy.url` is non-empty (trimmed):
   - `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` = url
   - lower-case `http_proxy`, `https_proxy`, `all_proxy` = url
     (curl/git honor lower-case; many tools differ — set both)
   - If `noProxy` non-empty: `NO_PROXY` and `no_proxy` = noProxy
2. For each `customEnv` entry that is `enabled` and has a non-empty trimmed key:
   `out[key] = value`. **Custom vars are applied last**, so a user can override
   a proxy-derived var deliberately.

Pure and side-effect free → unit-tested directly.

## Injection flow

```
Settings UI ──save──▶ PreferencesStore (preferences.json)
                              │
session:spawn (renderer)──────▼
  ipc.ts sessionSpawn handler
    extraEnv = buildNetworkEnv(preferences.get().network)
    registry.spawn({ …, extraEnv })
        │
        ▼
  session-registry.spawn
    env = sanitizeSpawnEnv(process.env, { theme, extraEnv })
        │
        ▼
  env-sanitizer.sanitizeSpawnEnv
    strip wrapper prefixes → apply theme COLORFGBG → MERGE extraEnv (wins)
        │
        ▼
  pty.spawn({ env })  → claude / codex sees the proxy
```

Key decisions:
- The renderer never sends proxy data in the spawn request; the **main process
  reads it from saved prefs at spawn time**. (Single source of truth; nothing
  secret crosses IPC on every spawn.)
- `extraEnv` is merged **after** the wrapper-strip and theme steps in
  `sanitizeSpawnEnv`, so user config has the final say but the existing
  nesting-protection still runs first.

## Connectivity test

- IPC channel `network:test-proxy`.
- Renderer calls `window.agentDashboard.network.testProxy({ url, noProxy })`
  with the **currently-entered** values (may be unsaved) so the user can test
  before committing.
- Main handler shells out to `curl` (ships with macOS; this app is mac-only and
  curl mirrors the exact proxy code path the CLIs use) via `execFile` (no shell,
  args array → injection-safe):
  `curl -sS -x <url> -o /dev/null -w "%{http_code} %{time_total}" --max-time 8 <target>`
  - Target: `https://www.google.com/generate_204` (canonical "is my proxy up"
    check; returns 204 through a working proxy).
  - Result `{ ok, status?, ms?, error? }`. `ok` = curl exit 0 and a non-`000`
    HTTP code. Any HTTP status proves the tunnel works.
- The curl-args assembly is factored into a pure helper so it's unit-testable
  without hitting the network.

## UI (`renderer/app/components/SettingsView.tsx`)

New `network` section + left-nav entry ("Network"), placed after CLI & Hooks:

- **Use a proxy** checkbox → toggles `proxy.enabled`.
- Proxy **URL** text input (disabled when off) + **No-proxy** input.
- **Test** button: spinner while running, then a green "204 · 0.5s" style result
  or a red error line.
- **Custom environment variables** table: rows of [enabled checkbox][key][value]
  [remove], plus an "Add variable" button.
- Saves via the existing `preferences.set` debounce-on-blur pattern (reuse the
  `PathRow` blur-commit approach for text fields).

The "Reset preferences" copy in the Data section is updated to mention network
settings.

## Modules / Features (execution plan)

| Module | Features | Verify |
| --- | --- | --- |
| **M1** network-env builder | `buildNetworkEnv`, `buildProxyTestArgs` (pure) | `vitest run network-env` green |
| **M2** preferences schema | type + defaults + `mergeWithDefaults` validation | `vitest run preferences` green |
| **M3** env injection | `sanitizeSpawnEnv` extraEnv; thread `SpawnSessionRequest.extraEnv`; wire ipc spawn | `vitest run env-sanitizer session-registry` green |
| **M4** connectivity IPC | channel + main handler + preload bridge | typecheck; manual curl path |
| **M5** Settings UI | network section, proxy controls, env table, test button | typecheck + manual smoke |
| **M6** integration | full `npm test`, `npm run typecheck`, `npm run lint` | all green |

## Test strategy

- Pure logic (M1, M2, M3 sanitizer) → fast unit tests, no mocks.
- Connectivity handler (M4) → unit-test the pure curl-arg builder; the actual
  network call is verified manually (can't unit-test real proxy reachability
  deterministically).
- UI (M5) → typecheck + manual smoke (no component test infra for this view).
```

