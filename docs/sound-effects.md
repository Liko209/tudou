# Sound effects for session state changes

## Goal

Play a short audio cue when a session changes to a state that wants the user:

- **`waiting`** (turn finished / your turn) → a soft **"complete"** chime.
- **`blocked`** (needs permission or a choice) → a more attention-grabbing **"alert"** ping.

Two distinct sounds. `errored` reuses the alert sound (it also needs attention).

## Free, redistributable sound libraries

We ship the audio inside the app, so the license must allow **redistribution + commercial use**. Best options:

| Library | License | Notes |
|---|---|---|
| **Kenney.nl** — "Interface Sounds" / "UI Audio" | **CC0** (public domain) | Safest for bundling; tiny UI blips/chimes. Top pick. |
| **Pixabay** (pixabay.com/sound-effects) | Pixabay license — royalty-free, **no attribution**, commercial OK | Big "notification"/"bell" selection. |
| **Mixkit** (mixkit.co/free-sound-effects) | Mixkit Free license — **no attribution** | Curated notification/UI sounds. |
| **Freesound.org** | per-sound — **filter to CC0** | Huge; just avoid the attribution-required ones. |
| notificationsounds.com | CC | Notification-focused. |

**Plan:** bundle two CC0 files from Kenney/Pixabay (~5–25 KB each) so there are zero attribution/runtime-fetch obligations. Source URLs recorded in `renderer/public/sounds/CREDITS.md`.

## Architecture

The decision of *when* to alert already lives in `main` (`LifecycleManager`), driven by the hook pipeline. We reuse that — `main` decides, the `renderer` plays (only the renderer has an audio context).

```
SessionRegistry --attention(session)--> LifecycleManager.notify(session)
        (Stop→waiting, PermissionRequest/Notification→blocked)
                                   |
                  gate: prefs.notifications.sound
                        && !quietHours && !foreground
                                   |
                 window.webContents.send('sound:play', { kind })
                                   v
        renderer useSoundEffects() --> HTMLAudioElement.play()
```

- `notify()` is already called exactly at the moments we care about (one per transition, hook-confirmed — no flicker). We add a single `webContents.send` there.
- Mapping: `waiting → 'complete'`, `blocked`/`errored → 'alert'`.
- The OS `Notification` becomes `silent: true` always — we own the sound now, so no double-beep.

## Key decisions / trade-offs

1. **Trigger in `main.notify()`, play in `renderer`.** Keeps a single source of truth for "should we alert" (prefs, quiet hours, foreground) and avoids duplicating transition detection in the renderer. Renderer is a dumb player.
2. **Gate = existing `sound` pref + quiet hours + background-only.** Matches today's "Sound when in background" label; no new surprising behavior. (Open question below.)
3. **Bundle assets in `renderer/public/sounds/`, reference relative to the document.** `assetPrefix: './'` + `output: 'export'` means a relative URL (`new URL('sounds/x.mp3', location.href)`) resolves under both `file://` (prod) and `localhost` (dev). No webpack asset-loader config needed.
4. **`webPreferences.autoplayPolicy = 'no-user-gesture-required'`.** Chromium otherwise blocks programmatic `audio.play()` until a user gesture. A desktop app alerting the user is the intended case.
5. **Settings preview button** per sound so the user can hear them (and it doubles as a guaranteed user gesture).

## Execution plan

**M1 — Sound playback (single module)**

- **F1.1** IPC contract: `IpcChannels.soundPlay` + `sound.onPlay(cb)` in preload + types.
- **F1.2** `main`: `LifecycleManager.notify()` sends `soundPlay`; set `autoplayPolicy`; make Notification silent.  *Test: fake window/registry — asserts the right `kind` is sent for waiting/blocked/errored, suppressed when pref off / quiet hours / foreground.*
- **F1.3** `renderer`: `useSoundEffects()` hook (cached `Audio` per kind) wired in `AppShell`; bundle the two CC0 files + CREDITS.
- **F1.4** Settings: small "Preview" play buttons beside the sound toggle.

## Resolved decisions

- **Q1 Foreground behavior → "background + foreground non-active session".** Sound plays whenever the app is unfocused, AND when a session *other than the one you're watching* changes while focused. It is suppressed ONLY when the **active** session changes while the app is focused (you can see that yourself). → `main` must know the active session id (renderer reports it via `session:set-active`); it already knows focus via `window.isFocused()`.
- **Q2 Granularity → user-selectable per cue (built-in picker).** Each cue stores a chosen catalog id (or `'off'`): `notifications.soundCompleteId` / `notifications.soundAlertId`. Settings shows a dropdown per cue (Off + the catalog) with a Preview button. The catalog lives in `shared/sound-catalog.ts`; "enabled" = id !== 'off' (the `decideSound` policy still takes booleans, so it's unchanged). Defaults: `chime` / `double`.
- **Q3 Assets → bundle a synthesized catalog.** `scripts/gen-sounds.mjs` emits one `<kind>-<id>.wav` per catalog entry (complete: chime/soft/marimba/arp/bell; alert: double/triple/knock/pingpong) — all original/license-free. Main resolves the chosen id and sends it in the `soundPlay` payload (`{ kind, id }`); the renderer plays `sounds/<kind>-<id>.wav`. Swap any file (keep the name) for a CC0 clip from the libraries above.

## Gating (final)

```
kind   = waiting → 'complete' ; blocked|errored → 'alert'
enabled = kind==='complete' ? prefs.soundComplete : prefs.soundAlert
play    = enabled && !quietHours && !(isForeground && session.id === activeId)
```

The pure decision (`soundKindFor`, `shouldPlaySound`) lives in `electron/sound-policy.ts` and is unit-tested; `LifecycleManager.notify()` is a thin caller that does the `webContents.send`. The OS `Notification` is now always `silent: true` (we own the sound).
