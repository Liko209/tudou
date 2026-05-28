'use client';

import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';

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

  useEffect(() => {
    const container = containerRef.current;
    const api = window.agentDashboard?.sessions;
    if (!container || !api) return;

    const term = new XTerm({
      fontFamily: '"SF Mono", "JetBrains Mono", Menlo, monospace',
      fontSize: 13,
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
      scrollback: 5000,
      macOptionIsMeta: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    const u11 = new Unicode11Addon();
    term.loadAddon(u11);
    term.unicode.activeVersion = '11';

    term.open(container);

    // Only call fit when the container has real dimensions (i.e. it's
    // visible). Calling fit on a hidden container crashes xterm.
    const safeFit = (): void => {
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      try {
        fit.fit();
        void api.resize(sessionId, term.cols, term.rows);
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

    const offData = api.onData((event) => {
      if (event.sessionId === sessionId) term.write(event.data);
    });

    const handleResize = (): void => safeFit();
    window.addEventListener('resize', handleResize);

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      dataSub.dispose();
      offData();
      term.dispose();
    };
  }, [sessionId]);

  return <div ref={containerRef} className="h-full w-full" />;
}
