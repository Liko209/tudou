'use client';

import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';

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
          fontFamily: '"SF Mono", "JetBrains Mono", Menlo, monospace',
          fontSize: 12,
          lineHeight: 1.2,
          theme: {
            background: '#0b0d12',
            foreground: '#e6e8ee',
            cursor: '#5b9cff',
            cursorAccent: '#0b0d12',
            selectionBackground: 'rgba(91, 156, 255, 0.3)',
          },
          cursorBlink: true,
          allowProposedApi: true,
          scrollback: 2000,
          macOptionIsMeta: true,
        });

        const fit = new FitAddon();
        term.loadAddon(fit);
        term.loadAddon(new WebLinksAddon());
        const u11 = new Unicode11Addon();
        term.loadAddon(u11);
        term.unicode.activeVersion = '11';
        term.open(container);

        const safeFit = (): void => {
          if (!container || container.clientWidth === 0 || container.clientHeight === 0) return;
          try {
            fit.fit();
            if (ptyId) void ptyApi.resize(ptyId, term!.cols, term!.rows);
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

        onWindowResize = (): void => safeFit();
        window.addEventListener('resize', onWindowResize);
        resizeObserver = new ResizeObserver(safeFit);
        resizeObserver.observe(container);
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      disposed = true;
      if (onWindowResize) window.removeEventListener('resize', onWindowResize);
      resizeObserver?.disconnect();
      dataSub?.dispose();
      offData?.();
      offExit?.();
      term?.dispose();
      if (ptyId) void ptyApi.kill(ptyId);
    };
  }, [cwd]);

  if (error) {
    return (
      <div className="p-4 text-xs text-danger font-mono">Shell failed to start: {error}</div>
    );
  }
  return <div ref={containerRef} className="h-full w-full bg-canvas" />;
}
