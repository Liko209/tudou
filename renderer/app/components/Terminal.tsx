'use client';

import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { Loader2 } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import { cn } from '../../lib/utils';
import { useUIStore } from '../../lib/stores/ui-store';
import { getXtermTheme } from '../../lib/xterm-theme';
import { attachMacKeyBindings } from '../../lib/xterm-mac-keybindings';

interface TerminalProps {
  sessionId: string;
}

/**
 * xterm.js wrapper bound to a SessionRegistry session.
 *
 * Mounted once per session (kept alive while the session exists, even when
 * not visible) so PTY scrollback accumulates and is preserved when the user
 * tabs away and comes back. The parent applies display:none/flex to switch
 * which terminal is on screen; we refit on visibility change via
 * ResizeObserver.
 */
export function Terminal({ sessionId }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const theme = useUIStore((s) => s.theme);
  // Visible until first byte of scrollback OR live data arrives, so the
  // user sees a spinner instead of a blank canvas while a freshly
  // resumed Claude process boots up (often 200-800ms).
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    const api = window.agentDashboard?.sessions;
    if (!container || !api) return;

    setLoading(true);
    const markLoaded = (): void => setLoading(false);

    const term = new XTerm({
      fontFamily: '"JetBrains Mono", "SF Mono", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      theme: getXtermTheme(),
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      macOptionIsMeta: true,
      // When the TUI (Claude/Codex) turns on mouse reporting, drag is sent to
      // the app and local text selection breaks. Let Option-drag (iTerm-style)
      // force a local selection; Shift-drag also works via xterm's built-in.
      macOptionClickForcesSelection: true,
      rightClickSelectsWord: true,
    });
    termRef.current = term;

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    const u11 = new Unicode11Addon();
    term.loadAddon(u11);
    term.unicode.activeVersion = '11';

    term.open(container);
    attachMacKeyBindings(term, (data) => void api.write(sessionId, data));

    // Only fit when the container has real dimensions (i.e. it's visible);
    // fitting a hidden container crashes xterm.
    const safeFit = (): void => {
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      try {
        const dims = fit.proposeDimensions();
        if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return;
        // Drop one column of slack. macOS overlay scrollbars report a width
        // of 0, so FitAddon over-counts columns and the floating scrollbar
        // ends up covering the rightmost glyph. The spare column gives it a
        // gutter to live in, so no text is ever clipped.
        const cols = Math.max(2, dims.cols - 1);
        const rows = Math.max(1, dims.rows);
        // Skip when unchanged. A redundant resize sends a SIGWINCH that makes
        // full-screen TUIs (Claude/Codex) repaint — the source of the flicker
        // and occasional corruption during pane drags / re-layout.
        if (cols === term.cols && rows === term.rows) return;
        term.resize(cols, rows);
        void api.resize(sessionId, cols, rows);
      } catch {
        // xterm sometimes throws on transient layout edge cases — ignore
      }
    };

    // First fit attempt — may noop if still hidden
    safeFit();
    term.focus();

    const dataSub = term.onData((data) => {
      void api.write(sessionId, data);
    });

    // Restore scrollback after a renderer reload: main keeps the PTY
    // alive but our xterm starts blank. Write the saved buffer first,
    // THEN subscribe to the live stream — this trades a tiny window
    // of data loss (anything emitted during the IPC roundtrip, ~1-5ms)
    // for guaranteed no-duplication of ANSI escape sequences, which
    // would otherwise corrupt the rendered screen.
    //
    // Defensive fallback for stale preload (e.g. method added after
    // main process was launched — only a full dev restart picks up
    // preload changes): subscribe directly when getScrollback is
    // missing rather than crashing the terminal.
    // Quiet-period detection for loader dismissal. The PTY has no
    // "I'm done booting" event, and term.onRender fires after the
    // very first frame — which for Claude is just a clear-screen +
    // cursor position, well before the visible banner/prompt arrive.
    // Debounce instead: each onData chunk resets a 150ms timer; when
    // it expires we conclude the boot output has settled and dismiss
    // the spinner. Hard ceiling of 3s for sessions that started idle
    // and emit nothing.
    let quietTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleFade = (): void => {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(markLoaded, 150);
    };

    let offData: (() => void) | null = null;
    const subscribe = (): void => {
      offData = api.onData((event) => {
        if (event.sessionId === sessionId) {
          term.write(event.data);
          scheduleFade();
        }
      });
    };
    if (typeof api.getScrollback === 'function') {
      void api.getScrollback(sessionId).then((snap) => {
        if (snap) {
          term.write(snap);
          scheduleFade();
        }
        // Subscribe regardless — when snap is empty (fresh spawn),
        // the first live byte from Claude starts the debounce window.
        subscribe();
      });
    } else {
      subscribe();
    }

    // Safety: if nothing emits in 3s we still drop the spinner so the
    // user isn't staring at it on a quiet session that started idle.
    const safetyTimer = setTimeout(markLoaded, 3000);

    // Coalesce resize bursts (drag, ResizeObserver + window resize firing
    // together) into one fit per frame so we don't thrash the PTY.
    let resizeRaf = 0;
    const handleResize = (): void => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        safeFit();
      });
    };
    window.addEventListener('resize', handleResize);

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      clearTimeout(safetyTimer);
      if (quietTimer) clearTimeout(quietTimer);
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      dataSub.dispose();
      offData?.();
      termRef.current = null;
      term.dispose();
    };
  }, [sessionId]);

  // Live-swap xterm colors when the user toggles dark/light/system.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const id = requestAnimationFrame(() => {
      try {
        term.options.theme = getXtermTheme();
      } catch {
        /* xterm may be mid-dispose */
      }
    });
    return () => cancelAnimationFrame(id);
  }, [theme]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <div
        aria-hidden={!loading}
        className={cn(
          'pointer-events-none absolute inset-0 flex items-center justify-center bg-canvas',
          'transition-opacity duration-200 ease-out',
          loading ? 'opacity-100' : 'opacity-0',
        )}
      >
        <Loader2 className="h-5 w-5 animate-spin text-muted" strokeWidth={1.75} />
      </div>
    </div>
  );
}
