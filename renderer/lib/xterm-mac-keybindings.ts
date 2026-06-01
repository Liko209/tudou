import type { Terminal as XTerm } from '@xterm/xterm';

export type WriteFn = (data: string) => void;

/**
 * Attach macOS-style keybindings to an xterm instance so it behaves
 * like Ghostty / iTerm2 / Terminal.app instead of a vanilla xterm.
 *
 * Without this, Cmd+Left/Right/Backspace and Option+Left/Right do
 * nothing, and Shift+Enter submits the prompt instead of inserting
 * a newline — which breaks multi-line input in Claude Code.
 *
 * The sequences we send are standard readline / line-editor controls
 * understood by bash, zsh, and most TUI input libraries.
 *
 * | Combo            | Sent                 | Effect                       |
 * |------------------|----------------------|------------------------------|
 * | Shift+Enter      | `\\` + CR (\\\r)     | Soft newline — Claude treats trailing `\\` + Enter as shell-style line continuation and inserts a soft newline in the input box |
 * | Cmd+Left         | C-a (\x01)           | Start of line                |
 * | Cmd+Right        | C-e (\x05)           | End of line                  |
 * | Cmd+Backspace    | C-u (\x15)           | Kill line backward           |
 * | Option+Left      | ESC b (\x1bb)        | Previous word                |
 * | Option+Right     | ESC f (\x1bf)        | Next word                    |
 * | Option+Backspace | C-w (\x17)           | Delete previous word         |
 */
export function attachMacKeyBindings(term: XTerm, write: WriteFn): void {
  term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
    // Only intercept keydown — keyup/press would double-fire.
    if (event.type !== 'keydown') return true;
    const { key, metaKey, altKey, shiftKey, ctrlKey } = event;

    // Shift+Enter → emit backslash then CR, mimicking the manual
    // "type `\` then Enter" pattern Claude Code uses as its
    // shell-style line-continuation trigger. Sending raw LF doesn't
    // work — Claude's input parser ignores it.
    if (key === 'Enter' && shiftKey && !metaKey && !altKey && !ctrlKey) {
      event.preventDefault();
      write('\\\r');
      return false;
    }

    // Cmd + arrow / backspace → line-level readline ops
    if (metaKey && !ctrlKey && !shiftKey) {
      if (key === 'ArrowLeft') {
        write('\x01');
        return false;
      }
      if (key === 'ArrowRight') {
        write('\x05');
        return false;
      }
      if (key === 'Backspace') {
        write('\x15');
        return false;
      }
    }

    // Option (Alt) + arrow / backspace → word-level readline ops
    if (altKey && !metaKey && !ctrlKey && !shiftKey) {
      if (key === 'ArrowLeft') {
        write('\x1bb');
        return false;
      }
      if (key === 'ArrowRight') {
        write('\x1bf');
        return false;
      }
      if (key === 'Backspace') {
        write('\x17');
        return false;
      }
    }

    return true; // let xterm handle anything else
  });

  attachPasteHandler(term, write);
}

/**
 * Route clipboard pastes through bracketed-paste so multi-line content
 * (e.g. a message copied out of Slack) lands in the TUI as ONE paste
 * instead of a run of Enter presses that submit each line — the bug where
 * pasting a multi-line prompt into the embedded terminal fired it off
 * line by line.
 *
 * xterm only brackets a paste when it has *observed* the app enable
 * DECSET ?2004 (bracketed-paste mode). That observation is lost when a
 * fresh xterm is rehydrated from a trimmed scrollback snapshot after a
 * reload, so we force-bracket any multi-line paste ourselves: claude /
 * codex (and modern zsh/bash) are always in bracketed-paste mode at their
 * prompt, so the wrapping is safe.
 */
function attachPasteHandler(term: XTerm, write: WriteFn): void {
  const textarea = term.textarea;
  if (!textarea) return;
  textarea.addEventListener(
    'paste',
    (ev) => {
      const raw = ev.clipboardData?.getData('text');
      if (!raw) return; // nothing usable — let xterm no-op
      ev.preventDefault();
      ev.stopImmediatePropagation(); // beat xterm's own paste handler (no double-wrap)
      const text = raw.replace(/\r\n?/g, '\n'); // normalize CRLF / lone CR → LF
      const bracket = text.includes('\n') || term.modes.bracketedPasteMode;
      write(bracket ? `\x1b[200~${text}\x1b[201~` : text);
    },
    true, // capture phase, so we run before xterm's bubble-phase listener
  );
}
