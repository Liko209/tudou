# In-app Keyboard Shortcuts Cheat Sheet

## Goal

The app supports ~26 keyboard shortcuts but exposes none of them in the UI —
users have to read source or docs. Add a cheat-sheet overlay, opened with **⌘/**
(and closed with ⌘/ again or Esc), that lists every shortcut grouped by scope.

## Design

```
⌘/ (use-keyboard-shortcuts hook) ──toggle──▶ ui-store.shortcutsOpen
                                                      │
AppShell renders <ShortcutsModal /> ◀─────────────────┘
   reads shortcutsOpen → <Modal open=…>  (Esc-to-close is built into Modal)
   body = SHORTCUT_GROUPS.map(group → section of rows)
                              ▲
              renderer/lib/shortcuts-catalog.ts  (single source of truth)
```

### Single source of truth — `renderer/lib/shortcuts-catalog.ts`

```ts
export interface ShortcutItem {
  keys: string[];      // chips rendered side by side, e.g. ['⌘', '⇧', 'B']
  description: string; // what it does
}
export interface ShortcutGroup {
  title: string;       // 'Global', 'Terminal', …
  items: ShortcutItem[];
}
export const SHORTCUT_GROUPS: ShortcutGroup[];
```

Pure data → unit-tested (well-formed: non-empty keys + description, no blank
chips, and the cheat-sheet's own ⌘/ entry is present). When a new shortcut is
added elsewhere, this catalog is the one place to update.

Groups & contents mirror the audited inventory:
- **Global** — ⌘B, ⌘⇧B, ⌘⌥B, ⌘\, ⌘N, ⌘⇧N, ⌘T, ⌘W, ⌘1–9, ⌘/ (this panel)
- **Terminal** — ⇧Enter, ⌘←, ⌘→, ⌘⌫, ⌥←, ⌥→, ⌥⌫
- **Compose draft** — ⌘E, ⌘Enter, Esc
- **Windows & editing** — Esc (close dialog/sheet/popover), Enter / Esc (rename),
  Arrow keys (resize focused divider; ⇧ = larger step)
- **System** — ⌘Q, ⌘C/⌘V/⌘X/⌘A (Electron defaults)

### State — `ui-store`

Add `shortcutsOpen: boolean` + `setShortcutsOpen(open)`. No mutual-exclusion
needed (it's a lightweight overlay layered above everything via Modal's z-50).

### Trigger — `use-keyboard-shortcuts.ts`

Add, inside the existing `meta` guard: `e.code === 'Slash'` → `preventDefault` +
toggle `shortcutsOpen`. Consistent with the other ⌘-based global shortcuts;
match on `e.code` so layout/Option quirks don't matter.

### View — `renderer/app/components/ShortcutsModal.tsx`

`<Modal open={shortcutsOpen} onClose={…} title="Keyboard shortcuts">` containing
a two-column list per group: description on the left, `<kbd>` chips on the right.
A small `<Kbd>` helper styles each chip (rounded border, mono, bg-sunken).
Mounted in `AppShell` next to `<NewSessionModal />`.

## Modules

| Module | Work | Verify |
| --- | --- | --- |
| **M1** catalog | `shortcuts-catalog.ts` + test | `vitest run shortcuts-catalog` green |
| **M2** state | `shortcutsOpen` in ui-store | typecheck |
| **M3** trigger | ⌘/ in the keyboard hook | typecheck |
| **M4** view | `ShortcutsModal` + AppShell mount | typecheck + manual smoke |
| **M5** verify | full test + typecheck + lint | all green |

## Test strategy

- Catalog (M1) → unit test the data shape (pure, deterministic).
- State/trigger/view → typecheck + manual smoke (no component-test infra for the
  shell; the hook mutates a zustand store via real key events).
