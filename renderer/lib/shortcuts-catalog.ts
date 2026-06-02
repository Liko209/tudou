/**
 * Single source of truth for the in-app keyboard cheat sheet (⌘/).
 *
 * Each `keys` entry is a list of chips rendered side by side, e.g.
 * `['⌘', '⇧', 'B']` → ⌘ ⇧ B. When you add or change a shortcut elsewhere
 * (use-keyboard-shortcuts.ts, xterm-mac-keybindings.ts, a modal handler),
 * update the matching entry here so the cheat sheet stays accurate.
 */

export interface ShortcutItem {
  /** Key chips shown together for this binding. */
  keys: string[];
  /** What the binding does. */
  description: string;
}

export interface ShortcutGroup {
  title: string;
  items: ShortcutItem[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Global',
    items: [
      { keys: ['⌘', 'B'], description: 'Toggle the left sidebar' },
      { keys: ['⌘', '⇧', 'B'], description: 'Toggle the right panel (current session)' },
      { keys: ['⌘', '⌥', 'B'], description: 'Toggle the bottom panel (current session)' },
      { keys: ['⌘', 'N'], description: 'New session in the current project' },
      { keys: ['⌘', '⇧', 'N'], description: 'New chat (generic)' },
      { keys: ['⌘', 'T'], description: 'Open the New Session dialog' },
      { keys: ['⌘', 'W'], description: 'Close the active session (confirms if running)' },
      { keys: ['⌘', '1–9'], description: 'Jump to the Nth session (by activity)' },
      { keys: ['⌘', '/'], description: 'Show / hide this shortcut sheet' },
    ],
  },
  {
    title: 'Terminal',
    items: [
      { keys: ['⇧', 'Enter'], description: 'Soft newline (line continuation)' },
      { keys: ['⌘', '←'], description: 'Jump to start of line' },
      { keys: ['⌘', '→'], description: 'Jump to end of line' },
      { keys: ['⌘', '⌫'], description: 'Delete to start of line' },
      { keys: ['⌥', '←'], description: 'Move back one word' },
      { keys: ['⌥', '→'], description: 'Move forward one word' },
      { keys: ['⌥', '⌫'], description: 'Delete the previous word' },
    ],
  },
  {
    title: 'Compose draft',
    items: [
      { keys: ['⌘', 'E'], description: 'Open / close the compose draft box' },
      { keys: ['⌘', 'Enter'], description: 'Insert the draft into the CLI input (review, then send)' },
      { keys: ['Esc'], description: 'Collapse the draft box (keeps the draft)' },
    ],
  },
  {
    title: 'Windows & editing',
    items: [
      { keys: ['Esc'], description: 'Close a dialog, info sheet, or the tray popover' },
      { keys: ['Enter'], description: 'Confirm a session rename' },
      { keys: ['Esc'], description: 'Cancel a session rename' },
      { keys: ['←', '→', '↑', '↓'], description: 'Resize a focused divider (⇧ for a bigger step)' },
    ],
  },
  {
    title: 'System',
    items: [
      { keys: ['⌘', 'Q'], description: 'Quit Tudou (confirms if sessions are running)' },
      { keys: ['⌘', 'C'], description: 'Copy' },
      { keys: ['⌘', 'V'], description: 'Paste' },
      { keys: ['⌘', 'A'], description: 'Select all' },
    ],
  },
];
