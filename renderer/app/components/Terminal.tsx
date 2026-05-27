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

export function Terminal({ sessionId }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const api = window.agentDashboard?.pty;
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
    fit.fit();
    void api.resize(sessionId, term.cols, term.rows);
    term.focus();

    const dataSub = term.onData((data) => {
      void api.write(sessionId, data);
    });

    const offData = api.onData((event) => {
      if (event.id === sessionId) term.write(event.data);
    });

    const offExit = api.onExit((event) => {
      if (event.id === sessionId) {
        term.write(`\r\n\x1b[33m[process exited with code ${event.exitCode}]\x1b[0m\r\n`);
      }
    });

    const handleWindowResize = (): void => {
      fit.fit();
      void api.resize(sessionId, term.cols, term.rows);
    };
    window.addEventListener('resize', handleWindowResize);

    const resizeObserver = new ResizeObserver(handleWindowResize);
    resizeObserver.observe(container);

    return () => {
      window.removeEventListener('resize', handleWindowResize);
      resizeObserver.disconnect();
      dataSub.dispose();
      offData();
      offExit();
      term.dispose();
    };
  }, [sessionId]);

  return <div ref={containerRef} className="terminal-mount" />;
}
