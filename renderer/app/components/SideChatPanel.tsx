'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from './Terminal';
import type { CliKind } from '../../../shared/ipc-contracts';

interface CliOption {
  kind: CliKind;
  label: string;
  description: string;
}

const OPTIONS: CliOption[] = [
  { kind: 'claude', label: 'Claude', description: 'Anthropic Code' },
  { kind: 'codex', label: 'Codex', description: 'OpenAI GPT-5' },
];

/**
 * Side-chat dock panel: spawns a chat-kind session with panelOnly=true so
 * it lives only inside this panel (no sidebar entry, no main-pane tab).
 * Killed + forgotten on panel unmount so the PTY tears down cleanly.
 */
export function SideChatPanel() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keep the latest sessionId in a ref so the unmount cleanup sees the
  // current value (not the captured-at-mount null).
  const sessionRef = useRef<string | null>(null);
  sessionRef.current = sessionId;

  useEffect(() => {
    return () => {
      const id = sessionRef.current;
      if (!id) return;
      const api = window.agentDashboard?.sessions;
      if (!api) return;
      void api.kill(id).then(() => api.forget(id));
    };
  }, []);

  const spawn = useCallback(async (cli: CliKind) => {
    const api = window.agentDashboard?.sessions;
    if (!api) return;
    setPending(true);
    setError(null);
    try {
      const session = await api.spawn({
        cli,
        cols: 100,
        rows: 30,
        chat: true,
        panelOnly: true,
      });
      setSessionId(session.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }, []);

  if (sessionId) {
    return (
      <div className="h-full w-full bg-canvas">
        <Terminal sessionId={sessionId} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
      <div className="text-center">
        <div className="text-sm text-ink">Pick an agent for this side chat</div>
        <div className="mt-1 text-xs text-muted">
          Lives only in this panel. Closing the panel kills the session.
        </div>
      </div>
      <div className="flex gap-2">
        {OPTIONS.map((o) => (
          <button
            key={o.kind}
            type="button"
            disabled={pending}
            onClick={() => void spawn(o.kind)}
            className="flex flex-col items-center gap-0.5 rounded-md border border-edge/10 bg-sunken px-4 py-3 text-center transition-colors hover:border-accent/60 hover:bg-surface disabled:opacity-50"
          >
            <span className="text-sm font-medium text-ink">{o.label}</span>
            <span className="text-[10px] text-muted">{o.description}</span>
          </button>
        ))}
      </div>
      {pending && <div className="text-xs text-muted">Starting…</div>}
      {error && (
        <div className="rounded-md bg-danger/10 px-3 py-2 font-mono text-xs text-danger">
          {error}
        </div>
      )}
    </div>
  );
}
