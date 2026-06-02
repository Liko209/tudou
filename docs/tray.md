# Menu-bar tray overhaul

Turn the tray from a thin decoration into a genuinely useful "glance + act"
surface for when Tudou's main window is hidden — the core of being a
menu-bar-resident companion to your terminal.

## Current state (baseline)

`LifecycleManager` owns the tray (`installTray` / `buildTrayMenu` / `refreshAll`):

- Template icon, recolored by macOS. Title text: `● N` when waiting, else total.
- Menu: header · waiting list (click → focus) · Show/Hide · Quit.
- `notifications.tray` pref only toggles the count TEXT, not the tray itself.
- Branding strings say "Agent Dashboard" (product is **Tudou**).
- `focusSession(id)` already raises the window + activates the session in the
  renderer (via `session:focus`) — a solid foundation to build clicks on.

## Goals

1. One-glance status from the menu bar (icon + tooltip), without opening anything.
2. A rich menu: all sessions grouped by state, quick actions, rate limits.
3. A popover mini-panel for a live, clickable overview without raising the main window.

---

## Architecture

### Pure model (testable)

Extract the menu/icon/tooltip computation into a pure module
`electron/tray-model.ts`, so the Electron wiring stays thin and the logic is
unit-tested:

```
buildTrayModel(sessions, { rateLimits, windowVisible }) → {
  iconVariant: 'idle' | 'attention',     // attention when any blocked/errored
  tooltip: string,                        // "2 waiting · 3 working"
  groups: { title, items: {id,label,status}[] }[],  // 🔴 needs you / ⏳ working / ✅ idle
  counts: { waiting, working, total },
}
```

`LifecycleManager` calls it and translates `groups` → `Menu.buildFromTemplate`,
and `iconVariant` → which `nativeImage` to set.

### Icon variants

- `idle`: the current monochrome **template** image (macOS recolors it).
- `attention`: a **non-template** tinted/badged variant (amber dot) so "someone
  needs you" is unmistakable even mid-glance. Both embedded as data URLs in
  `tray-icon.ts` (no bundled asset path, like today).

### Live data in `main`

The tray runs in `main`; it already observes `SessionRegistry`. For rate limits,
pass the existing `RateLimitTracker` into `LifecycleManager` (cheap, cached).
Today's cost (usage scan) is heavier — cache it and refresh at most every ~60s,
never on every session tick.

### Menu-staleness fix

Rebuild the menu on window `show`/`hide`/`minimize`/`restore` (not only on
session events), so "Show/Hide window" never goes stale.

---

## Companion popover window (the big piece)

A frameless, transparent, always-on-top `BrowserWindow` that behaves like a
native menu-bar popover.

- **Window**: `frame:false, transparent:true, resizable:false, skipTaskbar:true,
  alwaysOnTop:true, hiddenInMissionControl:true`, not shown in the dock, fixed
  size (~360×460). Created lazily on first open, then shown/hidden (not
  recreated).
- **Positioning**: on tray click, compute x/y from `tray.getBounds()` +
  `screen` work area so it sits centered under the icon; `show()`.
- **Dismiss**: `blur` → hide (popover semantics). Toggle on repeated tray clicks.
- **Content**: a SEPARATE Next route `renderer/app/tray/page.tsx` → exported as
  `tray/index.html`, loaded into the popover window. Reuses the same `preload`
  / `window.agentDashboard`. Renders a compact panel:
  - rate-limit bars (5h / weekly),
  - sessions list: status glyph · title · project · current tool, click → focus
    the session in the main window (raises it),
  - quick actions: New session · Open Usage · Open Settings.
- **Live data**: broadcast the session push channels (`session:add/update/remove`)
  to ALL windows instead of just the main one (small change in `ipc.ts`), so the
  popover updates instantly. Rate limits/usage fetched on open + light interval
  while visible.
- **Click model**: left-click tray → toggle popover; right-click (or
  ctrl-click) → the classic context menu. (Implemented via the `click` /
  `right-click` events + `popUpContextMenu`, NOT a permanently-set context menu.)

---

## Execution plan

**M1 — Tray polish** (no new windows)
- F1.1 `tray-model.ts` + tests (groups, tooltip, icon variant, counts).
- F1.2 Rebrand → Tudou; wire model into menu + icon-variant swap; dynamic tooltip.
- F1.3 Menu lists all sessions grouped; quick actions (New session / Open Usage /
  Open Settings); fix Show/Hide staleness (window event listeners).
- F1.4 New IPC as needed: open Usage / open Settings / open New-session in the
  renderer from the tray (main → renderer focus + route).

**M2 — Informative menu**
- F2.1 Rate-limit line (pass `RateLimitTracker` in) + tests on formatting.
- F2.2 Cached "today" usage line (≤60s refresh).
- F2.3 Per-session submenu (focus + current tool / last-activity); quiet-hours &
  notifications quick toggles (write through `PreferencesStore`).

**M3 — Companion popover**
- F3.1 Popover `BrowserWindow` lifecycle + tray-relative positioning + blur-hide
  + left/right click model.
- F3.2 `tray/` Next route + compact panel UI (rate limits, sessions, actions).
- F3.3 Broadcast session pushes to all windows; popover live updates; row click →
  focus in main window.
- F3.4 Polish: theme match, open/scroll, empty state, keyboard `Esc` to close.

Sequence M1 → M2 → M3; each is independently shippable. TDD the pure bits
(`tray-model`, formatters); the window/popover wiring is verified by a manual
smoke test.

## Resolved decisions

- **D1 → left-click opens the popover, right-click (or ctrl-click) opens the
  classic menu.** Both coexist; the menu is the lightweight text version, the
  popover the visual mini-panel.
- **D2 → build M1+M2+M3 then ship once.** No intermediate releases.
