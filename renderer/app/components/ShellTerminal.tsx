'use client';

import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { useUIStore } from '../../lib/stores/ui-store';
import { getXtermTheme } from '../../lib/xterm-theme';
import { attachMacKeyBindings } from '../../lib/xterm-mac-keybindings';

interface ShellTerminalProps {
  /** Optional cwd; defaults to home. */
  cwd?: string;
}

/**
 * Generic shell PTY rendered into xterm.js, used inside dock panels
 * (Terminal panel). Distinct from the main Terminal component which is
 * bound to a SessionRegistry session — this one talks directly to the
 * low-level pty:* IPC so it doesn't show up as a Session in the sidebar.
 */
export function ShellTerminal({ cwd }: ShellTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const theme = useUIStore((s) => s.theme);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const ptyApi = window.agentDashboard?.pty;
    const env = window.agentDashboard?.env;
    if (!container || !ptyApi || !env) return;

    const shell = env.shell();
    let ptyId: string | null = null;
    let term: XTerm | null = null;
    let offData: (() => void) | null = null;
    let offExit: (() => void) | null = null;
    let dataSub: { dispose: () => void } | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let onWindowResize: (() => void) | null = null;
    let disposed = false;
    let resizeRaf = 0;

    void (async () => {
      try {
        ptyId = await ptyApi.spawn({
          shell,
          args: ['-l'],
          cwd: cwd ?? env.homedir(),
          cols: 100,
          rows: 24,
        });
        if (disposed || !ptyId) return;

        term = new XTerm({
          fontFamily: '"JetBrains Mono", "SF Mono", Menlo, monospace',
          fontSize: 13,
          lineHeight: 1.25,
          theme: getXtermTheme(),
          cursorBlink: true,
          allowProposedApi: true,
          scrollback: 2000,
          macOptionIsMeta: true,
          // Option-drag forces a local selection even when the program turns
          // on mouse reporting (Shift-drag also works). See Terminal.tsx.
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
        // GPU renderer (fixes CJK clipping); DOM fallback if unavailable.
        try {
          const webgl = new WebglAddon();
          webgl.onContextLoss(() => webgl.dispose());
          term.loadAddon(webgl);
        } catch {
          /* no WebGL — DOM renderer stays */
        }
        attachMacKeyBindings(term, (data) => {
          if (ptyId) void ptyApi.write(ptyId, data);
        });

        const safeFit = (): void => {
          if (!container || container.clientWidth === 0 || container.clientHeight === 0) return;
          try {
            const dims = fit.proposeDimensions();
            if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return;
            // One column of slack so the macOS overlay scrollbar (reported
            // width 0) doesn't cover the rightmost glyph. See Terminal.tsx.
            const cols = Math.max(2, dims.cols - 1);
            const rows = Math.max(1, dims.rows);
            // Skip when unchanged — avoid redundant SIGWINCH repaints.
            if (cols === term!.cols && rows === term!.rows) return;
            term!.resize(cols, rows);
            if (ptyId) void ptyApi.resize(ptyId, cols, rows);
          } catch {
            /* noop */
          }
        };
        safeFit();
        term.focus();

        dataSub = term.onData((data) => {
          if (ptyId) void ptyApi.write(ptyId, data);
        });

        offData = ptyApi.onData((event) => {
          if (event.id === ptyId) term!.write(event.data);
        });
        offExit = ptyApi.onExit((event) => {
          if (event.id === ptyId) {
            term!.write(`\r\n\x1b[33m[shell exited ${event.exitCode}]\x1b[0m\r\n`);
          }
        });

        // Coalesce resize bursts into one fit per frame.
        const scheduleFit = (): void => {
          if (resizeRaf) cancelAnimationFrame(resizeRaf);
          resizeRaf = requestAnimationFrame(() => {
            resizeRaf = 0;
            safeFit();
          });
        };
        onWindowResize = scheduleFit;
        window.addEventListener('resize', onWindowResize);
        resizeObserver = new ResizeObserver(scheduleFit);
        resizeObserver.observe(container);
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      disposed = true;
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      if (onWindowResize) window.removeEventListener('resize', onWindowResize);
      resizeObserver?.disconnect();
      dataSub?.dispose();
      offData?.();
      offExit?.();
      termRef.current = null;
      term?.dispose();
      if (ptyId) void ptyApi.kill(ptyId);
    };
  }, [cwd]);

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

  if (error) {
    return (
      <div className="p-4 text-xs text-danger font-mono">Shell failed to start: {error}</div>
    );
  }
  return <div ref={containerRef} className="h-full w-full bg-canvas" />;
}
